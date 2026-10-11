// Social tools (owner: Abdullah). Sign-ups live on the shared board (board.ts) so every user sees them.
// Keep list_signups first: the keyless fake LLM calls the first tool whose name words match, with args = {}.
import type { Ctx, Tool } from "../../core/types.ts";
import {
  type Activity,
  type Board,
  NAME_MAX,
  TEXT_MAX,
  addSignup,
  clean,
  describe,
  findActivities,
  findDuplicate,
  loadBoard,
  openBoard,
  matchActivities,
  nameOf,
  rememberUser,
  saveBoard,
  slug,
} from "./board.ts";
import { categoriesOf, categoriesOfEvent, eventFits, fitNote, fits, isCategory, rankByFit } from "./interests.ts";
import { type HeelEvent, campusEvents } from "./heellife.ts";
import { fmtWhen, ymd } from "../../core/kit.ts";
import { PITCHED_KEY } from "./watch.ts";
import { calendarLink } from "./calendar.ts";

export type { Activity } from "./board.ts";

const str = (v: unknown) => clean(v, TEXT_MAX);

// Resolve the activity the model asked for, or explain what to ask the user before `doing` anything.
function pick(b: Board, query: string, doing: string): Activity | string {
  const options = b.activities.map((a) => `- ${a.name}, ${a.when}`).join("\n");
  if (!query) return `Which plan? Ask the user to pick one:\n${options}`;
  const { hits, how } = matchActivities(b, query);
  if (how === "day") {
    return `No plan called "${query}", but on that day there's:\n${hits.map((a) => `- ${a.name}, ${a.when}`).join("\n")}\nAsk if they mean one of these before ${doing}.`;
  }
  if (hits.length === 1) return hits[0];
  const next = doing === "taking them off" ? "Ask which plan they meant." : "Offer start_activity if they want to start it.";
  if (hits.length === 0) return `No plan matches "${query}". Current plans:\n${options}\n${next}`;
  return `"${query}" matches ${hits.length} plans; ask which one:\n${hits.map((a) => `- ${a.name}, ${a.when}`).join("\n")}`;
}

const MY_NAME = {
  type: "string" as const,
  description: "The user's first name, if they've told you, so their matches know who they are.",
};
const ASK_NAME = " (We don't know the user's name, so others see them as 'someone new'. Ask for their first name and pass it as my_name next time.)";

// rememberUser caps my_name at NAME_MAX; tell the model when that cut something, like plan names.
const nameNote = (v: unknown) =>
  [...clean(v, 10 * NAME_MAX)].length > NAME_MAX ? ` (First name shortened to ${NAME_MAX} characters; tell the user how it was saved.)` : "";

const HEELLIFE_ID = /heellife[:\s-]*(\d+)/i;
// Words that don't identify an event: they'd match half the feed ("game", "event") or are about the day.
const FILLER = new Set(["the", "and", "for", "with", "any", "anything", "event", "events", "game", "games", "club", "clubs", "campus", "unc",
  "today", "tonight", "tomorrow", "this", "next", "weekend", "week", "free", "food", "fun", "thing", "things", "stuff", "happening", "going"]);
const keyWords = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !FILLER.has(w));

// "Sunday 5:00 PM" for a Heel Life event's board entry (the exact time is kept in startsAt/endsAt).
const whenOf = (e: HeelEvent) =>
  e.start.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }).replace(" at ", " ");

const eventLine = (e: HeelEvent, ctx: Ctx) =>
  `${e.name}, ${fmtWhen(e.start, ctx.now)}${e.location ? ` at ${e.location}` : ""} [heellife:${e.id}] ${e.url}`;

// The board entry for a real UNC event (heellife-<id>), added once, so matching, watch() texts and the calendar
// work like any plan.
function campusPlanFor(b: Board, e: HeelEvent, ctx: Ctx): Activity {
  const id = `heellife-${e.id}`;
  const existing = b.activities.find((a) => a.id === id);
  if (existing) return existing;
  const a: Activity = {
    id,
    name: e.name,
    when: whenOf(e),
    signups: [],
    createdAt: ctx.now.getTime(),
    source: "heellife",
    startsAt: e.start.toISOString(),
    endsAt: e.end.toISOString(),
    ...(e.location ? { location: e.location } : {}),
    url: e.url,
  };
  b.activities.push(a);
  return a;
}

