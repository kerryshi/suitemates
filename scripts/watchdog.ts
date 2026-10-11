// Watches the Suitemates demo from OUTSIDE the server and pushes an alert to Kerry's phone (ntfy) when something
// breaks, with the command that fixes it. Alert-only: it never restarts or kills anything (Kerry, 2026-10-11).
//   tsx scripts/watchdog.ts        → runs forever, a check every 30 s (launchd: ops/watchdog.sh install)
//   tsx scripts/watchdog.ts once   → one tick, prints every check, sends nothing
//   tsx scripts/watchdog.ts test   → one test push + heartbeat, to prove the channel
// Config: data/watchdog.json {"ntfyTopic": "...", "hcUrl": "https://hc-ping.com/..."} (or WATCHDOG_NTFY_TOPIC /
// WATCHDOG_HC_URL). healthchecks.io is the dead-man's switch: when these pings stop (Mac asleep, offline, watchdog
// dead) it pushes to the same topic. Every alert and its fix: ops/WATCHDOG.md.
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

const MIN = 60_000;

export type Priority = "urgent" | "high" | "default" | "low";
export interface Check { id: string; title: string; fix: string; priority: Priority; after: number; realertMin?: number }
export interface Result { check: Check; status: "ok" | "fail" | "skip"; detail: string }
export interface Alert { kind: "alert" | "recovered"; check: Check; detail: string }
type State = Record<string, { streak: number; red: boolean; lastAlertAt?: number }>;

// A check goes red after `after` failing ticks in a row (one bad tick is usually a restart or a slow reply), says so
// again every `realertMin` while it stays red, and says "fine again" once when it clears. "skip" = couldn't tell
// this tick (e.g. state.json mid-write): leave everything as it was.
export function decide(results: Result[], state: State, now: number): { alerts: Alert[]; state: State } {
  const next: State = { ...state };
  const alerts: Alert[] = [];
  for (const { check, status, detail } of results) {
    if (status === "skip") continue;
    const s = state[check.id] ? { ...state[check.id] } : { streak: 0, red: false };
    if (status === "ok") {
      if (s.red) alerts.push({ kind: "recovered", check, detail });
      next[check.id] = { streak: 0, red: false };
      continue;
    }
    s.streak++;
    if (s.streak >= check.after && (!s.red || now - (s.lastAlertAt ?? 0) >= (check.realertMin ?? 10) * MIN)) {
      alerts.push({ kind: "alert", check, detail });
      s.red = true;
      s.lastAlertAt = now;
    }
    next[check.id] = s;
  }
  return { alerts, state: next };
}

export function parsePower(out: string): { ac: boolean; pct: number; left: string } | undefined {
  const src = /Now drawing from '(AC|Battery) Power'/.exec(out);
  const bat = /(\d+)%;[^;]*;\s*(\d+:\d+|\(no estimate\))?/.exec(out);
  return src && bat ? { ac: src[1] === "AC", pct: Number(bat[1]), left: bat[2] ?? "?" } : undefined;
}

export const maskPhone = (p: string) => `***${p.replace(/\D/g, "").slice(-4)}`;

// One server log line → the event it means, if any. Inbound lines carry the sender and text: only their time is kept.
// A lone "message stream ended; reconnecting" is normal (transport.ts keepAlive), so it isn't an event.
export function classifyLine(line: string): { kind: string; detail: string } | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^\[imessage\] (\S+): connection lost \((.*)\); retrying/.exec(line))) return { kind: "photon-drop", detail: `${m[1]}: ${m[2]}` };
  if (/^\[imessage\] handler error/.test(line)) return { kind: "handler-error", detail: line.slice(0, 160) };
  if ((m = /^\[signup\] (.+?) (\+\d{10,15}) \(pending(?:; photon: (.*))?\)$/.exec(line)))
    return { kind: "signup-pending", detail: `${m[1]} ${maskPhone(m[2])}${m[3] ? `: ${m[3]}` : ""}` };
  if (/^\[imessage\] \S+ line=\S* (dm|group) /.test(line)) return { kind: "inbound", detail: "" };
  if (/EADDRINUSE/.test(line)) return { kind: "double-server", detail: line.trim().slice(0, 120) };
  if ((m = /^\[core\] ERROR (\S+) (?:reply|proactive text) failed.*Gemini \S+ (?:→ (\d{3})|returned no text)/.exec(line)))
    return { kind: "gemini", detail: `${m[1]}: ${m[2] ?? "no text"}` };
  return undefined;
}

