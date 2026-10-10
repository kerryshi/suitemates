// Review fixes on the proactive path (core/engine.ts) and config defaults.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadConfig } from "../core/config.ts";
import type { LlmClient } from "../core/llm/client.ts";
import type { Persona, PersonaId } from "../core/types.ts";

const names = { academic: "Dean", financial: "Penny", social: "Sunny" };

function engineWith(watched: Persona, llm: LlmClient, store = new Store(null)) {
  const personas = new Map<PersonaId, Persona>([["financial", watched]]);
  return new Engine({
    personas,
    store,
    llm,
    config: { names, PRODUCT_NAME: "Suitemates", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 10, watchList: ["financial"] },
    routerPrompt: "",
    log: () => {},
  });
}
const okLlm: LlmClient = { name: "spy", chat: async () => ({ text: "roast" }), json: async () => "{}" };

test("finishing onboarding baselines the watchers right away (a buy made just after isn't swallowed)", async () => {
  const calls: string[] = [];
  const watched: Persona = { id: "financial", prompt: "p", routerLine: "r", tools: [], watch: async (ctx) => (calls.push(ctx.user.phone), []) };
  const engine = engineWith(watched, okLlm);
  for (const text of ["hi", "800"]) {
    await engine.handle({ persona: "financial", kind: "dm", sender: "+5", text, handle: "h", messageId: text });
  }
  assert.equal(calls.length, 0, "no baseline before onboarding is done");
  await engine.handle({ persona: "financial", kind: "dm", sender: "+5", text: "spring break, $400", handle: "h", messageId: "3" });
  assert.deepEqual(calls, ["+5"]);
});

test("re-running onboarding (/skip by habit after a buy) delivers the watcher's events instead of discarding them", async () => {
  let polls = 0;
  const watched: Persona = {
    id: "financial", prompt: "p", routerLine: "r", tools: [],
    watch: async (ctx) => (++polls === 1 ? [] : [{ kind: "purchase", userPhone: ctx.user.phone, facts: "New purchase: Sheetz $4.29.", dedupeKey: `k${polls}` }]),
  };
  const store = new Store(null);
  store.saveUser({ phone: "+5", canvasLinked: true, onboardingStep: "done" });
  const engine = engineWith(watched, okLlm, store);
  assert.deepEqual(await engine.onboarded("+5"), []); // baseline
  const out = await engine.onboarded("+5"); // a purchase landed in between
  assert.deepEqual(out, [{ persona: "financial", handle: "dm:+5", text: "roast" }]);
});

test("a proactive text whose LLM call fails sends the plain facts, not a glitch message", async () => {
  const watched: Persona = {
    id: "financial", prompt: "p", routerLine: "r", tools: [],
    watch: async (ctx) => [{ kind: "purchase", userPhone: ctx.user.phone, facts: "New purchase: Sheetz $4.29 today 4:25 PM [energy drink]. Tone: roast-worthy.", dedupeKey: "k1" }],
  };
  const broken: LlmClient = { name: "spy", chat: async () => { throw new Error("Gemini 503"); }, json: async () => "{}" };
  const store = new Store(null);
  store.saveUser({ phone: "+5", canvasLinked: true, onboardingStep: "done" });
  const out = await engineWith(watched, broken, store).trigger("financial", "watch");
  assert.equal(out.length, 1);
  assert.doesNotMatch(out[0].text, /glitch/);
  assert.equal(out[0].text, "New purchase: Sheetz $4.29 today 4:25 PM [energy drink].");
});

test("the watch poll defaults to 5 s so poll + LLM stays under the 10 s roast goal", () => {
  assert.equal(loadConfig({}).WATCH_MS, 5000);
});
