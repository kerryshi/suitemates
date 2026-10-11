// HTTP: sign-up page + admin, hidden demo trigger, health check.
//   GET  /                → web/index.html (sign-up form)       POST /signup  {name, phone, budget, goal, interests[], canvas}
//   GET  /admin           → web/admin.html (sign-ups + "send intro")
//   GET  /admin/signups   → JSON list                           POST /admin/intro {phone} → each persona's intro text
//   curl -X POST localhost:3000/demo/trigger -H 'content-type: application/json' \
//        -d '{"persona":"academic","name":"morning_due","phone":"+19195550001"}'
//   or from a phone browser: GET /demo/trigger?persona=academic&name=morning_due&phone=%2B19195550001
// If DEMO_TOKEN is set, /admin* and /demo/trigger need "token" (JSON or query). Without it they answer local requests
// only, never ones that came through the tunnel (Cloudflare adds cf-connecting-ip / x-forwarded-for). /signup is open.
import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Engine } from "./engine.ts";
import type { Transport } from "./transport.ts";
import type { PersonaId } from "./types.ts";
import { cardFor, introTexts, normalizePhone, parseSignup } from "./signup.ts";
import { photonCliAddUser, photonProjectFor, type AddUser } from "./photon-users.ts";
import { calToken, calUrl, calendarItems, toIcs } from "./calendar.ts";
import { publicUrl } from "./kit.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AVATARS = new Set(["dean", "penny", "sunny", "dean-icon", "penny-icon", "sunny-icon"]);
const MAX_BODY = 16_384;

function file(res: ServerResponse, path: string, type: string) {
  res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
  res.end(readFileSync(path));
}