const others = (b: Board, a: Activity, ctx: Ctx) => a.signups.filter((p) => p !== ctx.user.phone).map((p) => nameOf(b, p, ctx));

const listSignups: Tool = {
  name: "list_signups",
  description:
    "List activities students have signed up for (who's in, when, rough cost). " +
    "Use for 'anyone down for…', plans, outings, trips, sports, or confirming someone is in.",
  parameters: {
    properties: {
      activity: { type: "string", description: "Optional word to filter by, e.g. 'beach' or 'soccer'." },
    },
  },
  async run(args, ctx) {
    const b = openBoard(loadBoard(), ctx.now); // ended campus events stay off the list
    const q = str(args.activity);
    const hits = q ? findActivities(b, q) : b.activities;
    if (hits.length === 0) return `No activities match "${q}".`;
    // Plans that fit the user's sign-up interests come first and say so.
    return rankByFit(hits.map((a) => ({ a })), ctx.user.interests)
      .map(({ a, fit }) => describe(b, a, ctx) + fitNote(fit))
      .join("\n");
  },
};

const joinActivity: Tool = {
  name: "join_activity",
  description:
    "Sign the user up for an existing plan and return who else is in (their matches). " +
    "Use when the user says they're in, going, down, or wants to join a trip, game, food run or event.",
  parameters: {
    properties: {
      activity: { type: "string", description: "The plan to join, as the user said it, e.g. 'beach trip' or 'soccer'." },
      my_name: MY_NAME,
    },
    required: ["activity"],
  },
  async run(args, ctx) {
    const asked = str(args.activity);
    // Talk to Heel Life first, before the board is loaded for writing: another student's join that lands while
    // this one waits on the network must not be overwritten by a stale copy.
    let event: HeelEvent | undefined;
    const id = HEELLIFE_ID.exec(asked)?.[1];
    if (id) {
      const onBoard = loadBoard().activities.some((x) => x.id === `heellife-${id}`);
      if (!onBoard) {
        const events = await campusEvents(ctx.now).catch(() => undefined);
        if (!events) return "Couldn't reach Heel Life right now to add that event. Tell the user to try again in a bit.";
        event = events.find((e) => e.id === id);
        if (!event) return "That Heel Life event isn't on this week's list (it may be over). Call heellife_events to pick one.";
      }
    } else if (asked) {
      // A name that isn't clearly a student plan: if it names real campus events, ask instead of guessing
      // ("dinner" alone must not sign them up for Wesley Dinner & Worship).
      const view = openBoard(loadBoard(), ctx.now);
      const { hits, how } = matchActivities(view, asked);
      // A clear match on a student plan wins. A match that's itself a campus event still checks Heel Life,
      // since the same show can run more than once ("Midsummer Night's Dream" at 2 PM and 7 PM).
      if ((how !== "exact" && how !== "phrase") || hits.every((a) => a.source === "heellife")) {
        const want = keyWords(asked);
        const events = want.length ? await campusEvents(ctx.now).catch(() => [] as HeelEvent[]) : [];
        const cands = events.filter((e) => want.every((w) => keyWords(e.name).includes(w)));
        const onlyThatOne = cands.length === 1 && hits.length === 1 && hits[0].id === `heellife-${cands[0].id}`;
        if (cands.length && !onlyThatOne) {
          const plans = how === "none" ? [] : hits.filter((a) => a.source !== "heellife").map((a) => `- ${a.name}, ${a.when} (a student plan)`);
          return (
            `"${asked}" could be:\n${[...plans, ...cands.slice(0, 6).map((e) => `- ${eventLine(e, ctx)}`)].join("\n")}\n` +
            "Ask which one. For a Heel Life event, call join_activity with its [heellife:<id>]."
          );
        }
      }
    }
    const b = loadBoard();
    // A bare "I'm in" right after Sunny's intro means the plan she pitched (watch.ts introEvent).
    const pitched = ctx.kv.get<string>(PITCHED_KEY);
    const a: Activity | string = event
      ? campusPlanFor(b, event, ctx)
      : id
        ? b.activities.find((x) => x.id === `heellife-${id}`)!
        : pick(openBoard(b, ctx.now), asked || (pitched && b.activities.some((x) => x.id === pitched) ? pitched : ""), "signing them up");
    if (typeof a === "string") return a;
    const crew = others(b, a, ctx);
    const matched = crew.length ? ` Matched with: ${crew.join(", ")}.` : " Nobody else yet; they're first.";
    const named = rememberUser(b, ctx, str(args.my_name));
    const already = a.signups.includes(ctx.user.phone);
    if (!already) addSignup(b, a, ctx.user.phone); // they just heard who's in; watch() texts about people who join after this
    saveBoard(b);
    const page = a.url ? ` Heel Life page (official RSVP): ${a.url}` : "";
    return `${already ? "Already in" : "Joined"}. ${describe(b, a, ctx)}.${matched}${page}${nameNote(args.my_name)}${named ? "" : ASK_NAME}`;
  },
};

