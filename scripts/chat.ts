// Talk to any persona, or the group chat, in the terminal. No phone, no keys needed.
//   npm run chat -- academic | financial | social | group
// Keyless = fake LLM (deterministic). Set GEMINI_API_KEY in .env for real replies.
import { loadDotEnv } from "../core/env.ts";
import { createApp } from "../core/app.ts";
import { ConsoleTransport } from "../core/console.ts";
import { PERSONA_IDS, type PersonaId } from "../core/types.ts";

loadDotEnv();
const mode = (process.argv[2] ?? "group") as PersonaId | "group";
if (mode !== "group" && !PERSONA_IDS.includes(mode)) {
  console.error(`usage: npm run chat -- ${PERSONA_IDS.join(" | ")} | group`);
  process.exit(1);
}

const app = createApp({ storeFile: process.env.CHAT_STATE ?? "data/chat-state.json" });
console.log(`${app.config.PRODUCT_NAME} chat · LLM=${app.llm.name} · MOCK=${app.config.mock ? 1 : 0} · state=data/chat-state.json\n`);
const t = new ConsoleTransport(app, mode);
await t.start(async (ev) => {
  for (const o of await app.engine.handle(ev)) await t.send(o);
});
