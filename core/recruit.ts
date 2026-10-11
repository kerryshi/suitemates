// Agents recruit each other. Every agent has a `bring_in` tool (core adds it, like `remember`): when a student's
// message needs another agent's area, the agent they're texting offers it ("want Penny to check the cost?"). On a
// yes, core adds them to that agent's own Photon project and the agent texts first from its own number with its
// hello, contact card and an answer. Naming the agent ("ask penny …") is consent; an agent they already have just
// answers in its own thread. One offer at a time, one shot: any reply that isn't yes or no drops it.
// If an agent can't be added (project full, token expired), it still answers, through the conversation the
// student is already in, name-tagged (Outbound.via, UserProfile.via).
import type { Engine } from "./engine.ts";
import type { Store } from "./store.ts";
import type { Outbound, PersonaId, Tool, UserProfile } from "./types.ts";
import { PERSONA_IDS } from "./types.ts";
import { photonProjectFor, type AddResult } from "./photon-users.ts";
import { introTexts } from "./signup.ts";

export const OFFER_TTL_MS = 10 * 60_000;

export interface RecruitAsk {
  id: PersonaId;
  ask: string; // what that agent should do, in the student's words
  consent: "pending" | "given" | "none"; // none = they already have this agent
}
export interface Pending {
  from: PersonaId; // the agent that offered (the conversation it was offered in)
  text: string; // what the student said
  offeredAt: number;
  agents: RecruitAsk[];
}

export const getPending = (store: Store, phone: string) => store.kv("shared", phone).get<Pending>("recruit");
export const setPending = (store: Store, phone: string, p: Pending | undefined) =>
  store.kv("shared", phone).set("recruit", p?.agents.length ? p : undefined);

