// Social tools (owner: Abdallah). Sign-ups live on the shared board (board.ts) so every user sees them.
// Keep list_signups first: the keyless fake LLM calls the first tool whose name words match, with args = {}.
import type { Ctx, Tool } from "../../core/types.ts";
import {
  type Activity,
  type Board,
  TEXT_MAX,
  addSignup,
  clean,
  describe,
  findActivities,
  findDuplicate,
  loadBoard,
  matchActivities,
  nameOf,
  rememberUser,
  saveBoard,
  slug,
} from "./board.ts";

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
  if (hits.length === 0) return `No plan matches "${query}". Current plans:\n${options}\nOffer start_activity if they want to start it.`;
  return `"${query}" matches ${hits.length} plans; ask which one:\n${hits.map((a) => `- ${a.name}, ${a.when}`).join("\n")}`;
}

const MY_NAME = {
  type: "string" as const,
  description: "The user's first name, if they've told you, so their matches know who they are.",
};
const ASK_NAME = " (We don't know the user's name, so others see them as 'someone new'. Ask for their first name and pass it as my_name next time.)";

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
    const b = loadBoard();
    const q = str(args.activity);
    const hits = q ? findActivities(b, q) : b.activities;
    if (hits.length === 0) return `No activities match "${q}".`;
    return hits.map((a) => describe(b, a, ctx)).join("\n");
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
    const b = loadBoard();
    const a = pick(b, str(args.activity), "signing them up");
    if (typeof a === "string") return a;
    const crew = others(b, a, ctx);
    const matched = crew.length ? ` Matched with: ${crew.join(", ")}.` : " Nobody else yet; they're first.";
    const named = rememberUser(b, ctx, str(args.my_name));
    const already = a.signups.includes(ctx.user.phone);
    if (!already) addSignup(b, a, ctx.user.phone); // they just heard who's in; watch() texts about people who join after this
    saveBoard(b);
    return `${already ? "Already in" : "Joined"}. ${describe(b, a, ctx)}.${matched}${named ? "" : ASK_NAME}`;
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
    const a: Activity = { id: slug(name, b.activities), name, when, ...(cost ? { costEstimate: cost } : {}), signups: [] };
    b.activities.push(a);
    addSignup(b, a, ctx.user.phone);
    const named = rememberUser(b, ctx, str(args.my_name));
    saveBoard(b);
    const note = cut ? ` (Name/time shortened to ${TEXT_MAX} characters; tell the user how it was saved.)` : "";
    return `Started. ${describe(b, a, ctx)}. Others can join now.${note}${named ? "" : ASK_NAME}`;
  },
};

const findMatches: Tool = {
  name: "find_matches",
  description:
    "Find people to hang out with: who shares the user's plans (ranked by how many), plans their crew joined that they haven't, " +
    "or, given an interest, who's into it. Use for 'who should I hang with', 'who else likes soccer', or 'find me people'.",
  parameters: {
    properties: {
      interest: { type: "string", description: "Optional interest to match on, e.g. 'soccer' or 'beach'." },
    },
  },
  async run(args, ctx) {
    const b = loadBoard();
    const me = ctx.user.phone;
    const interest = str(args.interest);
    if (interest) {
      const hits = findActivities(b, interest);
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
      const popular = [...b.activities].sort((x, y) => y.signups.length - x.signups.length).slice(0, 3);
      return `The user isn't in any plans yet. Most popular:\n${popular.map((a) => describe(b, a, ctx)).join("\n")}`;
    }

    const shared = new Map<string, string[]>(); // phone → plan names shared with the user
    for (const a of mine) for (const p of a.signups) if (p !== me) shared.set(p, [...(shared.get(p) ?? []), a.name]);
    const crew = [...shared].sort((x, y) => y[1].length - x[1].length);
    const lines = crew.length
      ? crew.map(([p, plans]) => `${nameOf(b, p, ctx)}: ${plans.length} plan${plans.length > 1 ? "s" : ""} in common (${plans.join("; ")})`)
      : ["Nobody else is in the user's plans yet."];

    const suggestions = b.activities
      .filter((a) => !a.signups.includes(me))
      .map((a) => ({ a, friends: a.signups.filter((p) => shared.has(p)) }))
      .filter((s) => s.friends.length > 0)
      .sort((x, y) => y.friends.length - x.friends.length);
    if (suggestions.length) {
      lines.push("Plans their crew is in that they aren't:");
      for (const s of suggestions) lines.push(`${s.a.name}, ${s.a.when}: ${s.friends.map((p) => nameOf(b, p, ctx)).join(", ")}`);
    }
    return lines.join("\n");
  },
};

export const tools: Tool[] = [listSignups, joinActivity, leaveActivity, startActivity, findMatches];
