// Watches the Suitemates demo from OUTSIDE the server and pushes an alert to Kerry's phone (ntfy) when something
// breaks, with the command that fixes it. Alert-only: it never restarts or kills anything (Kerry, 2026-10-11).
//   tsx scripts/watchdog.ts        → runs forever, a check every 30 s (launchd: ops/watchdog.sh install)
//   tsx scripts/watchdog.ts once   → one tick, prints every check, sends nothing
//   tsx scripts/watchdog.ts test   → one test push + heartbeat, to prove the channel
// Config: data/watchdog.json {"ntfyTopic": "...", "hcUrl": "https://hc-ping.com/..."} (or WATCHDOG_NTFY_TOPIC /
// WATCHDOG_HC_URL). healthchecks.io is the dead-man's switch: when these pings stop (Mac asleep, offline, watchdog
// dead or hung) it pushes to the same topic. Every alert and its fix: ops/WATCHDOG.md.
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIN = 60_000;

export type Priority = "urgent" | "high" | "default" | "low";
export interface Check {
  id: string;
  title: string;
  fix: string;
  priority: Priority;
  after: number; // failing ticks in a row before it alerts
  realertMin?: number; // say it again this often while red (default 10)
  realertOnChange?: boolean; // ...and at once when the detail changes (a second stuck sign-up is news)
  recoverSilently?: boolean; // error bursts that age out: no "fine again" nobody earned
}
export interface Result { check: Check; status: "ok" | "fail" | "skip"; detail: string }
export interface Alert { kind: "alert" | "recovered"; check: Check; detail: string }
export type State = Record<string, { streak: number; red: boolean; lastAlertAt?: number; lastDetail?: string }>;

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
      if (s.red && !check.recoverSilently) alerts.push({ kind: "recovered", check, detail });
      next[check.id] = { streak: 0, red: false };
      continue;
    }
    s.streak++;
    const changed = check.realertOnChange && s.red && detail !== s.lastDetail;
    if (s.streak >= check.after && (!s.red || changed || now - (s.lastAlertAt ?? 0) >= (check.realertMin ?? 10) * MIN)) {
      alerts.push({ kind: "alert", check, detail });
      s.red = true;
      s.lastAlertAt = now;
      s.lastDetail = detail;
    }
    next[check.id] = s;
  }
  return { alerts, state: next };
}

// Alert state survives restarts (launchd KeepAlive, a re-install), so a restart doesn't re-send every red alert.
export interface Saved { checks: State; bannerAt?: number }
export function loadState(file: string): Saved {
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return { checks: j.checks ?? {}, ...(typeof j.bannerAt === "number" ? { bannerAt: j.bannerAt } : {}) };
  } catch {
    return { checks: {} };
  }
}
export function saveState(file: string, saved: Saved) {
  writeFileSync(`${file}.tmp`, JSON.stringify(saved));
  renameSync(`${file}.tmp`, file); // atomic: a crash mid-write can't leave half a file
}

export function parsePower(out: string): { ac: boolean; pct: number; left: string } | undefined {
  const src = /Now drawing from '(AC|Battery) Power'/.exec(out);
  if (!src) return undefined;
  const bat = /(\d+)%;[^;]*;\s*(\d+:\d+|\(no estimate\))?/.exec(out); // absent on a Mac with no battery
  return { ac: src[1] === "AC", pct: bat ? Number(bat[1]) : -1, left: bat?.[2] ?? "?" };
}

export const maskPhone = (p: string) => `***${p.replace(/\D/g, "").slice(-4)}`;
// Every alert goes through this: the ntfy topic is private only by its random name, so no full phone number leaves.
export const redact = (text: string) => text.replace(/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, maskPhone);