export const flapping = (times: number[], now: number, windowMs: number) => times.filter((t) => now - t <= windowMs).length >= 2;

// Sign-ups still pending (not on the agent's Photon allowlist) from the last 15 min. undefined = unreadable
// (store.ts writes state.json non-atomically, so a read can catch it half-written): try again next tick.
export function pendingSignups(json: string, now: number, windowMs = 15 * MIN): string[] | undefined {
  let users: Record<string, { phone?: string; name?: string; signupStatus?: string; signedUpAt?: string }>;
  try {
    users = JSON.parse(json).users ?? {};
  } catch {
    return undefined;
  }
  return Object.values(users)
    .filter((u) => u.signupStatus === "pending" && u.signedUpAt && now - Date.parse(u.signedUpAt) <= windowMs)
    .map((u) => `${u.name ?? "?"} ${maskPhone(u.phone ?? "")}`);
}

// Tail a log file across ticks. A new file (server restarted) or a shorter one (truncated) starts at its end: we
// never replay history, so a restart doesn't re-fire yesterday's errors.
export interface Cursor { path: string; offset: number; rest: string }
export function readNew(path: string, cursor: Cursor | undefined): { lines: string[]; cursor: Cursor | undefined } {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { lines: [], cursor: undefined };
  }
  if (!cursor || cursor.path !== path || size < cursor.offset) return { lines: [], cursor: { path, offset: size, rest: "" } };
  if (size === cursor.offset) return { lines: [], cursor };
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(Math.min(size - cursor.offset, 1_000_000));
    const n = readSync(fd, buf, 0, buf.length, cursor.offset);
    const parts = (cursor.rest + buf.subarray(0, n).toString("utf8")).split(/\r?\n/);
    const rest = parts.pop() ?? "";
    return { lines: parts, cursor: { path, offset: cursor.offset + n, rest } };
  } finally {
    closeSync(fd);
  }
}

// ---- runtime -------------------------------------------------------------------------------------------------

const ROOT = process.env.WATCHDOG_ROOT || process.cwd(); // the checkout the server runs in (its data/)
const PORT = process.env.WATCHDOG_PORT || process.env.PORT || "3000";
const SERVER_FIX =
  "Tell c7, or Terminal: cd ~/Projects/hacknc-agents && TRANSPORT=imessage MOCK=0 caffeinate -dims npm run dev >> data/logs/server.log 2>&1 &   (says EADDRINUSE? kill $(lsof -tnP -iTCP:3000 -sTCP:LISTEN) first)";