const YES = /^\s*(y|ya|yes|yea|yeah|yep|yup|sure|ok|okay|k|please|pls|do it|go ahead|sounds good|bet|let'?s go|absolutely|of course)\b/i;
const NO = /\b(n|no|nah|nope|not now|no thanks|nvm|never ?mind|don'?t)\b/i;
// A short answer to the offer. "no" anywhere wins ("please no"); a question or a long message isn't an answer.
export function consentFromText(text: string): "yes" | "no" | undefined {
  if (NO.test(text) && text.trim().split(/\s+/).length <= 5) return "no";
  if (text.includes("?") || text.trim().split(/\s+/).length > 4) return undefined;
  return YES.test(text) ? "yes" : undefined;
}

const has = (u: UserProfile, id: PersonaId) => Boolean(u.agents?.includes(id) && u.greeted?.includes(id));
const said = (text: string) => text.replace(/\n\n\(Already said[\s\S]*$/, "").trim();

export interface RecruitDeps {
  store: Store;
  names: Record<PersonaId, string>;
  from: PersonaId;
  text: string; // the student's message this turn
  now: () => number;
  needsAdd: (id: PersonaId, user: UserProfile) => boolean;
  startAdd: (id: PersonaId, user: UserProfile) => void; // begin the Photon add now, so a yes doesn't wait on the CLI
}

export function recruitTool(d: RecruitDeps): Tool {
  const others = PERSONA_IDS.filter((id) => id !== d.from);
  const list = others.map((id) => `${d.names[id]} (${id})`).join(", ");
  return {
    name: "bring_in",
    description:
      `Bring another agent in: ${list}. Use it when the message needs that agent's area (money, costs, budget → financial; ` +
      "classes, deadlines, exams → academic; plans, people, events → social), or when they ask for that agent by name " +
      "(asked=true). That agent then texts them first from its own number. You ask ONE short question first unless " +
      "asked=true. Call it in the same turn as your other tools; never answer for the other agent.",
    parameters: {
      properties: {
        agent: { type: "string", enum: others, description: "who to bring in" },
        ask: { type: "string", description: "what that agent should do for them, in their words, e.g. 'price the beach trip'" },
        asked: { type: "boolean", description: "true only when the student named that agent themselves" },
      },
      required: ["agent", "ask"],
    },
    async run(args, ctx) {
      // The id or the display name ("financial" or "Penny"): models use both.
      const given = typeof args.agent === "string" ? args.agent.trim().toLowerCase() : "";
      const pick = (id: PersonaId) => id === given || d.names[id].toLowerCase() === given;
      if (given && (d.from === given || d.names[d.from].toLowerCase() === given)) return `error: that's you; bring in one of: ${list}`;
      const named = (id: PersonaId) => new RegExp(`\\b${d.names[id]}\\b`, "i").test(said(d.text));
      // No agent at all (the keyless stand-in model): the agent they named. Never a guess from the text otherwise.
      const agent = given ? others.find(pick) : others.find(named);
      if (!agent) return `error: say which agent: ${list}`;
      // Consent is the student naming that agent, not the model saying so.
      const asked = named(agent) && (args.asked === true || !given);
      const ask = typeof args.ask === "string" && args.ask.trim() ? args.ask.trim().slice(0, 200) : said(d.text).slice(0, 200);
      const user = ctx.user;
      const consent = has(user, agent) ? "none" : asked ? "given" : "pending";
      const p = getPending(d.store, user.phone);
      const sameTurn = p && p.from === d.from && p.text === said(d.text) && d.now() - p.offeredAt < OFFER_TTL_MS;
      const base: Pending = sameTurn ? p : { from: d.from, text: said(d.text), offeredAt: d.now(), agents: [] };
      setPending(d.store, user.phone, { ...base, agents: [...base.agents.filter((a) => a.id !== agent), { id: agent, ask, consent }] });
      if (consent !== "none" && d.needsAdd(agent, user)) d.startAdd(agent, user);
      const n = d.names[agent];
      if (consent === "none")
        return `${n} is already in their phone and will answer this ${user.via?.[agent] ? "right here" : `in ${n}'s own thread`} now. Say so in a few words; don't answer for ${n}.`;
      if (consent === "given") return `${n} is texting them now from ${n}'s own number. Say so in a few words; don't answer for ${n}.`;
      return `Not sent yet. Ask ONE short question: should ${n} jump in on "${ask}"? (yes/no). Don't answer for ${n}.`;
    },
  };
}

// Bring the agents in: add them to their own projects (or fall back to `from`'s conversation), then each one's
// hello + card (if new) and its answer, all agents in parallel. Returns the texts in send order.
export async function runRecruit(engine: Engine, phone: string, p: Pending): Promise<{ out: Outbound[]; viaFrom: PersonaId[] }> {
  const { store, config } = engine.d;
  const before = store.user(phone);
  const fresh = new Set(p.agents.filter((a) => !has(before, a.id)).map((a) => a.id));
  const added = await Promise.all(
    p.agents.map(async (a): Promise<AddResult | undefined> => (fresh.has(a.id) && engine.needsAdd(a.id, before) ? engine.addFor(a.id, before) : undefined)),
  );
  // One synchronous update of the profile after every add has settled (parallel saves would clobber each other).
  const u = store.user(phone);
  const poolLines = { ...u.poolLines };
  const via = { ...u.via };
  const viaFrom: PersonaId[] = [];
  p.agents.forEach((a, i) => {
    const r = added[i];
    if (!r) return;
    if (r.ok) {
      if (r.line) poolLines[photonProjectFor(a.id).project!] = r.line;
      delete via[a.id];
    } else {
      engine.log(`[photon] ${a.id}: ${r.error ?? "add failed"}; ${config.names[a.id]} speaks through ${config.names[p.from]}`);
      via[a.id] = p.from;
      viaFrom.push(a.id);
    }
  });
  // Someone who texted in (no web sign-up) has no agents list yet: it starts with the agent they were texting, so
  // that agent's proactive texts keep coming (engine.trigger only sends to agents on the list).
  const ids = [...(u.agents ? [] : [p.from]), ...p.agents.map((a) => a.id)];
  store.saveUser({
    ...u,
    agents: [...new Set([...(u.agents ?? []), ...ids])],
    greeted: [...new Set([...(u.greeted ?? []), ...ids])],
    poolLines,
    via,
  });
  const user = store.user(phone);
  const texts = await Promise.all(
    p.agents.map(async (a) => {
      const hello = fresh.has(a.id) ? await introTexts(engine, phone, [a.id]) : [];
      const n = config.names[p.from];
      const brief =
        `[handoff from ${n}] The student told ${n}: "${p.text}". ${n} brought you in to: ${a.ask}. ` +
        (fresh.has(a.id) ? "They said yes, and your hello and contact card were just sent: don't introduce yourself again. " : "") +
        "Answer it with your tools, in one or two short texts' worth.";
      // A new agent's first real text: retried once (Gemini sometimes returns nothing after a tool call), and never
      // replaced by the "my brain glitched" line; the hello and card already went out.
      let answer: string | undefined;
      for (let attempt = 1; attempt <= 2 && answer === undefined; attempt++) {
        try {
          answer = await engine.replyOrThrow(a.id, user, brief, undefined, "recruit");
        } catch (err) {
          engine.log(`WARN ${a.id} handoff answer failed (try ${attempt}): ${err instanceof Error ? err.message : err}`);
        }
      }
      const route = user.via?.[a.id];
      const said: Outbound[] = answer ? [{ persona: a.id, handle: `dm:${phone}`, text: answer }] : [];
      // Through another agent's thread: no contact card (it would carry that agent's number under this one's name,
      // and iOS would label the borrowed thread with either).
      return [...hello, ...said].filter((o) => !(route && o.card)).map((o): Outbound => (route ? { ...o, via: route } : o));
    }),
  );
  return { out: texts.flat(), viaFrom };
}

// The offering agent's "on it", sent before the others' texts land. Only an agent on its own Photon project texts
// from its own number; on one shared project (or via) it jumps in here, name-tagged.
export function ackText(names: Record<PersonaId, string>, ids: PersonaId[], viaFrom: PersonaId[], ownNumber = (id: PersonaId) => photonProjectFor(id).own): string {
  const own = ids.filter((id) => !viaFrom.includes(id) && ownNumber(id)).map((id) => names[id]);
  const here = ids.filter((id) => viaFrom.includes(id) || !ownNumber(id)).map((id) => names[id]);
  const and = (xs: string[]) => xs.join(" and ");
  const parts = [
    own.length ? `${and(own)} ${own.length > 1 ? "are" : "is"} texting you now from ${own.length > 1 ? "their own numbers" : "their own number"} 📲` : "",
    here.length ? `${and(here)} ${here.length > 1 ? "are" : "is"} jumping in right here` : "",
  ].filter(Boolean);
  const filter = own.length ? " (nothing showing? check Messages → Unknown Senders)" : "";
  return `on it! ${parts.join(", and ")}${filter}`;
}