export function startHttp(opts: { engine: Engine; transport: Transport; port: number; token?: string; addUser?: AddUser; addCap?: number }) {
  const addUser = opts.addUser ?? photonCliAddUser;
  // /signup is open (judges sign up on their own phones), so it can't add unlimited strangers to our Photon plans.
  const addCap = opts.addCap ?? Number(process.env.PHOTON_ADD_CAP || 100);
  let addsDone = 0;
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
      // The address QR codes should point at (the tunnel), even when the page is opened on localhost.
      if (path === "/config.json") return reply(200, { publicUrl: publicUrl() ?? null });
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
        // Already signed up with this agent: don't register again or touch the profile, just hand back the number
        // they were assigned for it (looked up read-only if we never stored it).
        const before = store.user(phone);
        const again = typeof params.agent === "string" && engine.d.personas.has(params.agent as PersonaId) ? (params.agent as PersonaId) : undefined;
        if (again && before.signedUpAt && before.agents?.includes(again)) {
          const { own: perAgent, project } = photonProjectFor(again);
          let assigned = perAgent ? before.poolLines?.[project!] : before.poolLine;
          if (!assigned) {
            const looked = await addUser(phone, before.name ?? "", again);
            assigned = "line" in looked ? looked.line : undefined;
            if (assigned) store.saveUser(perAgent ? { ...before, poolLines: { ...before.poolLines, [project!]: assigned } } : { ...before, poolLine: assigned });
          }
          const textTo = assigned || (perAgent ? undefined : process.env.POOL_NUMBER || undefined);
          console.log(`[signup] ${before.name} ${phone} already has ${again}; sent their number again`);
          return reply(200, {
            ok: true,
            already: true,
            name: before.name,
            status: perAgent && !textTo ? "pending" : before.signupStatus,
            textTo,
            calendar: calUrl(phone),
            agents: before.agents,
          });
        }
        const r = parseSignup(params, before);
        if ("error" in r) return reply(400, r);
        // The chosen agent checks its own fields (Dean: a Canvas token) before anything is saved.
        const persona = typeof params.agent === "string" ? engine.d.personas.get(params.agent as PersonaId) : undefined;
        const own = persona?.signup ? await persona.signup(params, engine.ctx(persona.id, r.user)) : { profile: {} };
        if ("error" in own) return reply(400, own);
        Object.assign(r.user, own.profile);
        // Put them on the Photon allowlist so their first text gets through, and find the number they text. With one
        // Photon project per agent, that's the chosen agent's project: each agent's QR adds them where that agent
        // listens, and each project gives them its own number. Also for anyone whose number for this agent we
        // don't know yet (read-only for people already on the list).
        const agent = persona?.id;
        const { own: perAgent, project } = photonProjectFor(agent);
        const known = perAgent ? r.user.poolLines?.[project!] : r.user.poolLine;
        const fresh = r.user.signupStatus === "pending";
        const capped = addsDone >= addCap;
        const added = !(fresh || !known) ? { ok: true } : capped ? { ok: false, error: `PHOTON_ADD_CAP (${addCap}) reached` } : await addUser(phone, r.user.name ?? "", agent);
        if ((fresh || !known) && !capped && added.ok) addsDone++;
        const line = "line" in added ? added.line : undefined;
        const user = {
          ...r.user,
          ...(fresh && added.ok ? { signupStatus: "added" as const } : {}),
          ...(line ? (perAgent ? { poolLines: { ...r.user.poolLines, [project!]: line } } : { poolLine: line }) : {}),
        };
        store.saveUser(user);
        // Per-agent projects: only that project's own number for them, never the global POOL_NUMBER (another
        // project's number gets "this number didn't recognize you"); without one, this agent is still pending.
        const textTo = perAgent ? user.poolLines?.[project!] : user.poolLine || process.env.POOL_NUMBER || undefined;
        let status = perAgent && !textTo ? ("pending" as const) : user.signupStatus;
        const why = "error" in added && added.error ? `; photon: ${added.error}` : "";
        // Own number per agent: that agent texts them first (hello + card), so they don't have to start the chat.
        // If Photon won't take it yet, they stay "added" and their own first text gets the hello instead.
        if (perAgent && agent && textTo && !user.greeted?.includes(agent)) {
          try {
            for (const o of await introTexts(engine, phone, [agent])) await transport.send(o);
            const now = store.user(phone);
            store.saveUser({ ...now, signupStatus: "invited", greeted: [...new Set([...(now.greeted ?? []), agent])], lastAgent: agent });
            status = "invited";
          } catch (err) {
            console.warn(`[signup] first text from ${agent} to ${phone} failed (${err instanceof Error ? err.message : err}); their own text will get the hello`);
          }
        }
        console.log(`[signup] ${user.name} ${phone} (${status}${why})`);
        return reply(200, { ok: true, name: user.name, status, textTo, calendar: calUrl(phone), agents: user.agents, ...(own.note ? { note: own.note } : {}) });
      }

      // A website demo button (Penny's "buy a $23 DoorDash"): only for someone signed up with that agent who has
      // already got its hello, and the agent decides what the action does (Persona.tryIt).
      const tryIt = /^\/try\/(academic|financial|social)$/.exec(path);
      if (tryIt) {
        if (req.method !== "POST") return reply(405, { error: "POST only" });
        const id = tryIt[1] as PersonaId;
        const persona = engine.d.personas.get(id);
        const phone = normalizePhone(params.phone);
        if (!persona?.tryIt || !phone) return reply(400, { error: "Nothing to try here." });
        const user = store.user(phone);
        if (!user.agents?.includes(id)) return reply(403, { error: `Sign up with ${engine.d.config.names[id]} first.` });
        if (!user.greeted?.includes(id)) return reply(409, { error: `Say hey to ${engine.d.config.names[id]} in iMessage first, then try again.` });
        const out = await persona.tryIt(String(params.action ?? ""), engine.ctx(id, user));
        return reply("error" in out ? 400 : 200, out);
      }

      const viaTunnel = Boolean(req.headers["cf-connecting-ip"] || req.headers["cf-ray"] || req.headers["x-forwarded-for"]);
      const authed = opts.token ? params.token === opts.token : !viaTunnel;
      if (path === "/admin/signups") {
        if (!authed) return reply(403, { error: "bad token" });
        const users = store
          .allUsers()
          .filter((u) => u.signedUpAt)
          .sort((a, b) => (b.signedUpAt ?? "").localeCompare(a.signedUpAt ?? ""))
          .map(({ phone, name, budgetMonthly, savingsGoal, interests, focus, win, canvasLinked, signupStatus, signedUpAt, agents }) =>
            ({ phone, name, budgetMonthly, savingsGoal, interests, focus, win, canvasLinked, signupStatus, signedUpAt, agents }));
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
