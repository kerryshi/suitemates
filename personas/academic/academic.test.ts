// Academic tools, triggers and routing over mock-canvas.json. Run: npx tsx --test personas/academic/*.test.ts
// "now" is pinned to Thursday 2026-10-08 10:00 local, so the mock's relative dates land on:
//   Thu: STOR 435 PS6 17:00, ENGL 105 post 23:59 · Sat: COMP 421 Quiz 4 · Sun: COMP 421 Project 1, COMP 577 HW2
//   Mon: COMP 577 Quiz 3 · Tue: ENGL 105 Essay 2 draft · Wed 9:30: STOR 435 Midterm 2 · Sat 10/17: COMP 421 Midterm 2
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../core/types.ts";
import { keywordRoute } from "../../core/router.ts";
import { loadPersonas } from "../../core/personas.ts";
import { tools } from "./tools.ts";
import { watch, triggers } from "./watch.ts";
import { planWindow } from "./conflicts.ts";
import { courseCode, htmlToText, isLive, kindOf } from "./canvas.ts";

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
  assert.equal(lines.length, 8);
  assert.match(lines[0], /^STOR 435: Problem Set 6, due today 5:00 PM, 20 pts$/);
  assert.match(lines[7], /^STOR 435: Midterm 2 \(EXAM\), due Wednesday 9:30 AM/);
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
  const out = await run("check_plan_conflicts", { day: "2026-10-15" });
  assert.match(out, /Nothing due during it or right after\. Clear\./);
  assert.match(out, /Exam coming up after: COMP 421: Midterm 2 \(EXAM\)/);
});

test("kind filters to this week's quizzes, or exams over two weeks", async () => {
  assert.deepEqual((await run("get_due_assignments", { kind: "quiz" })).split("\n"), [
    "COMP 421: Quiz 4 (QUIZ), due Saturday 10:00 AM, 10 pts",
    "COMP 577: Quiz 3 (QUIZ), due Monday 1:00 PM, 10 pts",
  ]);
  const exams = await run("get_due_assignments", { kind: "exam", days: 14 });
  assert.match(exams, /^STOR 435: Midterm 2 \(EXAM\).*\nCOMP 421: Midterm 2 \(EXAM\)/);
  assert.equal(await run("get_due_assignments", { kind: "exam", days: 1 }), "No exams due in the next 1 days.");
});

test("get_grades shows every class grade with its graded work", async () => {
  const out = await run("get_grades");
  assert.match(out, /^COMP 421 Files and Databases: 91\.4%\n  - Quiz 3 \(QUIZ\): 9\/10/);
  assert.match(out, /STOR 435 Intro to Probability: 84\.7%/);
  assert.match(out, /  - Midterm 1 \(EXAM\): 78\/100/);
  assert.equal(out.match(/%/g)?.length, 4);
});

test("get_grades for one class, and an unknown class lists the real ones", async () => {
  const one = await run("get_grades", { course: "comp421" });
  assert.match(one, /^COMP 421/);
  assert.doesNotMatch(one, /STOR 435/);
  assert.match(await run("get_grades", { course: "BIOL 101" }), /No class matching "BIOL 101"\. Classes: COMP 421, STOR 435, COMP 577, ENGL 105\./);
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
  assert.match(ev.facts, /You have 2 things due today: STOR 435 Problem Set 6 at 5:00 PM; ENGL 105 Discussion post/);
  assert.equal(ev.dedupeKey, "academic:morning:+19195550001:2026-10-08");
});

test("watch: 24h warnings, a week's notice per exam, and announcements from the last day, each once", async () => {
  const evs = await watch(ctx());
  assert.deepEqual(evs.map((e) => e.kind), ["due_within_24h", "due_within_24h", "exam_week", "announcement", "announcement"]);
  assert.equal(new Set(evs.map((e) => e.dedupeKey)).size, 5);
  assert.equal(evs[2].facts, "Exam coming up: STOR 435 Midterm 2 is Wednesday 9:30 AM, 6 days out. Start reviewing now, a little each day.");
  assert.match(evs[3].facts, /^New announcement in STOR 435: Midterm 2 room change\. Midterm 2 is in Hamilton 100/);
  assert.match(evs[4].facts, /^New announcement in COMP 421: Project 1 autograder is live/); // 3-day-old HW2 note is not repeated
});

test("weekly_plan groups the week by day and flags exams after it", async () => {
  const [ev] = await triggers.weekly_plan(ctx());
  assert.match(ev.facts, /^Your week: Thu: STOR 435 Problem Set 6, ENGL 105 Discussion post: source analysis · Sat: COMP 421 Quiz 4 \(quiz\)/);
  assert.match(ev.facts, /Wed: STOR 435 Midterm 2 \(EXAM\)\./);
  assert.match(ev.facts, /Exams after that: COMP 421: Midterm 2 \(EXAM\)/);
});

