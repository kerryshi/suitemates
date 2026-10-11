// Watchdog logic, no network or processes: alert timing, the parsers that read pmset / the server log / state.json,
// and the log tail across appends, restarts and truncation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyLine,
  decide,
  flapping,
  maskPhone,
  parsePower,
  pendingSignups,
  readNew,
  type Check,
  type Result,
} from "../scripts/watchdog.ts";

const MIN = 60_000;
const check = (over: Partial<Check> = {}): Check => ({ id: "server", title: "Server down", fix: "restart it", priority: "urgent", after: 2, ...over });
const res = (c: Check, status: Result["status"], detail = ""): Result => ({ check: c, status, detail });

test("a check alerts only after `after` failing ticks, then re-alerts on the interval, then recovers once", () => {
  const c = check();
  let s = {};
  let r = decide([res(c, "fail")], s, 0);
  assert.equal(r.alerts.length, 0); // one bad tick is a blip (a restart, a slow reply)
  r = decide([res(c, "fail")], (s = r.state), 30_000);
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].kind, "alert");
  r = decide([res(c, "fail")], (s = r.state), 5 * MIN);
  assert.equal(r.alerts.length, 0); // still red, but we already told you
  r = decide([res(c, "fail")], (s = r.state), 11 * MIN);
  assert.equal(r.alerts.length, 1); // still red 10 min later: say it again
  r = decide([res(c, "ok")], (s = r.state), 12 * MIN);
  assert.deepEqual(r.alerts.map((a) => a.kind), ["recovered"]);
  r = decide([res(c, "ok")], (s = r.state), 13 * MIN);
  assert.equal(r.alerts.length, 0);
});

test("after: 1 alerts on the first tick; a skipped check keeps its state; a blip that recovers never alerts", () => {
  const power = check({ id: "power", after: 1 });
  let r = decide([res(power, "fail")], {}, 0);
  assert.equal(r.alerts.length, 1);
  r = decide([res(power, "skip")], r.state, 30_000);
  assert.equal(r.alerts.length, 0);
  r = decide([res(power, "ok")], r.state, 60_000);
  assert.deepEqual(r.alerts.map((a) => a.kind), ["recovered"]);

  const c = check();
  r = decide([res(c, "fail")], {}, 0);
  r = decide([res(c, "ok")], r.state, 30_000);
  assert.equal(r.alerts.length, 0); // never went red, so no "recovered" either
});

test("pmset: AC is fine, battery is a failure with the percent and time left, junk is unknown", () => {
  assert.deepEqual(parsePower("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true"), { ac: true, pct: 100, left: "0:00" });
  assert.deepEqual(parsePower("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=36372579)\t65%; discharging; 4:17 remaining present: true"), { ac: false, pct: 65, left: "4:17" });
  assert.equal(parsePower("pmset: command not found"), undefined);
});

test("server log lines: connection drops, handler errors, stuck sign-ups, inbound texts, a second server, Gemini errors", () => {
  assert.deepEqual(classifyLine("[imessage] financial: connection lost (fetch failed); retrying in 4 s"), { kind: "photon-drop", detail: "financial: fetch failed" });
  assert.equal(classifyLine("[imessage] shared: message stream ended; reconnecting"), undefined); // normal: it reconnects
  assert.equal(classifyLine("[imessage] financial: reconnected"), undefined);
  assert.equal(classifyLine("[imessage] handler error Error: boom")?.kind, "handler-error");
  assert.deepEqual(classifyLine("[signup] Sam +19195550123 (pending; photon: Target not allowed for this project)"), {
    kind: "signup-pending",
    detail: "Sam ***0123: Target not allowed for this project",
  });
  assert.equal(classifyLine("[signup] Sam +19195550123 (invited)"), undefined);
  assert.equal(classifyLine("[imessage] financial line=+16465550177 dm +19195550123: hey (space s1, msg m1)")?.kind, "inbound");
  // 86e0e93 dropped Inbound.kind (DMs only): the line has no "dm" any more, and group texts are logged as ignored.
  assert.equal(classifyLine("[imessage] financial line=+16465550177 +19195550123: hey (space s1, msg m1)")?.kind, "inbound");
  assert.equal(classifyLine("[imessage] ignored group message m9 from +19195550123")?.kind, "inbound"); // still proves we hear
  assert.equal(classifyLine("[imessage] lines: academic=? financial=? social=?"), undefined);
  assert.equal(classifyLine("Error: listen EADDRINUSE: address already in use :::3000")?.kind, "double-server");
  assert.deepEqual(classifyLine("[core] ERROR financial reply failed: Gemini gemini-3.6-flash → 429: quota exceeded"), { kind: "gemini", detail: "financial: 429" });
  assert.equal(classifyLine("[http] listening on :3000"), undefined);
});

test("flapping needs 2 drops inside the window; one drop is a blip", () => {
  assert.equal(flapping([100_000], 110_000, 120_000), false);
  assert.equal(flapping([0, 100_000], 110_000, 120_000), true);
  assert.equal(flapping([0, 100_000], 300_000, 120_000), false); // both aged out
});

test("stuck sign-ups: pending in the last 15 min, phones masked; unreadable state.json is skipped, not an alert", () => {
  const now = Date.parse("2026-10-11T05:00:00Z");
  const state = JSON.stringify({
    users: {
      "+19195550123": { phone: "+19195550123", name: "Sam", signupStatus: "pending", signedUpAt: "2026-10-11T04:55:00Z" },
      "+19195550199": { phone: "+19195550199", name: "Old", signupStatus: "pending", signedUpAt: "2026-10-11T04:00:00Z" },
      "+19195550111": { phone: "+19195550111", name: "Ok", signupStatus: "invited", signedUpAt: "2026-10-11T04:58:00Z" },
    },
  });
  assert.deepEqual(pendingSignups(state, now), ["Sam ***0123"]);
  assert.equal(pendingSignups('{"users": {"+1', now), undefined); // the server was mid-write: try next tick
  assert.equal(maskPhone("+19195550123"), "***0123");
});

test("log tail: starts at the end, reads appended lines, keeps a partial line, restarts on a new or truncated file", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const a = join(dir, "a.log");
  writeFileSync(a, "old line from before the watchdog\n");
  let r = readNew(a, undefined);
  assert.deepEqual(r.lines, []); // never replay history
  appendFileSync(a, "one\ntwo\nhal");
  r = readNew(a, r.cursor);
  assert.deepEqual(r.lines, ["one", "two"]);
  appendFileSync(a, "f\n");
  r = readNew(a, r.cursor);
  assert.deepEqual(r.lines, ["half"]);
  writeFileSync(a, "x\n"); // truncated (log rotated): start over at its end
  r = readNew(a, r.cursor);
  assert.deepEqual(r.lines, []);
  const b = join(dir, "b.log"); // the server restarted with a new log file
  writeFileSync(b, "boot\n");
  r = readNew(b, r.cursor);
  assert.deepEqual(r.lines, []);
  assert.equal(readNew(join(dir, "missing.log"), r.cursor).cursor, undefined);
});