const C: Record<string, Check> = {
  power: { id: "power", title: "Mac on battery", priority: "high", after: 1, realertMin: 15, fix: "Plug in the charger and keep the lid open: a closed lid sleeps the Mac and every agent goes deaf." },
  server: { id: "server", title: "Server :3000 down", priority: "urgent", after: 2, fix: SERVER_FIX },
  double: { id: "double-server", title: "A second server crashed (EADDRINUSE)", priority: "default", after: 1, fix: "Only one npm run dev at a time. Keep the :3000 listener (lsof -tnP -iTCP:3000 -sTCP:LISTEN), close the other terminal." },
  tunnel: { id: "tunnel", title: "Sign-up page unreachable (tunnel)", priority: "high", after: 2, fix: "Terminal: cd ~/Projects/hacknc-agents && npm run tunnel  - wait for 'public URL:', then reload the /join pages on the laptop." },
  drift: { id: "qr-drift", title: "Printed QR codes point at an old address", priority: "high", after: 1, fix: "Show the laptop's /join page (its QR is live) or reprint. Then: cp data/public-url.txt data/printed-url.txt" },
  photon: { id: "photon", title: "iMessage connection flapping", priority: "high", after: 1, fix: "If 'Photon API unreachable' fires too, it's a Photon outage: demo with npm run chat -- group. Else check Wi-Fi; still flapping after 2 min -> restart the server: " + SERVER_FIX },
  handler: { id: "handler", title: "Server error while handling a text", priority: "high", after: 1, fix: "tail -40 the server log for the stack. If texts stop getting replies, restart the server: " + SERVER_FIX },
  photonApi: { id: "photon-api", title: "Photon API unreachable", priority: "high", after: 2, fix: "If 'Mac offline' also fired, fix Wi-Fi first. Otherwise Photon is down: tell the judges, demo with npm run chat -- group." },
  photonLogin: { id: "photon-login", title: "Photon CLI logged out (auto-add is off)", priority: "high", after: 1, fix: "Terminal: photon login  (approve in the browser). Until then every sign-up stays pending." },
  signup: { id: "signup", title: "Sign-up stuck pending", priority: "high", after: 1, fix: "Their texts will get 'Target not allowed'. Open /admin on the laptop -> the pending row; add that number under Users in the agent's Photon project (dashboard), then 'send intro'. If it says logged out: photon login." },
  net: { id: "internet", title: "Mac offline", priority: "urgent", after: 2, fix: "Rejoin the venue Wi-Fi or hotspot from your phone. Server and tunnel reconnect on their own; check: curl $(cat data/public-url.txt)/health" },
  log: { id: "log", title: "Server output not captured (log checks off)", priority: "default", after: 1, realertMin: 60, fix: "Ask c7 to restart the server with >> data/logs/server.log 2>&1 so drops, stuck sign-ups and errors are visible." },
  quiet: { id: "quiet", title: "No texts in 20 min during judging", priority: "default", after: 1, realertMin: 20, fix: "Text Penny 'hey' from your phone. No reply in 15 s -> restart the server: " + SERVER_FIX + "  (Judging over? rm data/judging)" },
  gemini: { id: "gemini", title: "Gemini errors", priority: "high", after: 1, fix: "429 = quota: wait 60 s, fewer texts. 400/403 = bad key: new key at aistudio.google.com -> .env GEMINI_API_KEY -> restart. Last resort: FAKE_LLM=1 restart." },
};

function sh(cmd: string, args: string[], timeout = 10_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, out: `${stdout}${stderr}` }),
    ),
  );
}