test("morning_due adds tomorrow's work", async () => {
  const [ev] = await triggers.morning_due(ctx(new Date(2026, 9, 10, 8, 0))); // on a Saturday, Sunday's project is "tomorrow"
  assert.match(ev.facts, /^Morning! You have 2 things due today: .* Tomorrow: COMP 421 Project 1: Buffer Pool Manager\.$/);
});

test("grade_impact shows skip / half / ace against the current grade", async () => {
  const out = await run("grade_impact", { assignment: "midterm 2", course: "STOR" });
  assert.match(out, /^STOR 435: Midterm 2 \(EXAM\).*Current STOR 435 grade: 84\.7%\./);
  const [skip, half, ace] = [...out.matchAll(/about ([\d.]+)%/g)].map((m) => Number(m[1]));
  assert.ok(skip < half && half < ace, out);
  assert.ok(ace > 84.7 && skip < 84.7);
  assert.match(await run("grade_impact", { assignment: "Quiz 4", percent: 80 }), /If you get 80%: about [\d.]+%/);
  assert.equal(await run("grade_impact", { assignment: "nope" }), 'No upcoming assignment matching "nope".');
});

test("announcements and syllabus tools", async () => {
  const anns = (await run("get_announcements")).split("\n");
  assert.equal(anns.length, 4);
  assert.match(anns[0], /^STOR 435 \(today 8:15 AM\): Midterm 2 room change\./);
  assert.equal((await run("get_announcements", { course: "comp 577" })).split("\n").length, 1);
  assert.match(await run("get_syllabus", { course: "stor435" }), /^STOR 435 syllabus: .*Lowest quiz dropped/);
});

test("live Canvas helpers: course codes, exam vs practice, html", () => {
  assert.equal(courseCode("COMP311.001.FA26"), "COMP 311");
  assert.equal(courseCode("UNC Advising - Class of 2028"), "UNC Advising - Class of 2028");
  assert.equal(kindOf({ name: "Midterm 2 Take-Home Due" }), "exam");
  assert.equal(kindOf({ name: "Optional Midterm 1 Timed Practice" }), "assignment");
  assert.equal(kindOf({ name: "Midterm practice quiz" }), "quiz");
  assert.equal(kindOf({ name: "Reading response", submission_types: ["discussion_topic"] }), "discussion");
  assert.equal(htmlToText("<p>Room&nbsp;change:</p><p>Hamilton &amp; 100</p>"), "Room change:\nHamilton & 100");
});

test("live Canvas only for the token's owner, never another phone", () => {
  const env = { ...process.env };
  try {
    Object.assign(process.env, { CANVAS_TOKEN: "x", CANVAS_OWNER_PHONE: "+1 (919) 555-0001", CANVAS_LIVE: "1" });
    assert.equal(isLive(ctx()), true);
    assert.equal(isLive({ ...ctx(), user: { ...ctx().user, phone: "+19195550002" } }), false);
    delete process.env.CANVAS_OWNER_PHONE;
    assert.equal(isLive(ctx()), false);
  } finally {
    process.env = env;
  }
});

test("group chat: a plan with a day wakes Academic, small talk doesn't", () => {
  const personas = loadPersonas();
  assert.ok(keywordRoute("I'm going on the beach trip Saturday", personas).includes("academic"));
  assert.ok(keywordRoute("midterm is killing me", personas).includes("academic"));
  assert.ok(!keywordRoute("lol ok", personas).includes("academic"));
});

test("proactive facts read as a text to the student (core sends them raw if Gemini fails)", async () => {
  const [ev] = await watch(ctx());
  assert.equal(ev.facts, "Heads up: STOR 435 Problem Set 6 is due today 5:00 PM.");
});

test("intro: first who Dean is (no assignments), then the next deadline as its own text", async () => {
  const [hello, next] = await triggers.intro(ctx());
  assert.equal(hello.kind, "intro");
  assert.match(hello.facts, /^Hey, I'm Dean\. I keep track of your Canvas.*Text me "what's due\?" anytime\.$/);
  assert.doesNotMatch(hello.facts, /STOR|due today/);
  assert.equal(hello.dedupeKey, "academic:intro:+19195550001");
  assert.equal(next.kind, "intro_next_up");
  assert.equal(next.facts, "First thing on your list: STOR 435 Problem Set 6, due today 5:00 PM.");
});
