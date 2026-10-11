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
    config: { names: NAMES, PRODUCT_NAME: "Suitemates", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 10 },
    routerPrompt: "",
    log: () => {},
    addUser: async (_p, _n, persona) => {
      adds.push(persona);
      await sleep(delayMs);
      return { ok: true, line: "+16465550002" };
    },
  });
  store.saveUser({ phone: PHONE, name: "Sam", canvasLinked: false, onboardingStep: "done", signupStatus: "invited", agents: ["social"], greeted: ["social"], poolLines: { "p-s": "+16465550001" }, ...user });
  let n = 0;
  const dm = (text: string) => engine.handle({ persona: "social", kind: "dm", sender: PHONE, text, handle: "sunny-space", messageId: `m${++n}`, lineKnown: true } as Inbound);
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
