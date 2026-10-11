// One persona turn: system prompt + history + message → tool loop → reply text.
import type { Ctx, Persona } from "./types.ts";
import type { LlmClient, LlmMessage } from "./llm/client.ts";
import type { Turn } from "./store.ts";
import { capEmoji } from "./voice.ts";

const MAX_TOOL_ROUNDS = 3;
const TOOL_TIMEOUT_MS = 10_000;
const PROACTIVE_HISTORY = 4; // turns of chat a proactive text sees (enough to not repeat itself)

export type Setting = "dm" | "proactive" | "recruit";

const FOCUS = { school: "ace their classes", money: "save money", social: "meet people", balance: "keep school, money and social life balanced" };

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
  shared?: string[]; // what the other personas know ("Dean: midterm Wednesday"), from Persona.context
}

export async function respond(a: RespondArgs): Promise<string> {
  const system = `${a.persona.prompt.trim()}\n\n${contextBlock(a)}`;
  // A proactive text is an instruction from us, not something the student said. Without saying so, a model with
  // the real chat history in front of it answers the facts as if the student pasted them ("sending my old intro
  // back at me?") or returns nothing. A short history keeps it from re-answering old turns.
  const proactive = a.setting === "proactive";
  const text = proactive
    ? `${a.text}\n\n(This line is from ${a.product}, not from the student: they haven't said anything new. ` +
      "Turn these facts into the one text you're sending them now, in your voice. Don't reply to it as a message.)"
    : a.text;
  // A recruit handoff is also a text sent first: same short history, but with tools (it answers a real question).
  const history = proactive || a.setting === "recruit" ? a.history.slice(-PROACTIVE_HISTORY) : a.history;
  const messages: LlmMessage[] = [
    ...history.map((t): LlmMessage => (t.role === "user" ? { role: "user", text: t.text } : { role: "model", text: t.text })),
    { role: "user", text, image: a.image },
  ];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Proactive texts carry complete facts: no tool round, so a purchase roast lands fast.
    const step = await a.llm.chat({ system, messages, tools: a.setting === "proactive" ? [] : a.persona.tools });
    // Capped here too, so history holds what the student saw (a 2-emoji model turn is an example it copies).
    if ("text" in step) return capEmoji(step.text);
    messages.push({ role: "model", toolCalls: step.toolCalls, raw: step.raw });
    const results = [];
    for (const call of step.toolCalls) results.push({ name: call.name, result: await runTool(a.persona, call, a.ctx) });
    messages.push({ role: "tool", results });
  }
  const last = await a.llm.chat({ system, messages, tools: [] });
  return "text" in last ? capEmoji(last.text) : "(no reply)";
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
    proactive: "a text you are sending first, unprompted. One short text; no question unless it helps.",
    recruit:
      "a text you are sending first, from your own number, because another agent just brought you in (the brief says why). " +
      "Your hello was already sent. Answer the question with your tools in one or two short lines.",
  }[a.setting];
  return [
    "## Context (written by core — do not repeat it back)",
    `- You are ${me}, one of three texting agents in ${a.product}, alongside ${others}.`,
    `- Setting: ${setting}`,
    `- Now: ${a.ctx.now.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
    `- User: ${u.name ?? "unknown name"}; monthly budget ${u.budgetMonthly ? `$${u.budgetMonthly}` : "unknown"}; saving for: ${u.savingsGoal ?? "unknown"}.`,
    ...(u.focus || u.win
      ? [`- This semester they're mostly trying to: ${FOCUS[u.focus ?? "balance"]}${u.win ? `; a win would be: "${u.win}"` : ""}. Lean your advice that way.`]
      : []),
    ...(a.shared?.length ? [`- What the others know (use it to plan together; don't recite it): ${a.shared.join(" | ")}`] : []),
    "- Text like their friend, not a notification or reminder app: usually one short line (two max), lowercase, no markdown, no headings, no lists, never start with Reminder:/Heads up:/Alert:. Emoji: usually none, at most one, never as a sign-off at the end of a text. End with a question only when you need an answer.",
    "- Get facts from your tools. Never invent numbers, dates, or names.",
  ].join("\n");
}
