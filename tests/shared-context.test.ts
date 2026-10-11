// Agents planning together: Persona.context lines reach the OTHER agents' prompts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import type { LlmClient, LlmMessage } from "../core/llm/client.ts";
import type { Inbound, PersonaId } from "../core/types.ts";

const names = { academic: "Dean", financial: "Penny", social: "Sunny" };

function setup() {
  const calls: { who: string; system: string; last: string }[] = [];
  const llm: LlmClient = {
    name: "spy",
    async chat({ system, messages }) {
      const who = /You are (\w+),/.exec(system)?.[1] ?? "?";
      const last = (messages.at(-1) as Extract<LlmMessage, { role: "user" }>).text;
      calls.push({ who, system, last });
      return { text: who === "Sunny" ? "soccer sunday 4pm, you in?" : `${who} reply` };
    },
    json: async () => "{}",
  };
  const personas = loadPersonas();
  const store = new Store(null);
  store.saveUser({ phone: "+1", canvasLinked: true, onboardingStep: "done" });
  const engine = new Engine({
    personas,
    store,
    llm,
    config: { names, PRODUCT_NAME: "Suitemates", mock: true },
    log: () => {},
  });
  const dm = (persona: PersonaId, text: string) => engine.handle({ persona, sender: "+1", text, handle: `h-${persona}`, messageId: `m-${persona}` } as Inbound);
  return { engine, calls, personas, dm };
}

test("Dean's context reaches Sunny's and Penny's prompts, not his own", async () => {
  const s = setup();
  await s.dm("social", "what's the plan");
  await s.dm("academic", "what's the plan");
  const sunny = s.calls.find((c) => c.who === "Sunny")!;
  const dean = s.calls.find((c) => c.who === "Dean")!;
  assert.match(sunny.system, /What the others know .*Dean: \d+ things due in the next 4 days.*next exam: /);
  assert.doesNotMatch(dean.system, /Dean: \d+ things due/);
  assert.doesNotMatch(sunny.system, /\d+(\.\d)?%/); // no grades shared
});

test("a failing context is skipped, the reply still goes out", async () => {
  const s = setup();
  const dean = s.personas.get("academic")!;
  const real = dean.context;
  dean.context = async () => {
    throw new Error("Canvas down");
  };
  try {
    const outs = await s.dm("social", "anyone free");
    assert.equal(outs.length, 1);
    assert.equal(outs[0].text, "soccer sunday 4pm, you in?");
    assert.doesNotMatch(s.calls[0].system, /What the others know/);
  } finally {
    dean.context = real; // persona modules are shared within this test process
  }
});

test("a proactive text is framed as coming from us, not the student, and sees only the last few turns", async () => {
  const { respond } = await import("../core/agent.ts");
  let seen: LlmMessage[] = [];
  await respond({
    persona: loadPersonas().get("academic")!,
    ctx: { user: { phone: "+1", canvasLinked: true, onboardingStep: "done" }, mock: true, now: new Date(), kv: { get: () => undefined, set: () => {} }, log: () => {} },
    llm: { name: "spy", chat: async (req) => ((seen = req.messages), { text: "ok" }), json: async () => "{}" },
    history: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? ("model" as const) : ("user" as const), text: `turn ${i}` })),
    text: "[proactive] intro: Hey, I'm Dean.",
    setting: "proactive",
    product: "Suitemates",
    names,
  });
  assert.equal(seen.length, 5); // 4 history turns + the instruction
  const last = seen.at(-1) as Extract<LlmMessage, { role: "user" }>;
  assert.match(last.text, /^\[proactive\] intro: Hey, I'm Dean\.\n\n\(This line is from Suitemates, not from the student/);
});