const leaveActivity: Tool = {
  name: "leave_activity",
  description: "Take the user off a plan they signed up for. Use when they say they're out, can't make it, or want to drop out.",
  parameters: {
    properties: {
      activity: { type: "string", description: "The plan to leave, e.g. 'beach trip'." },
    },
    required: ["activity"],
  },
  async run(args, ctx) {
    const b = loadBoard();
    const a = pick(b, str(args.activity), "taking them off");
    if (typeof a === "string") return a;
    if (!a.signups.includes(ctx.user.phone)) return `The user wasn't signed up for ${a.name}.`;
    a.signups = a.signups.filter((p) => p !== ctx.user.phone);
    saveBoard(b);
    return `Left. ${describe(b, a, ctx)}.`;
  },
};

const startActivity: Tool = {
  name: "start_activity",
  description:
    "Create a NEW plan with the user as the first one in, so others can join. " +
    "Only when the user clearly wants to host or start something that isn't already a plan (check list_signups first). " +
    "If it says a similar plan exists, ask the user; only if they confirm it's different, call again with new_plan true.",
  parameters: {
    properties: {
      name: { type: "string", description: "Short plan name with the place, e.g. 'Tennis at Cobb courts'." },
      when: { type: "string", description: "Day and time as the user said it, e.g. 'Sunday 2 PM'." },
      cost: { type: "number", description: "Rough cost per person in dollars, if known." },
      new_plan: { type: "boolean", description: "true only after the user confirmed it's different from the similar plan you found." },
      my_name: MY_NAME,
    },
    required: ["name", "when"],
  },
  async run(args, ctx) {
    const name = str(args.name);
    const when = str(args.when);
    const cut = [args.name, args.when].some((v) => [...clean(v, 10 * TEXT_MAX)].length > TEXT_MAX);
    if (!name || !when) return "Need a plan name and a day/time. Ask the user what and when.";
    const b = loadBoard();
    const same = args.new_plan === true ? undefined : findDuplicate(b, name);
    if (same) return `Similar plan already exists: ${describe(b, same, ctx)}. Ask if they want to join it (join_activity) or really start a separate one (new_plan true).`;
    const cost = typeof args.cost === "number" && args.cost > 0 ? args.cost : undefined;
    const a: Activity = { id: slug(name, b.activities), name, when, ...(cost ? { costEstimate: cost } : {}), signups: [], createdAt: ctx.now.getTime() };
    b.activities.push(a);
    addSignup(b, a, ctx.user.phone);
    const named = rememberUser(b, ctx, str(args.my_name));
    saveBoard(b);
    const note = cut ? ` (Name/time shortened to ${TEXT_MAX} characters; tell the user how it was saved.)` : "";
    return `Started. ${describe(b, a, ctx)}. Others can join now.${note}${nameNote(args.my_name)}${named ? "" : ASK_NAME}`;
  },
};