async function httpStatus(url: string, timeoutMs: number, method = "GET"): Promise<number | string> {
  try {
    return (await fetch(url, { method, signal: AbortSignal.timeout(timeoutMs) })).status;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim() : undefined);

function conf(): { ntfyTopic?: string; hcUrl?: string; name?: string } {
  let file: Record<string, string> = {};
  try {
    file = JSON.parse(read(join(ROOT, "data", "watchdog.json")) ?? "{}");
  } catch {
    console.error("[watchdog] data/watchdog.json is not valid JSON; ignoring it");
  }
  return {
    ntfyTopic: process.env.WATCHDOG_NTFY_TOPIC || file.ntfyTopic,
    hcUrl: process.env.WATCHDOG_HC_URL || file.hcUrl,
    name: process.env.WATCHDOG_NAME || file.name,
  };
}

// The file the :3000 server's stdout goes to (whoever started it), so restarts are followed without config.
async function serverLog(): Promise<{ pid?: string; path?: string }> {
  const pid = (await sh("lsof", ["-tnP", `-iTCP:${PORT}`, "-sTCP:LISTEN"])).out.trim().split("\n")[0] || undefined;
  if (process.env.WATCHDOG_LOG) return { pid, path: process.env.WATCHDOG_LOG };
  if (!pid) return {};
  const path = (await sh("lsof", ["-a", "-p", pid, "-d", "1", "-Fn"])).out.split("\n").find((l) => l.startsWith("n/"))?.slice(1);
  return { pid, path: path && !path.startsWith("/dev/") ? path : undefined };
}

const events: Record<string, { at: number; detail: string }[]> = {};
const since = (kind: string, now: number, ms: number) => (events[kind] ?? []).filter((e) => now - e.at <= ms);
let cursor: Cursor | undefined;
let lastInbound = 0;
let tickNo = 0;
const startedAt = Date.now();

async function tick(all = false): Promise<Result[]> {
  const now = Date.now();
  const slow = all || tickNo++ % 4 === 0; // Photon CLI calls every 2 min, not every 30 s
  const log = await serverLog();
  if (log.path) {
    const r = readNew(log.path, cursor);
    cursor = r.cursor;
    for (const line of r.lines) {
      const e = classifyLine(line);
      if (!e) continue;
      if (e.kind === "inbound") lastInbound = now;
      else (events[e.kind] ??= []).push({ at: now, detail: e.detail });
    }
    for (const k of Object.keys(events)) events[k] = since(k, now, 30 * MIN);
  }
  const ok = (check: Check, detail = ""): Result => ({ check, status: "ok", detail });
  const fail = (check: Check, detail: string): Result => ({ check, status: "fail", detail });
  const skip = (check: Check): Result => ({ check, status: "skip", detail: "" });
  const recent = (kind: string, ms: number) => since(kind, now, ms);

  const checks: (() => Promise<Result>)[] = [
    async () => {
      const p = parsePower((await sh("pmset", ["-g", "batt"])).out);
      if (!p) return fail(C.power, "can't read pmset -g batt");
      return p.ac ? ok(C.power) : fail({ ...C.power, priority: p.pct < 30 ? "urgent" : "high" }, `${p.pct}%, ${p.left} left`);
    },
    async () => {
      const s = await httpStatus(`http://127.0.0.1:${PORT}/health`, 3000);
      return s === 200 ? ok(C.server) : fail(C.server, `GET :${PORT}/health -> ${s}`);
    },
    async () => (recent("double-server", 2 * MIN).length ? fail(C.double, recent("double-server", 2 * MIN)[0].detail) : ok(C.double)),
    async () => {
      const url = read(join(ROOT, "data", "public-url.txt"));
      if (!url) return fail(C.tunnel, "no tunnel running (data/public-url.txt missing)");
      const s = await httpStatus(`${url}/health`, 8000);
      return s === 200 ? ok(C.tunnel) : fail(C.tunnel, `GET ${url}/health -> ${s}`);
    },
    async () => {
      const printed = read(join(ROOT, "data", "printed-url.txt"));
      const live = read(join(ROOT, "data", "public-url.txt"));
      return printed && live && printed !== live ? fail(C.drift, `printed ${printed}, live ${live}`) : ok(C.drift);
    },
    async () => {
      const drops = recent("photon-drop", 2 * MIN);
      return flapping(drops.map((d) => d.at), now, 2 * MIN) ? fail(C.photon, `${drops.length} drops in 2 min; last: ${drops.at(-1)?.detail}`) : ok(C.photon);
    },
    async () => (recent("handler-error", 2 * MIN).length ? fail(C.handler, recent("handler-error", 2 * MIN).at(-1)!.detail) : ok(C.handler)),
    async () => {
      if (!slow) return skip(C.photonApi);
      const r = await sh("photon", ["ping"], 15_000);
      return r.code === 0 ? ok(C.photonApi) : fail(C.photonApi, r.out.trim().slice(0, 160) || `exit ${r.code}`);
    },
    async () => {
      if (!slow) return skip(C.photonLogin);
      const r = await sh("photon", ["whoami"], 15_000);
      return r.code === 0 && !/not authenticated/i.test(r.out) ? ok(C.photonLogin) : fail(C.photonLogin, r.out.trim().split("\n")[0].slice(0, 160));
    },
    async () => {
      const fromState = pendingSignups(read(join(ROOT, "data", "state.json")) ?? '{"users":{}}', now);
      if (!fromState) return skip(C.signup);
      const fromLog = recent("signup-pending", 15 * MIN).map((e) => e.detail);
      const who = [...new Set([...fromLog, ...fromState.filter((s) => !fromLog.some((l) => l.startsWith(s)))])];
      return who.length ? fail(C.signup, who.join("; ")) : ok(C.signup);
    },
    async () => {
      const s = await httpStatus(process.env.WATCHDOG_NET_URL || "https://1.1.1.1", 4000, "HEAD");
      return typeof s === "number" ? ok(C.net) : fail(C.net, s);
    },
    async () => (!log.pid ? skip(C.log) : log.path ? ok(C.log, log.path) : fail(C.log, `server pid ${log.pid} writes to a terminal, not a file`)),
    async () => {
      const flag = join(ROOT, "data", "judging");
      if (!existsSync(flag) && process.env.WATCHDOG_JUDGING !== "1") return ok(C.quiet);
      const from = Math.max(lastInbound, startedAt, existsSync(flag) ? statSync(flag).mtimeMs : 0);
      return now - from > (Number(process.env.WATCHDOG_QUIET_MIN) || 20) * MIN ? fail(C.quiet, `last inbound text ${lastInbound ? `${Math.round((now - lastInbound) / MIN)} min ago` : "not seen since the watchdog started"}`) : ok(C.quiet);
    },
    async () => {
      const g = recent("gemini", 5 * MIN);
      return g.length >= 2 ? fail(C.gemini, `${g.length} in 5 min; last ${g.at(-1)!.detail}`) : ok(C.gemini);
    },
  ];
  // A check that throws is unknown, and unknown health is unhealthy: it fails rather than vanishing.
  // (`checks` is in the same order as C, which is how a crash is pinned to its check.)
  return Promise.all(
    checks.map((run, i) => run().catch((err) => fail(Object.values(C)[i] ?? C.server, `check crashed: ${err instanceof Error ? err.message : err}`))),
  );
}

function notifyLocal(title: string, body: string) {
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  execFile("osascript", ["-e", `display notification ${q(body.slice(0, 300))} with title ${q(title)}`], () => {});
}

async function push(a: Alert | { kind: "info"; title: string; body: string }, cfg = conf()) {
  const title = (a.kind === "info" ? a.title : `${a.kind === "recovered" ? "OK: " : ""}${a.check.title}`) + (cfg.name ? ` [${cfg.name}]` : "");
  const body = a.kind === "info" ? a.body : a.kind === "recovered" ? "Fine again." : `${a.detail ? `${a.detail}\n` : ""}FIX: ${a.check.fix}`;
  const priority = a.kind === "alert" ? a.check.priority : "low";
  console.log(`[watchdog] ${new Date().toISOString()} ${a.kind.toUpperCase()} ${title}${a.kind === "alert" && a.detail ? ` - ${a.detail}` : ""}`);
  notifyLocal(title, body); // the only channel that still works when the Mac is offline
  if (!cfg.ntfyTopic) return console.error("[watchdog] no ntfyTopic set: phone not notified");
  try {
    const r = await fetch(`https://ntfy.sh/${cfg.ntfyTopic}`, {
      method: "POST",
      body,
      headers: { Title: title.replace(/[^\x20-\x7e]/g, "?"), Priority: priority, Tags: a.kind === "alert" ? "rotating_light" : "white_check_mark" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error(`[watchdog] ntfy -> ${r.status}`);
  } catch (err) {
    console.error(`[watchdog] ntfy failed: ${err instanceof Error ? err.message : err}`);
  }
}

// WATCHDOG_HC_URL=off for a second, fire-test instance, so it can't keep the real dead-man's switch alive.
async function heartbeat(failed: boolean, cfg = conf()) {
  if (cfg.hcUrl && cfg.hcUrl !== "off") await httpStatus(failed ? `${cfg.hcUrl}/fail` : cfg.hcUrl, 8000);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "once") {
    for (const r of await tick(true)) console.log(`${r.status.padEnd(4)} ${r.check.id.padEnd(13)} ${r.detail}`);
    return;
  }
  if (mode === "test") {
    await push({ kind: "info", title: "Watchdog test", body: "If you can read this on your phone, alerts reach you." });
    await heartbeat(false);
    return;
  }
  // Keep the Mac from idle-sleeping for as long as the watchdog lives (not lid close or battery death: those alert).
  spawn("caffeinate", ["-dims", "-w", String(process.pid)], { stdio: "ignore" }).unref();
  const log = await serverLog();
  await push({ kind: "info", title: "Watchdog up", body: `server pid ${log.pid ?? "none"} | log ${log.path ?? "not captured"} | tunnel ${read(join(ROOT, "data", "public-url.txt")) ?? "none"}` });
  let state: State = {};
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const d = decide(await tick(), state, Date.now());
      state = d.state;
      for (const a of d.alerts) await push(a);
      await heartbeat(false);
    } catch (err) {
      console.error(`[watchdog] tick failed: ${err instanceof Error ? err.stack : err}`);
      await heartbeat(true);
    } finally {
      busy = false;
    }
  };
  await run();
  setInterval(run, Number(process.env.WATCHDOG_TICK_MS) || 30_000);
}

if (process.argv[1]?.endsWith("watchdog.ts")) await main();
