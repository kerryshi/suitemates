// The server: transport (terminal or iMessage) + /demo/trigger + scheduler.
//   npm run dev                      → terminal group chat + trigger server + scheduler
//   TRANSPORT=imessage npm run dev   → the three Photon lines
import { createApp } from "./app.ts";
import { ConsoleTransport } from "./console.ts";
import { SpectrumTransport, type Transport } from "./transport.ts";
import { startHttp } from "./http.ts";
import { startScheduler } from "./scheduler.ts";

const app = createApp();
const { config, engine } = app;
console.log(`${config.PRODUCT_NAME} · transport=${config.TRANSPORT} · LLM=${app.llm.name} · MOCK=${config.mock ? 1 : 0}`);
console.log(`personas: ${[...app.personas.keys()].map((id) => `${id}=${config.names[id]}`).join(", ")}`);

const transport: Transport = config.TRANSPORT === "imessage" ? new SpectrumTransport(config) : new ConsoleTransport(app, "group");
startHttp({ engine, transport, port: config.PORT, token: config.DEMO_TOKEN });
startScheduler(app, transport);
await transport.start(async (ev) => {
  for (const o of await engine.handle(ev)) await transport.send(o);
});
