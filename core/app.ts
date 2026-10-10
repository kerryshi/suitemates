// Wires config → personas → store → LLM → engine. Used by core/main.ts, scripts/chat.ts and scripts/trigger.ts.
import { loadConfig, type Config } from "./config.ts";
import { loadPersonas, loadRouterPrompt } from "./personas.ts";
import { Store } from "./store.ts";
import { Engine } from "./engine.ts";
import { FakeLlm } from "./llm/fake.ts";
import { GeminiClient } from "./llm/gemini.ts";
import type { LlmClient } from "./llm/client.ts";

export function createApp(opts: { config?: Config; storeFile?: string | null } = {}) {
  const config = opts.config ?? loadConfig();
  const personas = loadPersonas();
  const store = new Store(opts.storeFile === undefined ? config.DATA_FILE : opts.storeFile);
  const llm: LlmClient = config.fakeLlm ? new FakeLlm() : new GeminiClient(config.GEMINI_API_KEY!, config.GEMINI_MODEL);
  const engine = new Engine({ personas, store, llm, config, routerPrompt: loadRouterPrompt() });
  return { config, personas, store, llm, engine };
}

export type App = ReturnType<typeof createApp>;
