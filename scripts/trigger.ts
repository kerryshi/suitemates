// Fire a proactive message.
//   npm run trigger -- academic morning_due [+19195550001]
// Without SERVER_URL: runs locally and prints the text (keyless OK).
// With SERVER_URL=http://localhost:3000: asks the running server to send it for real.
import { loadDotEnv } from "../core/env.ts";
import { createApp } from "../core/app.ts";
import { DEMO_USER } from "../core/console.ts";
import type { PersonaId } from "../core/types.ts";

loadDotEnv();
const [persona, name, phone = DEMO_USER] = process.argv.slice(2);
if (!persona || !name) {
  console.error("usage: npm run trigger -- <academic|financial|social> <trigger name|watch> [phone]");
  process.exit(1);
}

if (process.env.SERVER_URL) {
  const res = await fetch(`${process.env.SERVER_URL}/demo/trigger`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ persona, name, phone, token: process.env.DEMO_TOKEN }),
  });
  console.log(res.status, await res.text());
} else {
  const app = createApp({ storeFile: process.env.CHAT_STATE ?? "data/chat-state.json" });
  const outs = await app.engine.trigger(persona as PersonaId, name, { phone, force: true });
  if (outs.length === 0) console.log("(no events)");
  for (const o of outs) console.log(`[${app.config.names[o.persona]}] → ${o.handle}: ${o.text}`);
}
