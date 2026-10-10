// Hidden demo trigger + health check.
//   curl -X POST localhost:3000/demo/trigger -H 'content-type: application/json' \
//        -d '{"persona":"academic","name":"morning_due","phone":"+19195550001"}'
//   or from a phone browser: GET /demo/trigger?persona=academic&name=morning_due&phone=%2B19195550001
// If DEMO_TOKEN is set, add "token" (JSON or query).
import { createServer } from "node:http";
import type { Engine } from "./engine.ts";
import type { Transport } from "./transport.ts";
import type { PersonaId } from "./types.ts";

export function startHttp(opts: { engine: Engine; transport: Transport; port: number; token?: string }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (url.pathname === "/health") return reply(200, { ok: true });
      if (url.pathname !== "/demo/trigger") return reply(404, { error: "not found" });
      let params: Record<string, string | undefined> = Object.fromEntries(url.searchParams);
      if (req.method === "POST") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        params = { ...params, ...(raw ? JSON.parse(raw) : {}) };
      }
      if (opts.token && params.token !== opts.token) return reply(403, { error: "bad token" });
      if (!params.persona || !params.name) return reply(400, { error: "need persona and name" });
      const outs = await opts.engine.trigger(params.persona as PersonaId, params.name, { phone: params.phone, force: true });
      for (const o of outs) await opts.transport.send(o);
      return reply(200, { sent: outs });
    } catch (err) {
      return reply(500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  server.listen(opts.port, () => console.log(`[http] listening on :${opts.port} (POST /demo/trigger, GET /health)`));
  return server;
}