// One server log line → the event it means, if any. Inbound lines carry the sender and text: only their time is kept.
// A lone "message stream ended; reconnecting" is normal (transport.ts keepAlive), so it isn't an event.
export function classifyLine(line: string): { kind: string; detail: string } | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^\[imessage\] (\S+): connection lost \((.*)\); retrying/.exec(line))) return { kind: "photon-drop", detail: `${m[1]}: ${m[2]}` };
  if (/^\[imessage\] handler error/.test(line)) return { kind: "handler-error", detail: line.slice(0, 160) };
  if ((m = /^\[signup\] (.+?) (\+\d{10,15}) \(pending(?:; photon: (.*))?\)$/.exec(line)))
    return { kind: "signup-pending", detail: `${m[1]} ${maskPhone(m[2])}${m[3] ? `: ${m[3]}` : ""}` };
  // Any text that reached us proves the stream hears: a DM (with or without the pre-86e0e93 "dm"/"group" word) or
  // a group text the server logs and ignores.
  if (/^\[imessage\] (\S+ line=\S* (?:dm |group )?\S+: |ignored group message )/.test(line)) return { kind: "inbound", detail: "" };
  if (/EADDRINUSE/.test(line)) return { kind: "double-server", detail: line.trim().slice(0, 120) };
  // Any failed reply (Gemini status, timeout, dropped fetch): the user got a fallback or nothing.
  if ((m = /^\[core\] ERROR (\S+) (?:reply failed|proactive text failed[^:]*): (.*)$/.exec(line))) {
    const g = /^Gemini \S+ (?:→ (\d{3})|returned no text)/.exec(m[2]);
    return { kind: "reply-failed", detail: `${m[1]}: ${g ? `Gemini ${g[1] ?? "returned no text"}` : m[2].slice(0, 120)}` };
  }
  return undefined;
}

// `photon whoami`: only an explicit "not authenticated" is a logout. A network failure ("fetch failed") is not, and
// alerting "logged out" for it sent Kerry to `photon login` for nothing (05:03Z); photon-api covers the network.
export function loginState(code: number, out: string): "ok" | "logged-out" | "unknown" {
  if (/not authenticated|not logged in/i.test(out)) return "logged-out";
  return code === 0 ? "ok" : "unknown";
}

export const flapping = (times: number[], now: number, windowMs: number) => times.filter((t) => now - t <= windowMs).length >= 2;

// Sign-ups not on the agent's Photon allowlist yet. fresh = pending in the last 15 min (alert); pending = every number
// still waiting, any age (keeps the check red instead of a false "fine again"); invited = greeted, so a "(pending…)"
// log line about them is stale. undefined = unreadable: store.ts writes state.json non-atomically, so a read can
// catch it half-written. Try again next tick.
export function pendingSignups(json: string, now: number, windowMs = 15 * MIN): { fresh: string[]; pending: string[]; invited: string[] } | undefined {
  let users: Record<string, { phone?: string; name?: string; signupStatus?: string; signedUpAt?: string }>;
  try {
    users = JSON.parse(json).users ?? {};
  } catch {
    return undefined;
  }
  const all = Object.values(users);
  const pending = all.filter((u) => u.signupStatus === "pending");
  return {
    fresh: pending.filter((u) => u.signedUpAt && now - Date.parse(u.signedUpAt) <= windowMs).map((u) => `${u.name ?? "?"} ${maskPhone(u.phone ?? "")}`),
    pending: pending.map((u) => maskPhone(u.phone ?? "")),
    invited: all.filter((u) => u.signupStatus === "invited").map((u) => maskPhone(u.phone ?? "")),
  };
}

// Tail a log file across ticks. A new file (server restarted), a replaced one (same name, new inode) or a shorter one
// (truncated) starts at its end: we never replay history, so a restart doesn't re-fire old errors.
export interface Cursor { path: string; ino: number; offset: number; rest: string }
export function readNew(path: string, cursor: Cursor | undefined): { lines: string[]; cursor: Cursor | undefined } {
  let st: { size: number; ino: number };
  try {
    st = statSync(path);
  } catch {
    return { lines: [], cursor: undefined };
  }
  if (!cursor || cursor.path !== path || cursor.ino !== st.ino || st.size < cursor.offset) return { lines: [], cursor: { path, ino: st.ino, offset: st.size, rest: "" } };
  if (st.size === cursor.offset) return { lines: [], cursor };
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(Math.min(st.size - cursor.offset, 1_000_000));
    const n = readSync(fd, buf, 0, buf.length, cursor.offset);
    const parts = (cursor.rest + buf.subarray(0, n).toString("utf8")).split(/\r?\n/);
    const rest = parts.pop() ?? "";
    return { lines: parts, cursor: { ...cursor, offset: cursor.offset + n, rest } };
  } finally {
    closeSync(fd);
  }
}

// ---- runtime -------------------------------------------------------------------------------------------------

const ROOT = process.env.WATCHDOG_ROOT || process.cwd(); // the checkout the server runs in (its data/)
const PORT = process.env.WATCHDOG_PORT || process.env.PORT || "3000";
const STATE_FILE = join(ROOT, "data", "watchdog-state.json");
const SERVER_FIX =
  "Tell c7, or Terminal: cd ~/Projects/hacknc-agents && TRANSPORT=imessage MOCK=0 caffeinate -dims npm run dev >> data/logs/server.log 2>&1 &   (says EADDRINUSE? kill $(lsof -tnP -iTCP:3000 -sTCP:LISTEN) first)";

