// Personas planning together: Persona.context lines reach the OTHER personas' prompts, and in the group chat
// each persona sees what the earlier ones just said (router order).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import type { LlmClient, LlmMessage } from "../core/llm/client.ts";
import type { Inbound, PersonaId } from "../core/types.ts";

const names = { academic: "Dean", financial: "Penny", social: "Sunny" };

function setup(route: PersonaId[]) {
  const calls: { who: string; system: string; last: string }[] = [];
  const llm: LlmClient = {
    name: "spy",
    async chat({ system, messages }) {
      const who = /You are (\w+),/.exec(system)?.[1] ?? "?";
      const last = (messages.at(-1) as Extract<LlmMessage, { role: "user" }>).text;
      calls.push({ who, system, last });
      return { text: who === "Sunny" ? "soccer sunday 4pm, you in?" : `${who} reply` };
    },
    json: async () => JSON.stringify({ personas: route }),
  };
  const personas = loadPersonas();
  const store = new Store(null);
  store.saveUser({ phone: "+1", canvasLinked: true, onboardingStep: "done" });
  const engine = new Engine({
    personas,
    store,
    llm,
    config: { names, PRODUCT_NAME: "Suitemates", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 20 },
    routerPrompt: "{{ROUTER_LINES}}",
    log: () => {},
  });
  const group = (text: string) =>
    Promise.all((["academic", "financial", "social"] as const).map((p) =>
      engine.handle({ persona: p, kind: "group", sender: "+1", text, handle: `h-${p}`, messageId: `m-${p}` } as Inbound),
    ));
  return { engine, calls, personas, group };
}

test("in the group, Dean sees Sunny's plan from this round before he answers", async () => {
  const s = setup(["social", "academic"]);
  const outs = (await s.group("anyone down for something this weekend")).flat();
  assert.deepEqual(outs.map((o) => o.persona), ["social", "academic"]);
  const sunny = s.calls.find((c) => c.who === "Sunny")!;
  const dean = s.calls.find((c) => c.who === "Dean")!;
  assert.equal(sunny.last, "anyone down for something this weekend");
  assert.match(dean.last, /Already said in this chat just now: Sunny: "soccer sunday 4pm, you in\?"/);
});

test("Dean's context reaches Sunny's and Penny's prompts, not his own", async () => {
  const s = setup(["social", "academic"]);
  await s.group("what's the plan");
  const sunny = s.calls.find((c) => c.who === "Sunny")!;
  const dean = s.calls.find((c) => c.who === "Dean")!;
  assert.match(sunny.system, /What the others know .*Dean: \d+ things due in the next 4 days.*next exam: /);
  assert.doesNotMatch(dean.system, /Dean: \d+ things due/);
  assert.doesNotMatch(sunny.system, /\d+(\.\d)?%/); // no grades shared
});

test("a failing context is skipped, the reply still goes out", async () => {
  const s = setup(["social"]);
  const dean = s.personas.get("academic")!;
  const real = dean.context;
  dean.context = async () => {
    throw new Error("Canvas down");
  };
  try {
    const outs = (await s.group("anyone free")).flat();
    assert.equal(outs.length, 1);
    assert.equal(outs[0].text, "soccer sunday 4pm, you in?");
    assert.doesNotMatch(s.calls[0].system, /What the others know/);
  } finally {
    dean.context = real; // persona modules are shared within this test process
  }
});
