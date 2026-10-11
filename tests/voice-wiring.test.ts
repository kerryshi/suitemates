// The 1-emoji cap is applied where texts leave the process (both transports' send) and where a reply enters
// history (core/agent.ts respond). Emoji are counted here with a local helper, not core/voice.ts, so these
// fail on the assertion (2 !== 1) when the wiring is missing, not on an import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpectrumTransport } from "../core/transport.ts";
import { ConsoleTransport } from "../core/console.ts";
import { loadConfig } from "../core/config.ts";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import type { App } from "../core/app.ts";
import type { LlmClient } from "../core/llm/client.ts";
import type { Outbound } from "../core/types.ts";

const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
const emojiIn = (s: string) =>
  [...seg.segment(s)].filter(({ segment: g }) => /\p{Emoji_Presentation}/u.test(g) || (/\p{Extended_Pictographic}/u.test(g) && g.includes("️")) || /^[0-9#*]️?⃣$/.test(g)).length;

const names = { academic: "Dean", financial: "Penny", social: "Sunny" };

// Same shape as tests/transport.test.ts sendVia: a fake space in the private cache, so no Spectrum app is needed.
type Peek = { spaces: Map<string, { id: string; send(t: string): Promise<unknown> }>; recentlySent: { text: string }[]; send(o: Outbound): Promise<void> };
const sendVia = async (env: Record<string, string>, o: Outbound) => {
  const t = new SpectrumTransport(loadConfig(env)) as unknown as Peek;
  const sent: string[] = [];
  t.spaces.set(`${o.persona}|${o.handle}`, { id: "s", send: async (text) => void sent.push(text) });
  await t.send(o);
  return { sent, t };
};

test("SpectrumTransport sends at most one emoji, and the echo buffer holds the text that went out", async () => {
  const { sent, t } = await sendVia({ DEFAULT_PERSONA: "social" }, { persona: "financial", handle: "dm:+19195550001", text: "we move 💸 😭" });
  assert.equal(emojiIn(sent[0] ?? ""), 1);
  assert.deepEqual(sent, ["Penny: we move 💸"]);
  assert.equal(t.recentlySent[0].text, "Penny: we move 💸", "an echo of the capped text must be recognised as ours");
  // The plain-facts fallback (engine.ts) goes out raw: still one emoji on the wire.
  const fallback = await sendVia({ DEFAULT_PERSONA: "social" }, { persona: "academic", handle: "space-1", text: "⏰ STOR 435 PS6 is due today 5:00 PM. don't make me ask twice 😤" });
  assert.equal(emojiIn(fallback.sent[0] ?? ""), 1);
});

test("ConsoleTransport prints at most one emoji", async () => {
  const t = new ConsoleTransport({ config: { names } } as unknown as App, "social");
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    await t.send({ persona: "social", handle: "dm-x@social", text: "hey 🌞 what's up 😂" });
  } finally {
    console.log = log;
  }
  assert.equal(lines.length, 1);
  assert.equal(emojiIn(lines[0]), 1);
  assert.ok(lines[0].endsWith("hey 🌞 what's up"), lines[0]);
});

test("a model reply with two emoji: one reaches the student and one is stored in history", async () => {
  const llm: LlmClient = { name: "spy", chat: async () => ({ text: "hey 🌞 what's the move 😂" }), json: async () => "{}" };
  const store = new Store(null);
  const engine = new Engine({ personas: loadPersonas(), store, llm, config: { names, PRODUCT_NAME: "Suitemates", mock: true }, log: () => {} });
  const sender = "+19195550123";
  store.saveUser({ phone: sender, name: "Kerry", canvasLinked: true, onboardingStep: "done" });
  const out = await engine.handle({ persona: "social", sender, text: "hey", handle: "h", messageId: "1" });
  assert.equal(emojiIn(out[0].text), 1);
  assert.equal(emojiIn(store.history("social", sender).at(-1)!.text), 1);
});