const C: Record<string, Check> = {
  power: { id: "power", title: "Mac on battery", priority: "high", after: 1, realertMin: 15, fix: "Plug in the charger and keep the lid open: a closed lid sleeps the Mac and every agent goes deaf." },
  server: { id: "server", title: "Server :3000 down", priority: "urgent", after: 2, fix: SERVER_FIX },
  double: { id: "double-server", title: "A second server crashed (EADDRINUSE)", priority: "default", after: 1, recoverSilently: true, fix: "Only one npm run dev at a time. Keep the :3000 listener (lsof -tnP -iTCP:3000 -sTCP:LISTEN), close the other terminal." },
  tunnel: { id: "tunnel", title: "Sign-up page unreachable (tunnel)", priority: "high", after: 2, fix: "Terminal: cd ~/Projects/hacknc-agents && npm run tunnel  - wait for 'public URL:', then reload the /join pages on the laptop." },
  drift: { id: "qr-drift", title: "Printed QR codes point at an old address", priority: "high", after: 1, fix: "Show the laptop's /join page (its QR is live) or reprint. Then: cp data/public-url.txt data/printed-url.txt" },
  photon: { id: "photon", title: "iMessage connection flapping", priority: "high", after: 1, recoverSilently: true, fix: "If 'Photon API unreachable' fires too, it's a Photon outage: demo with npm run chat (terminal, starts on Sunny). Else check Wi-Fi; still flapping after 2 min -> restart the server: " + SERVER_FIX },
  handler: { id: "handler", title: "Server error while handling a text", priority: "high", after: 1, realertOnChange: true, recoverSilently: true, fix: "tail -40 data/logs/server.log for the stack. If texts stop getting replies, restart the server: " + SERVER_FIX },
  photonApi: { id: "photon-api", title: "Photon API unreachable", priority: "high", after: 2, fix: "If 'Mac offline' also fired, fix Wi-Fi first. Otherwise Photon is down: tell the judges, demo with npm run chat (terminal, starts on Sunny)." },
  photonLogin: { id: "photon-login", title: "Photon CLI logged out (auto-add is off)", priority: "high", after: 1, fix: "Terminal: photon login  (approve in the browser). Until then every sign-up stays pending." },
  signup: { id: "signup", title: "Sign-up stuck pending", priority: "high", after: 1, realertOnChange: true, fix: "Their texts will get 'Target not allowed'. Open /admin on the laptop -> the pending row; add that number under Users in the agent's Photon project (dashboard), then 'send intro'. If it says logged out: photon login." },
  net: { id: "internet", title: "Mac offline", priority: "urgent", after: 2, fix: "Rejoin the venue Wi-Fi or hotspot from your phone. Server and tunnel reconnect on their own; check: curl $(cat data/public-url.txt)/health" },
  log: { id: "log", title: "Server output not captured (log checks off)", priority: "default", after: 1, realertMin: 60, fix: "Ask c7 to restart the server with >> data/logs/server.log 2>&1 so drops, stuck sign-ups and errors are visible." },
  quiet: { id: "quiet", title: "No texts in 20 min during judging", priority: "default", after: 1, realertMin: 20, fix: "Text Penny 'hey' from your phone. No reply in 15 s -> restart the server: " + SERVER_FIX + "  (Judging over? rm data/judging)" },
  replies: { id: "replies", title: "Agent replies failing", priority: "high", after: 1, recoverSilently: true, fix: "Gemini 429 = quota: wait 60 s, fewer texts. 400/403 = bad key: new key at aistudio.google.com -> .env GEMINI_API_KEY -> restart. Timeouts = Gemini slow or Wi-Fi. Last resort: FAKE_LLM=1 restart." },
};

