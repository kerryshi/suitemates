// "(no reply)" reached a real phone 3 times (Penny x2, Dean x1, 01:58-02:05): the agent used its 3 tool rounds, the
// final no-tools call came back with yet another tool call, and core sent the literal "(no reply)".
import { test } from "node:test";
import assert from "node:assert/strict";
import { respond } from "../core/agent.ts";
import { GeminiClient } from "../core/llm/gemini.ts";
import { loadPersonas } from "../core/personas.ts";
import type { LlmClient } from "../core/llm/client.ts";

const names = { academic: "Dean", financial: "Penny", social: "Sunny" };
const ctx = { user: { phone: "+1", canvasLinked: true, onboardingStep: "done" as const }, mock: true, now: new Date(), kv: { get: () => undefined, set: () => {} }, log: () => {} };

test("the last step after the tool rounds forbids tools (so the model answers in text) and never yields '(no reply)'", async () => {
  const seen: { tools: number; noTools?: boolean }[] = [];
  const loopy: LlmClient = {
    name: "loopy",
    json: async () => "{}",
    chat: async (req) => {
      seen.push({ tools: req.tools.length, noTools: req.noTools });
      return req.noTools ? { text: "here's the answer" } : { toolCalls: [{ name: "get_due_assignments", args: {} }] };
    },
  };
  const out = await respond({ persona: loadPersonas().get("academic")!, ctx, llm: loopy, history: [], text: "what's due?", setting: "recruit", product: "Suitemates", names });
  assert.equal(out, "here's the answer");
  const last = seen.at(-1)!;
  assert.equal(last.noTools, true, "final call says: no more tools");
  assert.ok(last.tools > 0, "the client gets the tools (it decides how to forbid them)");
});

test("if the model still has nothing to say, respond throws (callers fall back) instead of returning '(no reply)'", async () => {
  const stubborn: LlmClient = { name: "stubborn", json: async () => "{}", chat: async () => ({ toolCalls: [{ name: "get_due_assignments", args: {} }] }) };
  await assert.rejects(
    respond({ persona: loadPersonas().get("academic")!, ctx, llm: stubborn, history: [], text: "what's due?", setting: "dm", product: "Suitemates", names }),
    /no text/,
  );
});

test("Gemini noTools keeps the student's photo (a receipt after 3 tool rounds is still visible)", async () => {
  let body: { contents?: { role: string; parts: Record<string, unknown>[] }[] } = {};
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "that's a $14 receipt" }] } }] }));
  }) as unknown as typeof fetch;
  try {
    const g = new GeminiClient("k", "m");
    const messages = [
      { role: "user" as const, text: "", image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" } },
      { role: "model" as const, toolCalls: [{ name: "get_recent_purchases", args: {} }] },
      { role: "tool" as const, results: [{ name: "get_recent_purchases", result: "budget left $300" }] },
    ];
    await g.chat({ system: "s", messages, tools: loadPersonas().get("financial")!.tools, noTools: true });
    assert.match(JSON.stringify(body.contents), /inline_data/, "the image reaches the answer-now request");
  } finally {
    globalThis.fetch = real;
  }
});

test("Gemini noTools: no tool declarations, the tool calls and results flattened to text, and stray calls ignored", async () => {
  // Live 02:25: gemini-3.6-flash ignores functionCallingConfig NONE and answers with invented tools
  // (canvas__get_todo_items, google_calendar__list_events). Flattened history with no tools: 3/3 plain text.
  let body: { tools?: unknown[]; toolConfig?: unknown; contents?: { role: string; parts: Record<string, unknown>[] }[] } = {};
  let reply: unknown[] = [{ text: "ok" }];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: reply } }] }));
  }) as unknown as typeof fetch;
  try {
    const g = new GeminiClient("k", "m");
    const tools = loadPersonas().get("academic")!.tools;
    const messages = [
      { role: "user" as const, text: "what's due?" },
      { role: "model" as const, toolCalls: [{ name: "get_due_assignments", args: {} }], raw: [{ functionCall: { name: "get_due_assignments", args: {} } }] },
      { role: "tool" as const, results: [{ name: "get_due_assignments", result: "PS6 due Fri" }] },
    ];
    await g.chat({ system: "s", messages, tools, noTools: true });
    assert.equal(body.tools, undefined, "no tool declarations");
    assert.equal(body.toolConfig, undefined);
    const parts = body.contents!.flatMap((c) => c.parts);
    assert.ok(parts.every((p) => !("functionCall" in p) && !("functionResponse" in p)), "history flattened to text");
    assert.match(JSON.stringify(body.contents!.at(-1)), /PS6 due Fri[\s\S]*Do not call any tools/);
    reply = [{ functionCall: { name: "canvas__get_todo_items", args: {} } }, { text: "PS6 is due friday." }];
    const mixed = await g.chat({ system: "s", messages, tools, noTools: true });
    assert.deepEqual(mixed, { text: "PS6 is due friday." }, "a stray call next to text is ignored");
    reply = [{ functionCall: { name: "canvas__get_todo_items", args: {} } }];
    await assert.rejects(g.chat({ system: "s", messages, tools, noTools: true }), /no text/);
    reply = [{ text: "ok" }];
    await g.chat({ system: "s", messages: [{ role: "user", text: "hi" }], tools });
    assert.ok(Array.isArray(body.tools), "normal calls unchanged");
  } finally {
    globalThis.fetch = real;
  }
});
