// Proves the Gemini key, the model name, and function calling, in one run.
//   npm run check-gemini        (needs GEMINI_API_KEY in .env; GEMINI_MODEL optional)
import { loadDotEnv } from "../core/env.ts";
import { GeminiClient } from "../core/llm/gemini.ts";
import type { Tool } from "../core/types.ts";
import type { LlmMessage } from "../core/llm/client.ts";

loadDotEnv();
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY is not set (aistudio.google.com → Get API key)");
  process.exit(1);
}
const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const llm = new GeminiClient(key, model);

const tool: Tool = {
  name: "get_due_assignments",
  description: "List assignments due in the next N days.",
  parameters: { properties: { days: { type: "number", description: "days ahead" } } },
  run: async () => "STOR 435: Problem Set 6, due today 5:00 PM",
};
const system = "You are a helpful study buddy. Use tools for facts. Reply in one short sentence.";
const messages: LlmMessage[] = [{ role: "user", text: "what's due today?" }];

try {
  const first = await llm.chat({ system, messages, tools: [tool] });
  if (!("toolCalls" in first)) {
    console.log(`model=${model} replied WITHOUT calling the tool: ${first.text}`);
    process.exit(2);
  }
  console.log(`1/3 functionCall: ${JSON.stringify(first.toolCalls)}`);
  messages.push({ role: "model", toolCalls: first.toolCalls, raw: first.raw }, { role: "tool", results: [{ name: tool.name, result: await tool.run({}, undefined as never) }] });
  const second = await llm.chat({ system, messages, tools: [tool] });
  console.log(`2/3 final text: ${"text" in second ? second.text : JSON.stringify(second)}`);
  const json = await llm.json({ system: 'Return {"personas": ["social"]} as JSON.', text: "beach trip saturday" });
  console.log(`3/3 json mode: ${json}`);
  console.log(`OK: ${model} works with function calling`);
} catch (err) {
  console.error(`FAILED (${model}): ${err instanceof Error ? err.message : err}`);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`).catch(() => undefined);
  if (res?.ok) {
    const names = ((await res.json()) as { models: { name: string }[] }).models.map((m) => m.name.replace("models/", ""));
    console.error(`flash models this key can see: ${names.filter((n) => n.includes("flash")).join(", ")}\n→ set GEMINI_MODEL in .env`);
  }
  process.exit(1);
}
