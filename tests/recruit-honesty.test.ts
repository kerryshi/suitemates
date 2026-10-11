// Tonight's recruit failures (Messages DB, 2026-10-11) as tests: wrong answers at the source, and a false hand-off claim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchActivity } from "../personas/financial/money.ts";
import { checkPlanConflicts } from "../personas/academic/conflicts.ts";
import { g1HandoffClaims, type TurnFacts } from "../core/governance.ts";

const ACTS = [
  { id: "beach", name: "Beach trip to Wrightsville", when: "Saturday 9 AM", costEstimate: 45 },
  { id: "boba", name: "Boba run on Franklin St", when: "Friday 8 PM", costEstimate: 7 },
];

test("Penny: an NYC trip is not priced as the beach trip (02:07 '$45')", () => {
  assert.equal(matchActivity("NYC trip for fall break", ACTS), undefined);
  assert.equal(matchActivity("beach trip Saturday", ACTS)?.id, "beach");
  assert.equal(matchActivity("boba", ACTS)?.id, "boba");
});

test("Dean: a day he can't read is never reported clear (02:08 'clear for fall break')", async () => {
  const ctx = { now: new Date("2026-10-11T12:00:00"), mock: true, user: { phone: "+19195550001", canvasLinked: false, onboardingStep: "done" }, kv: { get: () => undefined, set: () => {} }, log: () => {} } as never;
  const out = await checkPlanConflicts.run({ day: "fall break" }, ctx);
  assert.doesNotMatch(out, /Clear/);
  assert.match(out, /which day/i);
});

const NAMES = { academic: "Dean", financial: "Penny", social: "Sunny" } as const;
const facts = (dispatched: TurnFacts["dispatched"] = []): TurnFacts => ({ persona: "financial", setting: "dm", trace: [], dispatched, alreadyIn: [] });

test("G1: a claim that another agent is texting, when no hand-off went out, is rewritten (01:59 Penny)", () => {
  for (const t of ["dean's texting you now! 📚", "dean’s texting you now!", "Dean is texting you now", "dean will text you", "i looped dean in, he'll text you shortly"]) {
    const v = g1HandoffClaims(t, facts(), NAMES);
    assert.ok(v.hits.length, `caught: ${t}`);
    assert.doesNotMatch(v.text, /dean.{0,20}text/i, t);
  }
});

test("G1: true claims and plain mentions pass byte-for-byte", () => {
  assert.equal(g1HandoffClaims("dean's texting you now! 📚", facts(["academic"]), NAMES).text, "dean's texting you now! 📚");
  for (const t of ["want dean to check if saturday's safe with your classes?", "that's penny's specialty!", "beach trip should run about $45, which is only 9% of the $496 left"]) {
    const v = g1HandoffClaims(t, facts(), NAMES);
    assert.equal(v.text, t);
    assert.equal(v.hits.length, 0);
  }
});

test("engine: Penny's false 'dean's texting you now' (no hand-off this turn) never reaches the student or her history", async () => {
  const { Engine } = await import("../core/engine.ts");
  const { Store } = await import("../core/store.ts");
  const { loadPersonas } = await import("../core/personas.ts");
  const store = new Store(null);
  const P = "+19195550123";
  store.saveUser({ phone: P, name: "Sam", canvasLinked: false, onboardingStep: "done" });
  const llm = { name: "spy", json: async () => "{}", chat: async () => ({ text: "dean's texting you now! 📚" }) };
  const engine = new Engine({ personas: loadPersonas(), store, llm: llm as never, config: { names: { ...NAMES }, PRODUCT_NAME: "Suitemates", mock: true }, log: () => {} });
  const outs = await engine.handle({ persona: "financial", sender: P, text: "Yes", handle: `any;-;${P}`, messageId: "m1", lineKnown: true });
  assert.doesNotMatch(outs.map((o) => o.text).join(" "), /texting you/);
  assert.doesNotMatch(store.history("financial", P).at(-1)?.text ?? "", /texting you/);
});
