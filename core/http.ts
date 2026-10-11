// HTTP: sign-up page + admin, hidden demo trigger, health check.
//   GET  /                → web/index.html (sign-up form)       POST /signup  {name, phone, budget, goal, interests[], canvas}
//   GET  /admin           → web/admin.html (sign-ups + "send intro")
//   GET  /admin/signups   → JSON list                           POST /admin/intro {phone} → each persona's intro text
//   curl -X POST localhost:3000/demo/trigger -H 'content-type: application/json' \
//        -d '{"persona":"academic","name":"morning_due","phone":"+19195550001"}'
//   or from a phone browser: GET /demo/trigger?persona=academic&name=morning_due&phone=%2B19195550001
// If DEMO_TOKEN is set, /admin* and /demo/trigger need "token" (JSON or query). /signup is open.
import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Engine } from "./engine.ts";
import type { Transport } from "./transport.ts";
import type { PersonaId } from "./types.ts";
import { cardFor, introTexts, normalizePhone, parseSignup } from "./signup.ts";
import { photonCliAddUser, type AddUser } from "./photon-users.ts";
import { calToken, calendarItems, toIcs } from "./calendar.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AVATARS = new Set(["dean", "penny", "sunny", "dean-icon", "penny-icon", "sunny-icon"]);
const MAX_BODY = 16_384;

function file(res: ServerResponse, path: string, type: string) {
  res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
  res.end(readFileSync(path));
}

export function startHttp(opts: { engine: Engine; transport: Transport; port: number; token?: string; addUser?: AddUser }) {
  const addUser = opts.addUser ?? photonCliAddUser;
  const { engine, transport } = opts;
  const store = engine.d.store;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const path = url.pathname;
      if (path === "/health") return reply(200, { ok: true });
      if (req.method === "GET" && path === "/") return file(res, join(ROOT, "web", "index.html"), "text/html; charset=utf-8");
      // The student's shared calendar feed (core/calendar.ts): private link, Google Calendar subscribes to it.
      const cal = /^\/cal\/([\w-]{24})\.ics$/.exec(path);
      if (req.method === "GET" && cal) {
        const user = store.allUsers().find((u) => calToken(u.phone) === cal[1]);
        if (!user) return reply(404, { error: "not found" });
        const ics = toIcs(await calendarItems(engine, user.phone), `${engine.d.config.PRODUCT_NAME}${user.name ? ` · ${user.name}` : ""}`);
        res.writeHead(200, { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache" });
        return res.end(ics);
      }
      // One sign-up page per agent (its own QR): /join/academic, /join/financial, /join/social. /qr was the old poster.
      if (req.method === "GET" && /^\/join\/(academic|financial|social)\/?$/.test(path)) return file(res, join(ROOT, "web", "join.html"), "text/html; charset=utf-8");
      if (req.method === "GET" && path === "/qr") return file(res, join(ROOT, "web", "index.html"), "text/html; charset=utf-8");
      if (req.method === "GET" && path === "/admin") return file(res, join(ROOT, "web", "admin.html"), "text/html; charset=utf-8");
      const avatar = /^\/avatars\/([a-z-]+)\.png$/.exec(path);
      if (req.method === "GET" && avatar && AVATARS.has(avatar[1])) return file(res, join(ROOT, "docs", "avatars", `${avatar[1]}.png`), "image/png");

      let params: Record<string, unknown> = Object.fromEntries(url.searchParams);
      if (req.method === "POST") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > MAX_BODY) return reply(413, { error: "too large" });
        }
        params = { ...params, ...(raw ? JSON.parse(raw) : {}) };
      }

      if (path === "/signup") {
        if (req.method !== "POST") return reply(405, { error: "POST only" });
        const phone = normalizePhone(params.phone);
        if (!phone) return reply(400, { error: "Enter a 10-digit US phone number." });
        const r = parseSignup(params, store.user(phone));
        if ("error" in r) return reply(400, r);
        // Put them on the Photon allowlist so their first text gets through, and find the number they text.
        const fresh = r.user.signupStatus === "pending";
        const added = fresh ? await addUser(phone, r.user.name ?? "") : { ok: true };
        const user = { ...r.user, ...(fresh && added.ok ? { signupStatus: "added" as const } : {}) };
        store.saveUser(user);
        const textTo = ("line" in added ? added.line : undefined) || process.env.POOL_NUMBER || undefined;
        const why = "error" in added && added.error ? `; photon: ${added.error}` : "";
        console.log(`[signup] ${user.name} ${phone} (${user.signupStatus}${why})`);
        return reply(200, { ok: true, name: user.name, status: user.signupStatus, textTo });
      }

      const authed = !opts.token || params.token === opts.token;
      if (path === "/admin/signups") {
        if (!authed) return reply(403, { error: "bad token" });
        const users = store
          .allUsers()
          .filter((u) => u.signedUpAt)
          .sort((a, b) => (b.signedUpAt ?? "").localeCompare(a.signedUpAt ?? ""))
          .map(({ phone, name, budgetMonthly, savingsGoal, interests, focus, win, canvasLinked, signupStatus, signedUpAt }) =>
            ({ phone, name, budgetMonthly, savingsGoal, interests, focus, win, canvasLinked, signupStatus, signedUpAt }));
        return reply(200, { users });
      }
      if (path === "/admin/intro") {
        if (req.method !== "POST") return reply(405, { error: "POST only" });
        if (!authed) return reply(403, { error: "bad token" });
        const phone = normalizePhone(params.phone);
        if (!phone || !store.user(phone).signedUpAt) return reply(404, { error: "no sign-up for that phone" });
        const agents = store.user(phone).agents ?? (["academic", "financial", "social"] as PersonaId[]);
        const outs = await introTexts(engine, phone, agents);
        for (const o of outs) await transport.send(o);
        const u = store.user(phone);
        store.saveUser({ ...u, signupStatus: "invited", greeted: [...new Set([...(u.greeted ?? []), ...agents])] });
        return reply(200, { sent: outs.length });
      }

      if (path !== "/demo/trigger") return reply(404, { error: "not found" });
      if (!authed) return reply(403, { error: "bad token" });
      if (!params.persona || !params.name) return reply(400, { error: "need persona and name" });
      const outs = await engine.trigger(params.persona as PersonaId, String(params.name), {
        phone: params.phone ? String(params.phone) : undefined,
        force: true,
      });
      // An intro always comes with that persona's contact card.
      if (params.name === "intro" && params.phone) outs.push(cardFor(engine, params.persona as PersonaId, normalizePhone(params.phone) ?? String(params.phone)));
      for (const o of outs) await transport.send(o);
      return reply(200, { sent: outs });
    } catch (err) {
      return reply(500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  server.listen(opts.port, () =>
    console.log(`[http] listening on :${opts.port} (GET / sign-up, /admin, POST /demo/trigger, GET /health)`),
  );
  return server;
}
