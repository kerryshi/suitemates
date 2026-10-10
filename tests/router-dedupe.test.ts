import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine, DEDUPE_TTL_MS } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import { keywordRoute } from "../core/router.ts";
import type { LlmClient } from "../core/llm/client.ts";
import type { Inbound, PersonaId } from "../core/types.ts";

const names = { academic: "Oak", financial: "Clover", social: "Breeze" };

function setup(routeTo: PersonaId[]) {
  let clock = 1_000_000;
  const calls = { route: 0 };
  const llm: LlmClient = {
    name: "spy",
    chat: async () => ({ text: "reply" }),
    json: async () => {
      calls.route++;
      return JSON.stringify({ personas: routeTo });
    },
  };
  const store = new Store(null);
  store.saveUser({ phone: "+1", canvasLinked: true, onboardingStep: "done" });
  const engine = new Engine({
    personas: loadPersonas(),
    store,
    llm,
    config: { names, PRODUCT_NAME: "Canopy", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 30 },
    routerPrompt: "{{ROUTER_LINES}}",
    now: () => clock,
    log: () => {},
  });
  const copy = (p: PersonaId, text: string, n = 1): Inbound => ({
    persona: p, kind: "group", sender: "+1", text, handle: `h-${p}`, messageId: `m${n}-${p}`,
  });
  const all = (text: string, n = 1) => Promise.all((["academic", "financial", "social"] as const).map((p) => engine.handle(copy(p, text, n))));
  return { engine, calls, copy, all, advance: (ms: number) => (clock += ms) };
}

test("three line copies of one group message run the router once", async () => {
  const s = setup(["financial"]);
  const outs = (await s.all("can I afford the beach trip")).flat();
  assert.equal(s.calls.route, 1);
  assert.deepEqual(outs, [{ persona: "financial", handle: "h-financial", text: "reply" }]);
});

test("each chosen persona replies through its own line's handle", async () => {
  const s = setup(["social", "financial", "academic"]);
  const outs = (await s.all("I'm going on the beach trip Saturday")).flat();
  assert.equal(s.calls.route, 1);
  assert.deepEqual(outs.map((o) => [o.persona, o.handle]), [["social", "h-social"], ["financial", "h-financial"], ["academic", "h-academic"]]);
});

test("the same text after the dedupe window is a new message", async () => {
  const s = setup(["social"]);
  await s.all("anyone down for soccer", 1);
  s.advance(DEDUPE_TTL_MS + 5_000);
  await s.all("anyone down for soccer", 2);
  assert.equal(s.calls.route, 2);
});

test("a chosen persona whose line got no copy speaks through another line, name-tagged", async () => {
  const s = setup(["social"]);
  const outs = (await Promise.all([s.engine.handle(s.copy("academic", "beach?")), s.engine.handle(s.copy("financial", "beach?"))])).flat();
  assert.equal(outs.length, 1);
  assert.equal(outs[0].persona, "academic");
  assert.equal(outs[0].text, "Breeze: reply");
});

test("keyword routing (keyless mode) wakes Social for the beach trip and nobody for small talk", () => {
  const personas = loadPersonas();
  assert.ok(keywordRoute("I'm going on the beach trip Saturday", personas).includes("social"));
  assert.deepEqual(keywordRoute("lol ok", personas), []);
});
