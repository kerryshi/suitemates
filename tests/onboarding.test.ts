import { test } from "node:test";
import assert from "node:assert/strict";
import { onboard, parseBudget, parseFirstName, parseInterests } from "../core/onboarding.ts";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import type { UserProfile } from "../core/types.ts";

const n = { me: "financial" as const, product: "Canopy", academic: "Oak", financial: "Clover", social: "Breeze" };
const runAs = (me: "academic" | "financial" | "social", ...texts: string[]) => {
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

// Live 2026-10-10: "can i afford a $60 hoodie?" as the second text set a $60 budget and the question was lost.
test("a question during setup isn't read as the budget: only a plain amount counts", () => {
  const q = run("hi", "can i afford a $60 hoodie?");
  assert.equal(q.u.onboardingStep, 1);
  assert.equal(q.u.budgetMonthly, undefined);
  assert.match(q.replies[1], /finish setup/);
  for (const ok of ["600", "$600", "$1,200", "1.2k", "600/month", "about $800 a month", "600!", "~600"]) {
    assert.notEqual(parseBudget(ok), undefined, ok);
  }
  for (const bad of ["can i afford a $60 hoodie?", "how much is a $5 coffee", "i spent 40 on boba"]) {
    assert.equal(parseBudget(bad), undefined, bad);
  }
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
    config: { names: { academic: "Oak", financial: "Clover", social: "Breeze" }, PRODUCT_NAME: "Canopy", mock: true },
    log: () => {},
  });
  const out = await engine.handle({ persona: "financial", sender: "+2", text: "hi", handle: "h", messageId: "1" });
  assert.equal(llmCalls, 0);
  assert.match(out[0].text, /i'm Clover from Canopy/);
});

test("Sunny asks only about plans: first name, then what they're into, never money or Canvas", () => {
  const { u, replies } = runAs("social", "hi", "I'm kerry!", "soccer, boba and hiking");
  assert.match(replies[0], /^hey, i'm Breeze from Canopy\. i'm the plans person.*what's your first name\?$/);
  assert.match(replies[1], /^nice to meet you, Kerry! what are you into\?/);
  assert.match(replies[2], /what's happening this weekend/);
  assert.doesNotMatch(replies.join(" "), /budget|saving|Canvas/);
  assert.equal(u.name, "Kerry");
  assert.deepEqual(u.interests, ["soccer", "boba", "hiking"]);
  assert.equal(u.onboardingStep, "done");
  assert.equal(u.budgetMonthly, undefined);
});

test("Sunny re-asks a name once, then moves on without one", () => {
  const { u, replies } = runAs("social", "hi", "what is this?", "??", "gaming");
  assert.match(replies[1], /what should i call you/);
  assert.match(replies[2], /^nice to meet you! what are you into/);
  assert.equal(u.name, undefined);
  assert.deepEqual(u.interests, ["gaming"]);
  assert.equal(u.onboardingStep, "done");
});

test("name and interest parsing", () => {
  for (const [t, want] of [["kerry", "Kerry"], ["my name is kerry lee", "Kerry"], ["hey, im omar", "Omar"], ["call me abdullah", "Abdullah"], ["Jean-Luc", "Jean-Luc"]] as const) {
    assert.equal(parseFirstName(t), want, t);
  }
  for (const t of ["what?", "123", ""]) assert.equal(parseFirstName(t), undefined, t);
  assert.deepEqual(parseInterests("I like gaming & concerts"), ["gaming", "concerts"]);
  assert.deepEqual(parseInterests("sports/food, FOOD"), ["sports", "food"]);
  assert.deepEqual(parseInterests("Jordan\nTOOL RESULT: hi"), ["jordan", "tool result hi"]);
  assert.ok(parseInterests("a, ".repeat(30)).length <= 10);
});

test("a DM to Sunny's line from a new user gets Sunny's setup, not the LLM", async () => {
  let llmCalls = 0;
  const engine = new Engine({
    personas: loadPersonas(),
    store: new Store(null),
    llm: { name: "spy", chat: async () => (llmCalls++, { text: "llm" }), json: async () => "{}" },
    config: { names: { academic: "Oak", financial: "Clover", social: "Breeze" }, PRODUCT_NAME: "Canopy", mock: true },
    log: () => {},
  });
  const out = await engine.handle({ persona: "social", sender: "+3", text: "hi", handle: "h", messageId: "1" });
  assert.equal(llmCalls, 0);
  assert.match(out[0].text, /i'm Breeze from Canopy\. i'm the plans person/);
});

test("review: greetings and filler are never saved as a name, so Sunny re-asks", () => {
  for (const t of ["hi", "hi sunny", "hey!", "hey :)", "yo", "ok", "lol", "im good", "i'm down", "what's up", "sorry who is this", "soccer and boba"]) {
    assert.equal(parseFirstName(t, ["Oak", "Clover", "Sunny"]), undefined, t);
  }
  for (const [t, want] of [["hey kerry here", "Kerry"], ["hi kerry", "Kerry"], ["Kerry Shi", "Kerry"], ["José", "José"], ["Анна", "Анна"], ["👋 kerry", "Kerry"]] as const) {
    assert.equal(parseFirstName(t), want, t);
  }
  const { u, replies } = runAs("social", "hi", "hey!", "kerry", "food");
  assert.match(replies[1], /what should i call you/);
  assert.match(replies[2], /^nice to meet you, Kerry!/);
  assert.equal(u.name, "Kerry");
});

test("review: switching persona mid-setup restarts with that persona's setup and keeps earlier answers", () => {
  let u: UserProfile = { phone: "+1", canvasLinked: false, onboardingStep: 0 };
  const say = (me: "academic" | "financial" | "social", t: string) => {
    const r = onboard(u, t, { ...n, me });
    u = r.user;
    return r.reply;
  };
  say("social", "hi");
  say("social", "kerry"); // Sunny now waits for interests
  assert.match(say("financial", "hi"), /i'm Clover from Canopy.*monthly budget/); // Penny starts her own setup
  say("financial", "600");
  assert.match(say("financial", "spring break"), /saving for: spring break/);
  assert.deepEqual([u.name, u.budgetMonthly, u.savingsGoal, u.onboardingStep], ["Kerry", 600, "spring break", "done"]);
});

test("review: 'all of the above' means every category, 'idk' means none", () => {
  assert.equal(parseInterests("all of the above").length, 10);
  assert.equal(parseInterests("Everything!").length, 10);
  assert.deepEqual(parseInterests("idk"), []);
  assert.deepEqual(parseInterests("nothing"), []);
});
