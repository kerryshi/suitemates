// The one LLM interface. Gemini in production, a deterministic fake when there's no key.
import type { Tool } from "../types.ts";

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export type LlmMessage =
  | { role: "user"; text: string; image?: { bytes: Uint8Array; mimeType: string } }
  | { role: "model"; text: string }
  // `raw` = the provider's own parts, echoed back verbatim (Gemini needs its thought signatures)
  | { role: "model"; toolCalls: ToolCall[]; raw?: unknown[] }
  | { role: "tool"; results: { name: string; result: string }[] };

export type LlmStep = { text: string } | { toolCalls: ToolCall[]; raw?: unknown[] };

export interface LlmClient {
  readonly name: string;
  chat(req: { system: string; messages: LlmMessage[]; tools: Tool[] }): Promise<LlmStep>;
  // JSON-mode completion; returns the raw JSON text.
  json(req: { system: string; text: string }): Promise<string>;
}
