// Regression tests for the Fable review of kerry/recruit (S1-S6 + nits): each failed before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import { consentFromText, recruitTool } from "../core/recruit.ts";
import { sendAll } from "../core/transport.ts";
import type { LlmClient, LlmMessage } from "../core/llm/client.ts";
import type { Inbound, Outbound, PersonaId, UserProfile } from "../core/types.ts";

for (const id of ["social", "financial", "academic"]) {
  process.env[`${id.toUpperCase()}_PROJECT_ID`] = `p-${id[0]}`;
  process.env[`${id.toUpperCase()}_PROJECT_SECRET`] = "x";
}
const PHONE = "+19195550123";
const NAMES: Record<PersonaId, string> = { academic: "Dean", financial: "Penny", social: "Sunny" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const spy: LlmClient = {
  name: "spy",
  json: async () => "{}",
  chat: async ({ system, messages }) => {
    const me = /You are (\w+),/.exec(system)?.[1] ?? "?";
    const last = messages.at(-1) as LlmMessage;
    if (last.role === "tool") return { text: me === "Sunny" ? "want Penny to jump in?" : `${me} reply` };
    const text = last.role === "user" ? last.text : "";
    if (text.startsWith("[handoff")) return { text: `${me} answer` };
    if (me === "Sunny" && /beach/i.test(text)) return { toolCalls: [{ name: "bring_in", args: { agent: "financial", ask: "price it" } }] };
    return { text: `${me} reply` };
  },
};
function setup(delayMs = 0, user: Partial<UserProfile> = {}) {
  const store = new Store(null);
  const adds: (PersonaId | undefined)[] = [];
  const engine = new Engine({
    personas: loadPersonas(),
    store,
    llm: spy,
    config: { names: NAMES, PRODUCT_NAME: "Suitemates", mock: true },
    log: () => {},
    addUser: async (_p, _n, persona) => {
      adds.push(persona);
      await sleep(delayMs);
      return { ok: true, line: "+16465550002" };
    },
  });
  store.saveUser({ phone: PHONE, name: "Sam", canvasLinked: false, onboardingStep: "done", signupStatus: "invited", agents: ["social"], greeted: ["social"], poolLines: { "p-s": "+16465550001" }, ...user });
  let n = 0;
  const dm = (text: string) => engine.handle({ persona: "social", sender: PHONE, text, handle: "sunny-space", messageId: `m${++n}`, lineKnown: true } as Inbound);
  return { engine, store, adds, dm };
}
const tool = (store: Store, text: string) => recruitTool({ store, names: NAMES, from: "social", text, now: () => Date.now(), needsAdd: () => false, startAdd: () => {} });

test("S1: 'yes' after the background add settled reuses it (no second Photon CLI run, no wait)", async () => {
  const s = setup(0);
  await s.dm("I'm going on the beach trip Saturday");
  await sleep(50); // the judge reads the question
  (s.engine.d as { addUser?: unknown }).addUser = async (_p: string, _n: string, persona: PersonaId) => (s.adds.push(persona), await sleep(1500), { ok: true, line: "+16465550002" });
  const t0 = Date.now();
  await s.dm("yes");
  assert.equal(s.adds.length, 1, `addUser called ${s.adds.length}x`);
  assert.ok(Date.now() - t0 < 1000, `yes took ${Date.now() - t0} ms`);
});

test("S2: two texts in flight before the first hello is out → one hello and card, not two", async () => {
  const s = setup(0, { signupStatus: "added", greeted: [] });
  const [a, b] = await Promise.all([s.dm("hey"), s.dm("hello??")]);
  assert.equal([...a, ...b].filter((o) => o.card).length, 1);
});

test("S3: bring_in takes a display name ('Penny'), and never recruits whoever else the text mentions", async () => {
  const s = setup(0);
  const r = await tool(s.store, "dean said the beach trip is saturday, how much is it").run({ agent: "Penny", ask: "price it" }, s.engine.ctx("social", s.store.user(PHONE)));
  assert.doesNotMatch(r, /^error/, r);
  const p = s.store.kv("shared", PHONE).get<{ agents: { id: string; consent: string }[] }>("recruit");
  assert.deepEqual(p?.agents.map((a) => [a.id, a.consent]), [["financial", "pending"]]);
});

test("S4: asked=true only counts as consent when the student actually named that agent", async () => {
  const s = setup(0);
  await tool(s.store, "how much is the beach trip").run({ agent: "financial", ask: "price it", asked: true }, s.engine.ctx("social", s.store.user(PHONE)));
  const p = s.store.kv("shared", PHONE).get<{ agents: { id: string; consent: string }[] }>("recruit");
  assert.deepEqual(p?.agents.map((a) => [a.id, a.consent]), [["financial", "pending"]]);
});

test("S5: one failed send doesn't drop the rest of the batch", async () => {
  const sent: string[] = [];
  const t = { start: async () => {}, send: async (o: Outbound) => { if (o.persona === "financial") throw new Error("Target not allowed"); sent.push(o.text); } };
  await sendAll(t, [{ persona: "social", handle: "h", text: "ack" }, { persona: "financial", handle: "h", text: "penny" }, { persona: "academic", handle: "h", text: "dean" }], () => {});
  assert.deepEqual(sent, ["ack", "dean"]);
});

test("S6: someone who texted in (no web sign-up) keeps their first agent's proactive texts after a recruit", async () => {
  const s = setup(0, { signupStatus: undefined, agents: undefined, greeted: undefined, poolLines: undefined });
  await s.dm("I'm going on the beach trip Saturday");
  await s.dm("yes");
  const u = s.store.user(PHONE);
  assert.ok(u.agents?.includes("social") && u.greeted?.includes("social"), `agents=${JSON.stringify(u.agents)} greeted=${JSON.stringify(u.greeted)}`);
});

test("consent: 'no' wins over a polite yes-word, and a question isn't a yes", () => {
  assert.equal(consentFromText("please no"), "no");
  assert.equal(consentFromText("ok so what time?"), undefined);
  assert.equal(consentFromText("yes!"), "yes");
  assert.equal(consentFromText("yeah do it"), "yes");
  assert.equal(consentFromText("nah im good"), "no");
});

test("S8: with a deliver hook, 'yes' answers with the ack at once; each agent's texts go out as soon as that agent is ready", async () => {
  const s = setup(0);
  const slow: LlmClient = {
    ...spy,
    chat: async (req) => {
      const last = req.messages.at(-1) as LlmMessage;
      if (last.role === "user" && last.text.startsWith("[handoff")) await sleep(300);
      return spy.chat(req);
    },
  };
  const delivered: Outbound[][] = [];
  Object.assign(s.engine.d, { llm: slow, deliver: async (outs: Outbound[]) => void delivered.push(outs) });
  await s.dm("I'm going on the beach trip Saturday");
  const t0 = Date.now();
  const out = await s.dm("yes");
  assert.deepEqual(out.map((o) => o.persona), ["social"], "only the ack comes back with the turn");
  assert.ok(Date.now() - t0 < 250, `ack took ${Date.now() - t0} ms`);
  await sleep(700);
  const penny = delivered.flat().filter((o) => o.persona === "financial");
  assert.ok(penny.some((o) => o.card) && penny.some((o) => o.text === "Penny answer"), JSON.stringify(delivered));
});

test("a 'yes' in the thread of an agent from the same hand-off counts (Penny answered first, so they said yes to her)", async () => {
  // They already have Penny: on the beach text she answers at once in her own thread, Dean waits for a yes.
  const s = setup(0, { agents: ["social", "financial"], greeted: ["social", "financial"] });
  const both: LlmClient = {
    ...spy,
    chat: async (req) => {
      const last = req.messages.at(-1) as LlmMessage;
      if (/You are Sunny,/.test(req.system) && last.role === "user" && /beach/i.test(last.text))
        return { toolCalls: [{ name: "bring_in", args: { agent: "financial", ask: "price it" } }, { name: "bring_in", args: { agent: "academic", ask: "check saturday" } }] };
      return spy.chat(req);
    },
  };
  (s.engine.d as { llm: LlmClient }).llm = both;
  await s.dm("I'm going on the beach trip Saturday");
  const penny = s.engine.handle({ persona: "financial", sender: PHONE, text: "Yes", handle: "penny-space", messageId: "y1", lineKnown: true } as Inbound);
  const out = await penny;
  assert.ok(out.some((o) => o.persona === "academic" && o.text === "Dean answer"), JSON.stringify(out.map((o) => [o.persona, o.text])));
  assert.equal(out[0].persona, "financial", "the ack comes from the agent they said yes to");
  assert.equal(s.store.kv("shared", PHONE).get("recruit"), undefined);
});

test("a 'yes' to an agent outside the hand-off still doesn't accept it", async () => {
  const s = setup(0, { agents: ["social", "financial"], greeted: ["social", "financial"] }); // Sunny offers Penny? no: Penny is theirs
  // Sunny offers Dean only; a yes texted to Penny (not part of this hand-off) is just a message to Penny.
  (s.engine.d as { llm: LlmClient }).llm = {
    ...spy,
    chat: async (req) => {
      const last = req.messages.at(-1) as LlmMessage;
      if (/You are Sunny,/.test(req.system) && last.role === "user" && /beach/i.test(last.text)) return { toolCalls: [{ name: "bring_in", args: { agent: "academic", ask: "check saturday" } }] };
      return spy.chat(req);
    },
  };
  await s.dm("I'm going on the beach trip Saturday");
  const out = await s.engine.handle({ persona: "financial", sender: PHONE, text: "yes", handle: "penny-space", messageId: "y2", lineKnown: true } as Inbound);
  assert.ok(!out.some((o) => o.persona === "academic"));
});

// Review of kerry/yes-any-thread (3-lens workflow): another hand-off agent's thread may only ACCEPT, never consume.
function partySetup(lastFromDean?: string) {
  const s = setup(0, { agents: ["social", "financial", "academic"].slice(0, lastFromDean ? 3 : 2) as PersonaId[], greeted: ["social", "financial", "academic"].slice(0, lastFromDean ? 3 : 2) as PersonaId[] });
  (s.engine.d as { llm: LlmClient }).llm = {
    ...spy,
    chat: async (req) => {
      const last = req.messages.at(-1) as LlmMessage;
      if (/You are Sunny,/.test(req.system) && last.role === "user" && /beach/i.test(last.text))
        return { toolCalls: lastFromDean
          ? [{ name: "bring_in", args: { agent: "academic", ask: "check saturday" } }, { name: "bring_in", args: { agent: "financial", ask: "price it" } }]
          : [{ name: "bring_in", args: { agent: "financial", ask: "price it" } }, { name: "bring_in", args: { agent: "academic", ask: "check saturday" } }] };
      if (lastFromDean && /You are Dean,/.test(req.system) && last.role === "user" && last.text.startsWith("[handoff")) return { text: lastFromDean };
      return spy.chat(req);
    },
  };
  const to = (persona: PersonaId, text: string) => s.engine.handle({ persona, sender: PHONE, text, handle: `${persona}-space`, messageId: `x${Math.random()}`, lineKnown: true } as Inbound);
  return { s, to };
}

test("review #1: a non-answer to Penny keeps Sunny's offer; a later yes to Sunny still brings Dean", async () => {
  const { s, to } = partySetup();
  await to("social", "I'm going on the beach trip Saturday");
  const thanks = await to("financial", "thanks penny");
  assert.deepEqual(thanks.map((o) => [o.persona, o.text]), [["financial", "Penny reply"]], "Penny hears it");
  const yes = await to("social", "yes");
  assert.ok(yes.some((o) => o.persona === "academic" && o.text === "Dean answer"), JSON.stringify(yes.map((o) => [o.persona, o.text])));
  void s;
});

test("review #2: 'ok option 1' to Dean (answering his own 'your call') goes to Dean, doesn't recruit Penny or drop her offer", async () => {
  // They have Sunny and Dean: Sunny brings Dean (theirs: answers at once, ending in a question) and offers Penny.
  const { s, to } = partySetup("option 1: take it then go (~85%). option 2: skip it (~61%). your call.");
  s.store.saveUser({ ...s.store.user(PHONE), agents: ["social", "academic"], greeted: ["social", "academic"] });
  await to("social", "I'm going on the beach trip Saturday");
  const ok = await to("academic", "ok option 1");
  assert.ok(!ok.some((o) => o.persona === "financial"), "Penny not recruited off Dean's question");
  assert.deepEqual(ok.map((o) => o.persona), ["academic"]);
  const yes = await to("social", "yes"); // the offer is still there in Sunny's thread
  assert.ok(yes.some((o) => o.persona === "financial" && o.text === "Penny answer"));
});

test("review #2b: in another agent's thread only a real yes counts, not 'ok' / 'k' / 'bet'", async () => {
  const { to } = partySetup();
  await to("social", "I'm going on the beach trip Saturday");
  const ok = await to("financial", "ok");
  assert.deepEqual(ok.map((o) => o.persona), ["financial"]);
  const yes = await to("financial", "yeah");
  assert.ok(yes.some((o) => o.persona === "academic" && o.text === "Dean answer"));
});

test("review #4: the party window is ~3 minutes: a yes to Penny at 2.5 min still counts", async () => {
  const { s, to } = partySetup();
  await to("social", "I'm going on the beach trip Saturday");
  const at = Date.now() + 150_000;
  (s.engine as unknown as { now: () => number }).now = () => at;
  const yes = await to("financial", "yes");
  assert.ok(yes.some((o) => o.persona === "academic" && o.text === "Dean answer"));
});

test("an agent that just answered a hand-off isn't run again for the same plan a minute later (no duplicate texts)", async () => {
  // Live 02:04: they had all three; Sunny brought Penny+Dean (both answered at once), still asked "want penny + dean…?",
  // they said "Yes", and Sunny called bring_in for both again: every agent answered the NYC trip twice.
  const s = setup(0, { agents: ["social", "financial", "academic"], greeted: ["social", "financial", "academic"] });
  const both = [{ name: "bring_in", args: { agent: "financial", ask: "price nyc" } }, { name: "bring_in", args: { agent: "academic", ask: "check fall break" } }];
  (s.engine.d as { llm: LlmClient }).llm = {
    ...spy,
    chat: async (req) => {
      const last = req.messages.at(-1) as LlmMessage;
      if (/You are Sunny,/.test(req.system) && last.role === "user" && /nyc|yes/i.test(last.text)) return { toolCalls: both };
      return spy.chat(req);
    },
  };
  const first = await s.dm("I want to go to nyc for fall break");
  assert.equal(first.filter((o) => o.text === "Penny answer" || o.text === "Dean answer").length, 2);
  const again = await s.dm("Yes");
  assert.deepEqual(again.filter((o) => o.persona !== "social").map((o) => o.text), [], "no second round of answers");
});