function sh(cmd: string, args: string[], timeout = 10_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) =>
      resolve({
        code: err ? (typeof err.code === "number" ? err.code : -1) : 0,
        // ENOENT and friends have a string code and no output: say so, or "exit -1" reads like an outage.
        out: `${stdout}${stderr}${err && typeof err.code !== "number" ? err.message : ""}`,
      }),
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
  if (!pid || !/^\d+$/.test(pid)) return {};
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
  // Log-derived checks can't tell anything without the log: skip (the `log` check is what alerts about that).
  const fromLog = (check: Check, run: () => Result) => (log.path ? run() : skip(check));

  const checks: { check: Check; run: () => Promise<Result> }[] = [
    {
      check: C.power,
      run: async () => {
        const p = parsePower((await sh("pmset", ["-g", "batt"])).out);
        if (!p) return fail(C.power, "can't read pmset -g batt");
        return p.ac ? ok(C.power) : fail({ ...C.power, priority: p.pct < 30 ? "urgent" : "high" }, `${p.pct}%, ${p.left} left`);
      },
    },
    {
      check: C.server,
      run: async () => {
        const s = await httpStatus(`http://127.0.0.1:${PORT}/health`, 3000);
        return s === 200 ? ok(C.server) : fail(C.server, `GET :${PORT}/health -> ${s}`);
      },
    },
    { check: C.double, run: async () => fromLog(C.double, () => (recent("double-server", 2 * MIN).length ? fail(C.double, recent("double-server", 2 * MIN)[0].detail) : ok(C.double))) },
    {
      check: C.tunnel,
      run: async () => {
        const url = read(join(ROOT, "data", "public-url.txt"));
        if (!url) return fail(C.tunnel, "no tunnel running (data/public-url.txt missing)");
        const s = await httpStatus(`${url}/health`, 8000);
        return s === 200 ? ok(C.tunnel) : fail(C.tunnel, `GET ${url}/health -> ${s}`);
      },
    },
    {
      check: C.drift,
      run: async () => {
        const printed = read(join(ROOT, "data", "printed-url.txt"));
        const live = read(join(ROOT, "data", "public-url.txt"));
        return printed && live && printed !== live ? fail(C.drift, `printed ${printed}, live ${live}`) : ok(C.drift);
      },
    },
    {
      check: C.photon,
      run: async () =>
        fromLog(C.photon, () => {
          const drops = recent("photon-drop", 2 * MIN);
          return flapping(drops.map((d) => d.at), now, 2 * MIN) ? fail(C.photon, `${drops.length} drops in 2 min; last: ${drops.at(-1)?.detail}`) : ok(C.photon);
        }),
    },
    { check: C.handler, run: async () => fromLog(C.handler, () => (recent("handler-error", 2 * MIN).length ? fail(C.handler, recent("handler-error", 2 * MIN).at(-1)!.detail) : ok(C.handler))) },
    {
      check: C.photonApi,
      run: async () => {
        if (!slow) return skip(C.photonApi);
        const r = await sh("photon", ["ping"], 15_000);
        return r.code === 0 ? ok(C.photonApi) : fail(C.photonApi, r.out.trim().slice(0, 160) || `exit ${r.code}`);
      },
    },
    {
      check: C.photonLogin,
      run: async () => {
        if (!slow) return skip(C.photonLogin);
        const r = await sh("photon", ["whoami"], 15_000);
        const s = loginState(r.code, r.out);
        return s === "ok" ? ok(C.photonLogin) : s === "logged-out" ? fail(C.photonLogin, r.out.trim().split("\n")[0].slice(0, 160)) : skip(C.photonLogin);
      },
    },
    {
      check: C.signup,
      run: async () => {
        const st = pendingSignups(read(join(ROOT, "data", "state.json")) ?? '{"users":{}}', now);
        if (!st) return skip(C.signup);
        // A "(pending…)" log line counts until that person is greeted (state.json can say "added" while they still
        // have no number to text, so only "invited" clears it).
        const logged = recent("signup-pending", 15 * MIN).map((e) => e.detail).filter((d) => !st.invited.some((p) => d.includes(p)));
        const who = [...new Set([...logged, ...st.fresh.filter((s) => !logged.some((l) => l.startsWith(s)))])];
        if (who.length) return fail(C.signup, who.join("; "));
        return st.pending.length ? skip(C.signup) : ok(C.signup); // old and still stuck: stay red, never a false "fine"
      },
    },
    {
      check: C.net,
      run: async () => {
        const s = await httpStatus(process.env.WATCHDOG_NET_URL || "https://1.1.1.1", 8000, "HEAD");
        return typeof s === "number" ? ok(C.net) : fail(C.net, s);
      },
    },
    { check: C.log, run: async () => (!log.pid ? skip(C.log) : log.path ? ok(C.log, log.path) : fail(C.log, `server pid ${log.pid} writes to a terminal, not a file`)) },
    {
      check: C.quiet,
      run: async () => {
        const flag = join(ROOT, "data", "judging");
        let flagAt: number | undefined;
        try {
          flagAt = statSync(flag).mtimeMs;
        } catch {
          // no flag file: not judging
        }
        if (flagAt === undefined && process.env.WATCHDOG_JUDGING !== "1") return ok(C.quiet);
        if (!log.path) return skip(C.quiet);
        const from = Math.max(lastInbound, startedAt, flagAt ?? 0);
        const limit = (Number(process.env.WATCHDOG_QUIET_MIN) || 20) * MIN;
        return now - from > limit ? fail(C.quiet, `last inbound text ${lastInbound ? `${Math.round((now - lastInbound) / MIN)} min ago` : "not seen since the watchdog started"}`) : ok(C.quiet);
      },
    },
    {
      check: C.replies,
      run: async () =>
        fromLog(C.replies, () => {
          const g = recent("reply-failed", 5 * MIN);
          return g.length >= 2 ? fail(C.replies, `${g.length} in 5 min; last ${g.at(-1)!.detail}`) : ok(C.replies);
        }),
    },
  ];
  // A check that throws is unknown, and unknown health is unhealthy: it fails rather than vanishing.
  return Promise.all(checks.map(({ check, run }) => run().catch((err) => fail(check, `check crashed: ${err instanceof Error ? err.message : err}`))));
}

