// Keyless, deterministic stand-in for Gemini so everyone can build without an API key.
// Persona chat: calls the first tool whose name words (or, failing that, description words of 5+
// letters) appear in the message, with args = {}, then echoes the tool result. Router: see keywordRoute in core/router.ts.
import type { Tool } from "../types.ts";
import type { LlmClient, LlmMessage, LlmStep } from "./client.ts";

const SKIP = new Set(["get", "list", "set", "the", "for", "my", "and", "check"]);

export class FakeLlm implements LlmClient {
  readonly name = "fake";

  async chat(req: { system: string; messages: LlmMessage[]; tools: Tool[] }): Promise<LlmStep> {
    const last = req.messages.at(-1);
    if (last?.role === "tool") {
      return { text: `(fake LLM) ${last.results.map((r) => `${r.name} → ${r.result}`).join(" | ").slice(0, 600)}` };
    }
    const text = last?.role === "user" ? last.text : "";
    if (text.startsWith("[proactive]")) return { text: `(fake LLM) ${text.replace(/^\[proactive\][^:]*:\s*/, "")}` };
    const tool = pickTool(text, req.tools);
    if (tool) return { toolCalls: [{ name: tool.name, args: {} }] };
    return { text: `(fake LLM) heard "${text.slice(0, 120)}" — no tool matched. Set GEMINI_API_KEY for real replies.` };
  }

  async json(): Promise<string> {
    return "{}";
  }
}

const VAGUE = new Set(["student", "students", "about", "their", "first", "anything", "which", "something", "using"]);

function pickTool(text: string, tools: Tool[]): Tool | undefined {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g)?.map(stem) ?? []);
  const byName = tools.find((t) => t.name.split("_").some((w) => !SKIP.has(w) && words.has(stem(w))));
  if (byName) return byName;
  return tools.find((t) => (t.description.toLowerCase().match(/[a-z]{5,}/g) ?? []).some((w) => !VAGUE.has(w) && words.has(stem(w))));
}

export function stem(w: string): string {
  return w.length > 3 ? w.replace(/(es|s)$/, "") : w;
}