const findMatches: Tool = {
  name: "find_matches",
  description:
    "Find people to hang out with: who shares the user's plans (ranked by how many), plans their crew joined that they haven't, " +
    "or, given an interest, who's into it. Use for 'who should I hang with', 'who else likes soccer', or 'find me people'.",
  parameters: {
    properties: {
      interest: {
        type: "string",
        description: "Optional interest to match on: a word like 'soccer' or 'beach', or a sign-up category like 'outdoors', 'food' or 'pickup sports'.",
      },
    },
  },
  async run(args, ctx) {
    const b = openBoard(loadBoard(), ctx.now);
    const me = ctx.user.phone;
    const interest = str(args.interest);
    if (interest) {
      const hits = isCategory(interest) ? b.activities.filter((a) => categoriesOf(a).includes(interest.toLowerCase())) : findActivities(b, interest);
      if (hits.length === 0) return `Nobody has a plan for "${interest}" yet. Offer start_activity.`;
      return hits
        .map((a) => {
          const who = others(b, a, ctx);
          return `${a.name}, ${a.when}: ${who.length ? who.join(", ") : "nobody else"}${a.signups.includes(me) ? " (user is in)" : " (user not in yet)"}`;
        })
        .join("\n");
    }

    const mine = b.activities.filter((a) => a.signups.includes(me));
    if (mine.length === 0) {
      const byPeople = [...b.activities].sort((x, y) => y.signups.length - x.signups.length).map((a) => ({ a }));
      const top = rankByFit(byPeople, ctx.user.interests).slice(0, 3);
      const head = ctx.user.interests?.length ? "Best fits for their interests first, then most popular" : "Most popular";
      return `The user isn't in any plans yet. ${head}:\n${top.map(({ a, fit }) => describe(b, a, ctx) + fitNote(fit)).join("\n")}`;
    }

    const shared = new Map<string, string[]>(); // phone → plan names shared with the user
    for (const a of mine) for (const p of a.signups) if (p !== me) shared.set(p, [...(shared.get(p) ?? []), a.name]);
    const crew = [...shared].sort((x, y) => y[1].length - x[1].length);
    const lines = crew.length
      ? crew.map(([p, plans]) => `${nameOf(b, p, ctx)}: ${plans.length} plan${plans.length > 1 ? "s" : ""} in common (${plans.join("; ")})`)
      : ["Nobody else is in the user's plans yet."];

    const suggestions = b.activities
      .filter((a) => !a.signups.includes(me))
      .map((a) => ({ a, friends: a.signups.filter((p) => shared.has(p)), fit: fits(a, ctx.user.interests) }))
      .filter((s) => s.friends.length > 0)
      .sort((x, y) => y.friends.length - x.friends.length || y.fit.length - x.fit.length);
    if (suggestions.length) {
      lines.push("Plans their crew is in that they aren't:");
      for (const s of suggestions) lines.push(`${s.a.name}, ${s.a.when}: ${s.friends.map((p) => nameOf(b, p, ctx)).join(", ")}${fitNote(s.fit)}`);
    }
    return lines.join("\n");
  },
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// "saturday"/"sat", "today", "tomorrow", "tonight" (today from 5 PM), "weekend" (Fri 5 PM → Sun), with "this"/"next"/
// "on" ignored. Anything else → undefined, and the filter is skipped rather than hiding everything.
function dayFilter(raw: string, now: Date): ((e: HeelEvent) => boolean) | undefined {
  const d = raw.toLowerCase().replace(/\b(this|next|on|the|coming)\b/g, " ").trim();
  if (!d) return undefined;
  const sameDay = (e: HeelEvent, x: Date) => ymd(e.start) === ymd(x);
  if (d === "today") return (e) => sameDay(e, now);
  if (d === "tonight") return (e) => sameDay(e, now) && e.start.getHours() >= 17;
  if (d === "tomorrow" || d === "tmrw") return (e) => sameDay(e, new Date(now.getTime() + 86_400_000));
  if (d === "weekend") return (e) => [0, 6].includes(e.start.getDay()) || (e.start.getDay() === 5 && e.start.getHours() >= 17);
  const w = DAY_NAMES.findIndex((n) => d.length >= 3 && n.startsWith(d.slice(0, 3)) && n.startsWith(d.replace(/s$/, "")));
  return w >= 0 ? (e) => e.start.getDay() === w : undefined;
}

const heellifeEvents: Tool = {
  name: "heellife_events",
  description:
    "Real UNC campus events this week from Heel Life (club events, games, shows, talks, free food), best fit for the student first. " +
    "Use for 'what's happening at UNC', 'anything on campus this weekend', 'free food today'. Student-made plans are list_signups.",
  parameters: {
    properties: {
      query: { type: "string", description: "Optional words to search for, e.g. 'salsa', 'museum', or a category like 'outdoors'." },
      day: { type: "string", description: "Optional: a weekday like 'saturday', or 'today', 'tonight', 'tomorrow', 'weekend'." },
      free_food: { type: "boolean", description: "true to show only events Heel Life lists with free food." },
    },
  },
  async run(args, ctx) {
    let events: HeelEvent[];
    try {
      events = await campusEvents(ctx.now);
    } catch {
      return "Couldn't reach Heel Life right now. Tell the user to try again in a bit; don't make up events.";
    }
    let q = str(args.query).toLowerCase();
    const freeFood = args.free_food === true || /\bfree food\b/.test(q);
    q = q.replace(/\bfree food\b/g, " ").trim();
    const byDay = dayFilter(str(args.day), ctx.now);
    const want = isCategory(q) ? [] : keyWords(q);
    const scored = events
      .filter((e) => (!freeFood || e.freeFood) && (!byDay || byDay(e)))
      .map((e) => {
        if (isCategory(q)) return { e, score: categoriesOfEvent(e).includes(q) ? 1 : 0 };
        if (!want.length) return { e, score: 1 };
        const have = new Set(keyWords(`${e.name} ${e.org} ${e.location} ${e.theme} ${e.categories.join(" ")}`));
        return { e, score: want.filter((w) => have.has(w) || have.has(w.replace(/s$/, ""))).length };
      })
      .filter((x) => x.score > 0);
    const ignoredDay = str(args.day) && !byDay ? ` (couldn't read the day "${str(args.day)}", so it's not filtered by day)` : "";
    if (!scored.length) {
      return `Nothing on Heel Life this week matched those filters${q ? ` ("${q}")` : ""}. Try heellife_events again with fewer filters before telling them nothing's on.`;
    }
    const b = loadBoard();
    const top = scored
      .map((x) => ({ ...x, fit: eventFits(x.e, ctx.user.interests) }))
      .sort((x, y) => y.score - x.score || y.fit.length - x.fit.length || +x.e.start - +y.e.start)
      .slice(0, 8);
    const lines = top.map(({ e, fit }) => {
      const going = b.activities.find((a) => a.id === `heellife-${e.id}`)?.signups.length ?? 0;
      return (
        `${e.name}, ${fmtWhen(e.start, ctx.now)}${e.location ? ` at ${e.location}` : ""}${e.org ? ` (${e.org})` : ""}` +
        `${e.freeFood ? " · free food" : ""}${fitNote(fit)}${going ? ` · ${going} going through Sunny` : ""} [heellife:${e.id}] ${e.url}`
      );
    });
    return (
      `${scored.length} on Heel Life this week${ignoredDay}; top ${top.length}:\n${lines.join("\n")}\n` +
      "To go with friends through Sunny, call join_activity with the [heellife:<id>]. Each event's link is its official RSVP page."
    );
  },
};

export const tools: Tool[] = [listSignups, joinActivity, leaveActivity, startActivity, findMatches, calendarLink, heellifeEvents];