function notifyLocal(title: string, body: string) {
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  execFile("osascript", ["-e", `display notification ${q(body.slice(0, 300))} with title ${q(title)}`], () => {});
}

async function push(a: Alert | { kind: "info"; title: string; body: string }, cfg = conf()) {
  const title = redact((a.kind === "info" ? a.title : `${a.kind === "recovered" ? "OK: " : ""}${a.check.title}`) + (cfg.name ? ` [${cfg.name}]` : ""));
  const body = redact(a.kind === "info" ? a.body : a.kind === "recovered" ? "Fine again." : `${a.detail ? `${a.detail}\n` : ""}FIX: ${a.check.fix}`);
  const priority = a.kind === "alert" ? a.check.priority : "low";
  console.log(`[watchdog] ${new Date().toISOString()} ${a.kind.toUpperCase()} ${title}${a.kind === "alert" && a.detail ? ` - ${redact(a.detail)}` : ""}`);
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
    for (const r of await tick(true)) console.log(`${r.status.padEnd(4)} ${r.check.id.padEnd(13)} ${redact(r.detail)}`);
    return;
  }
  if (mode === "test") {
    await push({ kind: "info", title: "Watchdog test", body: "If you can read this on your phone, alerts reach you." });
    await heartbeat(false);
    return;
  }
  // Keep the Mac from idle-sleeping for as long as the watchdog lives (not lid close or battery death: those alert).
  // No -d: the display may sleep; only the system must stay up.
  spawn("caffeinate", ["-ims", "-w", String(process.pid)], { stdio: "ignore" }).unref();
  const saved = loadState(STATE_FILE);
  let state = saved.checks;
  let bannerAt = saved.bannerAt ?? 0;
  if (Date.now() - bannerAt > 10 * MIN) {
    // At most one "up" banner per 10 min, so a crash loop can't become a push storm.
    const log = await serverLog();
    await push({ kind: "info", title: "Watchdog up", body: `server pid ${log.pid ?? "none"} | log ${log.path ?? "not captured"} | tunnel ${read(join(ROOT, "data", "public-url.txt")) ?? "none"}` });
    bannerAt = Date.now();
  }
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    let timer: NodeJS.Timeout | undefined;
    try {
      // A tick that hangs (a child that won't die) must not stall silently: fail the heartbeat and exit so launchd
      // starts a fresh process (state is saved, so that doesn't re-send alerts).
      const hung = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("tick hung for 45 s")), 45_000)));
      const results = await Promise.race([tick(), hung]);
      const d = decide(results, state, Date.now());
      state = d.state;
      saveState(STATE_FILE, { checks: state, bannerAt });
      for (const a of d.alerts) await push(a);
      await heartbeat(false);
    } catch (err) {
      console.error(`[watchdog] tick failed: ${err instanceof Error ? err.stack : err}`);
      await heartbeat(true);
      if (err instanceof Error && err.message.startsWith("tick hung")) {
        notifyLocal("Watchdog restarting", "A check hung for 45 s; launchd will start a fresh watchdog.");
        process.exit(1);
      }
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  };
  await run();
  setInterval(run, Number(process.env.WATCHDOG_TICK_MS) || 30_000);
}

if (process.argv[1]?.endsWith("scripts/watchdog.ts")) await main();
