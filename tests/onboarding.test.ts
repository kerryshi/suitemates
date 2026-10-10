import { test } from "node:test";
import assert from "node:assert/strict";
import { onboard, parseBudget } from "../core/onboarding.ts";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import type { UserProfile } from "../core/types.ts";

const n = { me: "financial" as const, product: "Canopy", academic: "Oak", financial: "Clover", social: "Breeze" };
const runAs = (me: "academic" | "financial", ...texts: string[]) => {
  let u: UserProfile = { phone: "+1", canvasLinked: false, onboardingStep: 0 };
  const replies: string[] = [];
  for (const t of texts) {
    const r = onboard(u, t, { ...n, me });
    u = r.user;
    replies.push(r.reply);
  }
  return { u, replies };
};
const run = (...texts: string[]) => runAs("financial", ...texts);

test("hi → budget → goal finishes onboarding with Canvas linked", () => {
  const { u } = run("hi", "800", "spring break, $400");
  assert.equal(u.budgetMonthly, 800);
  assert.equal(u.savingsGoal, "spring break, $400");
  assert.equal(u.canvasLinked, true);
  assert.equal(u.onboardingStep, "done");
});

test("a non-number budget is re-asked once, then defaults to 500", () => {
  const once = run("hi", "lots");
  assert.equal(once.u.onboardingStep, 1);
  assert.match(once.replies[1], /just the number/);
  const twice = run("hi", "lots", "idk");
  assert.equal(twice.u.budgetMonthly, 500);
  assert.equal(twice.u.onboardingStep, 2);
});

test("Academic asks only for Canvas, and any answer links the demo Canvas", () => {
  const { u, replies } = runAs("academic", "hi", "literally anything");
  assert.match(replies[0], /i'm Oak from Canopy.*Canvas login/);
  assert.doesNotMatch(replies.join(" "), /budget|saving/);
  assert.equal(u.canvasLinked, true);
  assert.equal(u.onboardingStep, "done");
});

test("budget parsing handles $ signs, commas and k", () => {
  assert.equal(parseBudget("$1,200"), 1200);
  assert.equal(parseBudget("like 1.5k a month"), 1500);
  assert.equal(parseBudget("nope"), undefined);
});

test("a DM from a new user gets onboarding, not the LLM", async () => {
  let llmCalls = 0;
  const engine = new Engine({
    personas: loadPersonas(),
    store: new Store(null),
    llm: { name: "spy", chat: async () => (llmCalls++, { text: "llm" }), json: async () => "{}" },
    config: { names: { academic: "Oak", financial: "Clover", social: "Breeze" }, PRODUCT_NAME: "Canopy", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 10 },
    routerPrompt: "",
    log: () => {},
  });
  const out = await engine.handle({ persona: "financial", kind: "dm", sender: "+2", text: "hi", handle: "h", messageId: "1" });
  assert.equal(llmCalls, 0);
  assert.match(out[0].text, /i'm Clover from Canopy/);
});
