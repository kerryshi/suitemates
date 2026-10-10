// One persona turn: system prompt + history + message → tool loop → reply text.
import type { Ctx, Persona } from "./types.ts";
import type { LlmClient, LlmMessage } from "./llm/client.ts";
import type { Turn } from "./store.ts";

const MAX_TOOL_ROUNDS = 3;
const TOOL_TIMEOUT_MS = 10_000;

export type Setting = "dm" | "group" | "proactive";

export interface RespondArgs {
  persona: Persona;
  ctx: Ctx;
  llm: LlmClient;
  history: Turn[];
  text: string;
  image?: { bytes: Uint8Array; mimeType: string };
  setting: Setting;
  product: string;
  names: Record<string, string>; // persona id → display name
}

export async function respond(a: RespondArgs): Promise<string> {
  const system = `${a.persona.prompt.trim()}\n\n${contextBlock(a)}`;
  const messages: LlmMessage[] = [
    ...a.history.map((t): LlmMessage => (t.role === "user" ? { role: "user", text: t.text } : { role: "model", text: t.text })),
    { role: "user", text: a.text, image: a.image },
  ];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const step = await a.llm.chat({ system, messages, tools: a.persona.tools });
    if ("text" in step) return step.text;
    messages.push({ role: "model", toolCalls: step.toolCalls, raw: step.raw });
    const results = [];
    for (const call of step.toolCalls) results.push({ name: call.name, result: await runTool(a.persona, call, a.ctx) });
    messages.push({ role: "tool", results });
  }
  const last = await a.llm.chat({ system, messages, tools: [] });
  return "text" in last ? last.text : "(no reply)";
}

async function runTool(persona: Persona, call: { name: string; args: Record<string, unknown> }, ctx: Ctx): Promise<string> {
  const tool = persona.tools.find((t) => t.name === call.name);
  if (!tool) return `error: no tool named ${call.name}`;
  ctx.log(`tool ${call.name}(${JSON.stringify(call.args)})`);
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("timed out")), TOOL_TIMEOUT_MS)));
    const out = await Promise.race([tool.run(call.args ?? {}, ctx), timeout]).finally(() => clearTimeout(timer));
    return typeof out === "string" ? out : JSON.stringify(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log(`tool ${call.name} failed: ${msg}`);
    return `error: ${msg}`;
  }
}

function contextBlock(a: RespondArgs): string {
  const me = a.names[a.persona.id];
  const others = Object.entries(a.names)
    .filter(([id]) => id !== a.persona.id)
    .map(([id, n]) => `${n} (${id})`)
    .join(" and ");
  const u = a.ctx.user;
  const setting = {
    dm: "a 1:1 iMessage conversation with the user.",
    group: `the group chat with the user, ${others}. Speak ONLY about your own area; the others cover theirs. One short text.`,
    proactive: "a text you are sending first, unprompted. One short text; no question unless it helps.",
  }[a.setting];
  return [
    "## Context (written by core — do not repeat it back)",
    `- You are ${me}, one of three texting agents in ${a.product}, alongside ${others}.`,
    `- Setting: ${setting}`,
    `- Now: ${a.ctx.now.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
    `- User: ${u.name ?? "unknown name"}; monthly budget ${u.budgetMonthly ? `$${u.budgetMonthly}` : "unknown"}; saving for: ${u.savingsGoal ?? "unknown"}.`,
    "- Write like a text message: 1–3 short sentences, lowercase is fine, no markdown, no headings.",
    "- Get facts from your tools. Never invent numbers, dates, or names.",
  ].join("\n");
}
