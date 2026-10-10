// Academic tools, triggers and routing over mock/canvas.json. Run: npx tsx --test personas/academic/*.test.ts
// "now" is pinned to Thursday 2026-10-08 10:00 local, so the mock's relative dates land on:
//   today (Thu): STOR 435 PS6 17:00, ENGL 105 post 23:59 · Sun: COMP 421 Project 1, COMP 577 HW2 · next Wed 9:30: STOR 435 Midterm 2
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../core/types.ts";
import { keywordRoute } from "../../core/router.ts";
import { loadPersonas } from "../../core/personas.ts";
import { tools } from "./tools.ts";
import { watch, triggers } from "./watch.ts";
import { planWindow } from "./conflicts.ts";

const NOW = new Date(2026, 9, 8, 10, 0);

const ctx = (now = NOW): Ctx => {
  const kv: Record<string, unknown> = {};
  return {
    user: { phone: "+19195550001", canvasLinked: true, onboardingStep: "done" },
    mock: true,
    now,
    kv: { get: <T>(k: string) => kv[k] as T | undefined, set: (k, v) => void (kv[k] = v) },
    log: () => {},
  };
};
const run = (name: string, args: Record<string, unknown> = {}) => tools.find((t) => t.name === name)!.run(args, ctx());

test("get_due_assignments lists the week soonest first and marks the exam", async () => {
  const lines = (await run("get_due_assignments")).split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^STOR 435: Problem Set 6, due today 5:00 PM, 20 pts$/);
  assert.match(lines[4], /^STOR 435: Midterm 2 \(EXAM\), due Wednesday 9:30 AM/);
});

test("get_due_assignments respects days", async () => {
  const out = await run("get_due_assignments", { days: 1 });
  assert.equal(out.split("\n").length, 2);
  assert.doesNotMatch(out, /Project 1/);
});

test("a Saturday plan collides with the Sunday-night deadlines", async () => {
  const out = await run("check_plan_conflicts", { day: "saturday" });
  assert.match(out, /^Plan: Saturday\./);
  assert.match(out, /COMP 421: Project 1: Buffer Pool Manager, due Sunday 11:59 PM/);
  assert.match(out, /COMP 577: HW2: Feature Matching/);
  assert.doesNotMatch(out, /Problem Set 6/);
});

test("a clear day says so and still warns about an exam right after", async () => {
  const out = await run("check_plan_conflicts", { day: "monday" });
  assert.match(out, /Nothing due during it or right after\. Clear\./);
  assert.match(out, /Exam coming up after: STOR 435: Midterm 2 \(EXAM\)/);
});

test("tonight skips what's already past and keeps what's still due", async () => {
  const evening = new Date(2026, 9, 8, 18, 0);
  const out = await tools.find((t) => t.name === "check_plan_conflicts")!.run({ day: "tonight" }, ctx(evening));
  assert.doesNotMatch(out, /Problem Set 6/); // was due at 5 PM
  assert.match(out, /ENGL 105: Discussion post/);
});

test("an unreadable day falls back to the next 3 days instead of guessing", async () => {
  const out = await run("check_plan_conflicts", { day: "whenever" });
  assert.match(out, /^Couldn't read "whenever", so checking the next 3 days\./);
  assert.match(out, /Problem Set 6/);
});

test("planWindow: weekend from a weekday is Sat through Mon; a weekday is that day plus the next", () => {
  const wk = planWindow("this weekend", NOW)!;
  assert.deepEqual([wk.start.getDate(), wk.end.getDate()], [10, 13]);
  const fri = planWindow("Friday", NOW)!;
  assert.deepEqual([fri.start.getDate(), fri.end.getDate(), fri.label], [9, 11, "Friday"]);
  assert.equal(planWindow("2026-10-20", NOW)!.start.getDate(), 20);
  assert.equal(planWindow("someday", NOW), undefined);
});

test("morning_due lists today's two items with one dedupe key per day", async () => {
  const [ev] = await triggers.morning_due(ctx());
  assert.match(ev.facts, /2 things due today: STOR 435 Problem Set 6 at 5:00 PM; ENGL 105 Discussion post/);
  assert.equal(ev.dedupeKey, "academic:morning:+19195550001:2026-10-08");
});

test("watch warns once per assignment due within 24h", async () => {
  const evs = await watch(ctx());
  assert.deepEqual(evs.map((e) => e.kind), ["due_within_24h", "due_within_24h"]);
  assert.equal(new Set(evs.map((e) => e.dedupeKey)).size, 2);
});

test("group chat: a plan with a day wakes Academic, small talk doesn't", () => {
  const personas = loadPersonas();
  assert.ok(keywordRoute("I'm going on the beach trip Saturday", personas).includes("academic"));
  assert.ok(keywordRoute("midterm is killing me", personas).includes("academic"));
  assert.ok(!keywordRoute("lol ok", personas).includes("academic"));
});
