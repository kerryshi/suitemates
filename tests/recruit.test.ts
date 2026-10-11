// Agents recruit each other: Sunny hears a plan that costs money and has a day, offers to bring in Penny and Dean,
// and on "yes" each of them texts first from its own number (its own Photon project) with hello, card and an answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import { FakeLlm } from "../core/llm/fake.ts";
import type { LlmClient, LlmMessage } from "../core/llm/client.ts";
import type { AddResult } from "../core/photon-users.ts";
import type { Inbound, Outbound, PersonaId, UserProfile } from "../core/types.ts";
import { recruitTool } from "../core/recruit.ts";

const PHONE = "+19195550123";
const LINES: Record<PersonaId, string> = { social: "+16465550001", financial: "+16465550002", academic: "+16465550003" };
const NAMES: Record<PersonaId, string> = { academic: "Dean", financial: "Penny", social: "Sunny" };
const HANDLE: Record<PersonaId, string> = { social: "sunny-space", financial: "penny-space", academic: "dean-space" };
const PROJECT: Record<PersonaId, string> = { social: "p-s", financial: "p-f", academic: "p-a" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// One Photon project per agent (core/photon-users.ts photonProjectFor reads these).
for (const id of ["social", "financial", "academic"] as const) {
  process.env[`${id.toUpperCase()}_PROJECT_ID`] = PROJECT[id];
  process.env[`${id.toUpperCase()}_PROJECT_SECRET`] = "x";
}
const byProject = (m: Partial<Record<PersonaId, string>>) => Object.fromEntries(Object.entries(m).map(([id, n]) => [PROJECT[id as PersonaId], n]));

// Sunny calls bring_in for Penny + Dean on the beach text; "ask penny …" names her (asked=true). Every handoff gets
// "<Name> answer", everything else "<Name> reply".
const spy: LlmClient = {
  name: "spy",
  json: async () => "{}",
  chat: async ({ system, messages }) => {
    const me = /You are (\w+),/.exec(system)?.[1] ?? "?";
    const last = messages.at(-1) as LlmMessage;
    if (last.role === "tool") return { text: me === "Sunny" ? "you're in! want Penny and Dean to jump in on this?" : `${me} reply` };
    const text = last.role === "user" ? last.text : "";
    if (text.startsWith("[handoff")) return { text: `${me} answer` };
    if (me === "Sunny" && /beach/i.test(text))
      return {
        toolCalls: [
          { name: "bring_in", args: { agent: "financial", ask: "price the beach trip against their budget" } },
          { name: "bring_in", args: { agent: "academic", ask: "check what's due around saturday" } },
        ],
      };
    if (me === "Sunny" && /ask penny/i.test(text)) return { toolCalls: [{ name: "bring_in", args: { agent: "financial", ask: "can they afford boba", asked: true } }] };
    return { text: `${me} reply` };
  },
};

function setup(o: { addDelayMs?: number; addResults?: Partial<Record<PersonaId, AddResult>>; user?: Partial<UserProfile> } = {}) {
  const store = new Store(null);
  const adds: { phone: string; persona?: PersonaId }[] = [];
  const engine = new Engine({
    personas: loadPersonas(),
    store,
    llm: spy,
    config: { names: NAMES, PRODUCT_NAME: "Suitemates", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 10 },
    routerPrompt: "",
    log: () => {},
    addUser: async (phone, _name, persona) => {
      adds.push({ phone, persona });
      await sleep(o.addDelayMs ?? 0);
      return o.addResults?.[persona!] ?? { ok: true, line: LINES[persona!] };
    },
  });
  store.saveUser({
    phone: PHONE,
    name: "Sam",
    canvasLinked: false,
    onboardingStep: "done",
    signupStatus: "invited",
    agents: ["social"],
    greeted: ["social"],
    poolLines: byProject({ social: LINES.social }),
    ...o.user,
  });
  let n = 0;
  const dm = (text: string, persona: PersonaId = "social", extra: Partial<Inbound> = {}) =>
    engine.handle({ persona, kind: "dm", sender: PHONE, text, handle: HANDLE[persona], messageId: `m${++n}`, lineKnown: true, ...extra });
  const pending = () => store.kv("shared", PHONE).get<{ from: PersonaId; agents: { id: PersonaId; consent: string }[] }>("recruit");
  return { store, engine, dm, adds, pending, user: () => store.user(PHONE) };
}

const from = (out: Outbound[], id: PersonaId) => out.filter((o) => o.persona === id);
const BEACH = "I'm going on the beach trip Saturday";

test("the offer: Sunny asks once, Penny and Dean are added to their projects in the background, nothing waits on the CLI", async () => {
  const s = setup({ addDelayMs: 1500 });
  const t0 = Date.now();
  const out = await s.dm(BEACH);
  assert.ok(Date.now() - t0 < 1000, `offer took ${Date.now() - t0} ms; the Photon add must not block it`);
  assert.deepEqual(out.map((o) => [o.persona, o.handle]), [["social", HANDLE.social]]);
  assert.match(out[0].text, /jump in/);
  assert.deepEqual(s.pending()?.from, "social");
  assert.deepEqual(s.pending()?.agents.map((a) => [a.id, a.consent]), [["financial", "pending"], ["academic", "pending"]]);
  assert.deepEqual(s.adds.map((a) => a.persona), ["financial", "academic"]);
});

test("'yes' on Sunny's thread: Sunny acks, then Penny and Dean each text first from their own number with hello, card, answer", async () => {
  const s = setup();
  await s.dm(BEACH);
  const out = await s.dm("yes!");
  assert.equal(out[0].persona, "social");
  assert.equal(out[0].handle, HANDLE.social);
  assert.match(out[0].text, /Penny/);
  assert.match(out[0].text, /Dean/);
  for (const id of ["financial", "academic"] as const) {
    const mine = from(out, id);
    assert.ok(mine.every((o) => o.handle === `dm:${PHONE}` && !o.via), `${id} speaks from its own number`);
    assert.equal(mine.find((o) => o.card)?.card?.phone, LINES[id], `${id}'s card carries the number this person texts`);
    assert.ok(mine.some((o) => o.text === `${NAMES[id]} answer`), `${id} answers the handoff`);
    assert.ok(mine.findIndex((o) => !o.card && o.text && o.text !== `${NAMES[id]} answer`) < mine.findIndex((o) => o.text === `${NAMES[id]} answer`), "hello before the answer");
  }
  assert.deepEqual([...(s.user().agents ?? [])].sort(), ["academic", "financial", "social"]);
  assert.deepEqual([...(s.user().greeted ?? [])].sort(), ["academic", "financial", "social"]);
  assert.deepEqual(s.user().poolLines, byProject(LINES));
  assert.equal(s.pending(), undefined);
  // A second "yes" is just a message to Sunny now: nobody is re-added or re-introduced.
  const again = await s.dm("yes");
  assert.deepEqual(again.map((o) => [o.persona, o.text]), [["social", "Sunny reply"]]);
  assert.equal(s.adds.length, 2);
});

test("'no' drops the offer; anything that isn't yes or no also drops it (one-shot) and gets a normal reply", async () => {
  const s = setup();
  await s.dm(BEACH);
  const no = await s.dm("nah");
  assert.equal(no.length, 1);
  assert.match(no[0].text, /no worries/i);
  assert.equal(s.pending(), undefined);

  await s.dm(BEACH);
  const other = await s.dm("what time do we leave?");
  assert.deepEqual(other.map((o) => [o.persona, o.text]), [["social", "Sunny reply"]]);
  assert.equal(s.pending(), undefined);
  assert.deepEqual(s.user().agents, ["social"]);
});

test("naming an agent is consent: no question, Penny texts first in the same turn", async () => {
  const s = setup();
  const out = await s.dm("ask penny if i can afford boba");
  assert.equal(out[0].persona, "social");
  assert.ok(from(out, "financial").some((o) => o.text === "Penny answer"));
  assert.ok(from(out, "financial").some((o) => o.card));
  assert.equal(s.pending(), undefined);
  assert.ok(s.user().agents?.includes("financial"));
});

test("an agent they already have answers from its own thread right away: no question, no second hello", async () => {
  const s = setup({ user: { agents: ["social", "financial"], greeted: ["social", "financial"], poolLines: byProject({ social: LINES.social, financial: LINES.financial }) } });
  const out = await s.dm(BEACH);
  const penny = from(out, "financial");
  assert.deepEqual(penny.map((o) => [o.handle, o.text, Boolean(o.card)]), [[`dm:${PHONE}`, "Penny answer", false]]);
  assert.deepEqual(s.pending()?.agents.map((a) => a.id), ["academic"], "Dean still waits for a yes");
  assert.deepEqual(s.adds.map((a) => a.persona), ["academic"], "Penny is not re-added");
});

test("a 'yes' texted to a different agent's number doesn't accept Sunny's offer", async () => {
  const s = setup({ user: { agents: ["social", "financial"], greeted: ["social", "financial"] } });
  await s.dm("ask penny if i can afford boba"); // Penny is already theirs: answered, nothing pending
  await s.dm(BEACH); // Dean pending, offered by Sunny
  const out = await s.dm("yes", "financial");
  assert.deepEqual(out.map((o) => [o.persona, o.text]), [["financial", "Penny reply"]]);
  assert.deepEqual(s.pending()?.agents.map((a) => a.id), ["academic"]);
});

test("if Penny can't be added (full project, dead token), she still answers: through Sunny's thread, name-tagged by transport", async () => {
  const s = setup({ addResults: { financial: { ok: false, full: true, error: "financial project is full (100/100 users)" } } });
  await s.dm(BEACH);
  const out = await s.dm("yes");
  const penny = from(out, "financial");
  assert.ok(penny.length >= 2);
  assert.ok(penny.every((o) => o.via === "social" && o.handle === `dm:${PHONE}`));
  assert.equal(penny.find((o) => o.card)?.card?.phone, LINES.social, "her card points at the number they actually text");
  assert.ok(from(out, "academic").every((o) => !o.via), "Dean was added fine and uses his own number");
  assert.equal(s.user().via?.financial, "social");
  assert.equal(s.user().poolLines?.[PROJECT.financial], undefined);
  // Later proactive texts from Penny (a roast, the weekly check-in) take the same route.
  const weekly = await s.engine.trigger("financial", "weekly_money", { phone: PHONE, force: true });
  assert.ok(weekly.length > 0);
  assert.ok(weekly.every((o) => o.via === "social"));
});

test("bring_in refuses to recruit yourself and needs a known agent (keyless: the name in their text)", async () => {
  const s = setup();
  const tool = recruitTool({ store: s.store, names: NAMES, from: "social", text: "hmm", now: () => 0, needsAdd: () => false, startAdd: () => {} });
  const ctx = s.engine.ctx("social", s.user());
  assert.match(await tool.run({ agent: "social" }, ctx), /^error/);
  assert.match(await tool.run({}, ctx), /^error/);
  const keyless = recruitTool({ store: s.store, names: NAMES, from: "social", text: "can dean check my week?", now: () => 0, needsAdd: () => false, startAdd: () => {} });
  assert.doesNotMatch(await keyless.run({}, ctx), /^error/);
  assert.deepEqual(s.pending()?.agents.map((a) => [a.id, a.consent]), [["academic", "given"]]);
});

test("keyless model: an ordinary message with the word 'in' doesn't call bring_in", async () => {
  const tool = recruitTool({ store: new Store(null), names: NAMES, from: "social", text: "", now: () => 0, needsAdd: () => false, startAdd: () => {} });
  const step = await new FakeLlm().chat({ system: "", messages: [{ role: "user", text: "meet me in the library" }], tools: [tool] });
  assert.ok("text" in step, "no tool call");
});
