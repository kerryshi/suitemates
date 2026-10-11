// THE TEMPLATE: to add a tool, copy this object, rename it, change description/parameters/run,
// and add it to the `tools` array at the bottom. Test it with:  npm run chat -- academic
import type { Tool } from "../../core/types.ts";
import { fmtWhen } from "../../core/kit.ts";
import { getAssignments, getGrades, getSnapshot, gradeImpact, describe, TAG, type Course } from "./canvas.ts";
import { checkPlanConflicts } from "./conflicts.ts";
import { calendarLink } from "./calendar.ts";

const getDueAssignments: Tool = {
  name: "get_due_assignments",
  description:
    "List the student's assignments, quizzes and exams due in the next N days, soonest first. " +
    "Use for 'what's due', 'any quizzes this week', 'when's my next exam', deadlines, or anything about upcoming schoolwork. " +
    "For plans with a day attached, use check_plan_conflicts instead.",
  parameters: {
    properties: {
      days: { type: "number", description: "How many days ahead to look. Default 7; use 14 for 'exams coming up'." },
      kind: {
        type: "string",
        description: "Only this kind of work. Default any.",
        enum: ["any", "assignment", "quiz", "exam"],
      },
    },
  },
  async run(args, ctx) {
    const days = typeof args.days === "number" && args.days > 0 ? args.days : 7;
    const kind = typeof args.kind === "string" && args.kind !== "any" ? args.kind : undefined;
    const until = ctx.now.getTime() + days * 86_400_000;
    const due = (await getAssignments(ctx)).filter(
      (a) => a.due.getTime() <= until && (!kind || (kind === "assignment" ? a.type !== "quiz" && a.type !== "exam" : a.type === kind)),
    );
    const label = kind === "quiz" ? "quizzes" : kind ? `${kind}s` : "work";
    if (due.length === 0) return `No ${label} due in the next ${days} days.`;
    return due.map((a) => describe(a, ctx.now)).join("\n");
  },
};

const key = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const matchCourses = (courses: Course[], want: string) =>
  courses.filter((c) => key(c.code).includes(key(want)) || key(c.name).includes(key(want)));
const noClass = (want: string, courses: Course[]) => `No class matching "${want}". Classes: ${courses.map((c) => c.code).join(", ")}.`;

const getGradesTool: Tool = {
  name: "get_grades",
  description:
    "The student's current grade in each class, and their scores on graded assignments, quizzes and exams. " +
    "Use for 'how are my grades', 'what did I get on the quiz', 'how am I doing in COMP 421'.",
  parameters: {
    properties: {
      course: { type: "string", description: "Course code like 'COMP 421' to show that class's graded work. Omit for all classes." },
    },
  },
  async run(args, ctx) {
    const { courses, graded } = await getGrades(ctx);
    const want = typeof args.course === "string" ? args.course : "";
    const pick = want ? matchCourses(courses, want) : courses;
    if (pick.length === 0) return noClass(want, courses);
    return pick
      .map((c) => {
        const work = graded
          .filter((a) => a.course === c.code)
          .slice(0, want ? 15 : 5) // newest first; one class gets more detail
          .map((a) => `  - ${a.name}${TAG[a.type ?? ""] ?? ""}: ${a.score}/${a.points}`)
          .join("\n");
        return `${c.code} ${c.name}: ${c.grade !== undefined ? `${c.grade}%` : "no grade yet"}${work ? `\n${work}` : ""}`;
      })
      .join("\n");
  },
};

const getAnnouncements: Tool = {
  name: "get_announcements",
  description:
    "Recent announcements from the student's professors, newest first: room changes, office hours, clarifications. " +
    "Use for 'any announcements', 'did my professor say anything', or when something about a class may have changed.",
  parameters: {
    properties: {
      days: { type: "number", description: "How many days back. Default 7." },
      course: { type: "string", description: "Only this class, like 'STOR 435'. Omit for all." },
    },
  },
  async run(args, ctx) {
    const days = typeof args.days === "number" && args.days > 0 ? args.days : 7;
    const since = ctx.now.getTime() - days * 86_400_000;
    const { announcements, courses } = await getSnapshot(ctx);
    const codes = typeof args.course === "string" ? matchCourses(courses, args.course).map((c) => c.code) : undefined;
    if (codes?.length === 0) return noClass(String(args.course), courses);
    const list = announcements
      .filter((n) => n.posted.getTime() >= since && (!codes || codes.includes(n.course)))
      .sort((a, b) => +b.posted - +a.posted);
    if (list.length === 0) return `No announcements in the last ${days} days.`;
    return list.map((n) => `${n.course} (${fmtWhen(n.posted, ctx.now)}): ${n.title}. ${n.message.slice(0, 280)}`).join("\n");
  },
};

const getSyllabus: Tool = {
  name: "get_syllabus",
  description:
    "A class's syllabus text: grading breakdown, exam policy, late policy, office hours. Use when they ask how a class is graded or about its rules.",
  parameters: {
    properties: { course: { type: "string", description: "Course code like 'COMP 421'." } },
    required: ["course"],
  },
  async run(args, ctx) {
    const { courses } = await getSnapshot(ctx);
    const want = String(args.course ?? "");
    const [c] = matchCourses(courses, want);
    if (!c) return noClass(want, courses);
    return c.syllabus ? `${c.code} syllabus: ${c.syllabus.slice(0, 1500)}` : `${c.code} has no syllabus posted on Canvas.`;
  },
};

const gradeImpactTool: Tool = {
  name: "grade_impact",
  description:
    "How much one upcoming assignment, quiz or exam can move the student's grade in that class: their grade if they skip it, " +
    "do half, or ace it (or a specific score). Use when they're deciding whether to skip or rush work for a plan, or ask 'what if I bomb X'.",
  parameters: {
    properties: {
      assignment: { type: "string", description: "Part of the assignment's name, like 'Project 1' or 'Midterm 2'." },
      course: { type: "string", description: "Course code if the name is ambiguous." },
      percent: { type: "number", description: "A specific score to check, 0-100. Optional." },
    },
    required: ["assignment"],
  },
  async run(args, ctx) {
    const snap = await getSnapshot(ctx);
    const name = key(String(args.assignment ?? ""));
    const codes = typeof args.course === "string" ? matchCourses(snap.courses, args.course).map((c) => c.code) : undefined;
    const today = new Date(ctx.now);
    today.setHours(0, 0, 0, 0);
    const a = snap.assignments
      .filter((x) => x.score === undefined && x.due >= today && key(x.name).includes(name) && (!codes || codes.includes(x.course)))
      .sort((x, y) => +x.due - +y.due)[0];
    if (!a) return `No upcoming assignment matching "${args.assignment}".`;
    const pcts = typeof args.percent === "number" ? [Math.max(0, Math.min(100, args.percent))] : [0, 50, 100];
    const rows = pcts.map((p) => ({ p, r: gradeImpact(snap, a, p) }));
    if (rows.some((x) => !x.r)) return `Can't estimate ${a.course} grades yet (nothing graded there).`;
    const label = (p: number) => (p === 0 ? "skip it" : p === 100 ? "ace it" : `get ${p}%`);
    const delta = (d: number) => `${d >= 0 ? "+" : ""}${Math.round(d * 10) / 10}`;
    return (
      `${describe(a, ctx.now)}. Current ${a.course} grade: ${rows[0].r!.before}%.\n` +
      rows.map(({ p, r }) => `If you ${label(p)}: about ${r!.after}% (${delta(r!.after - r!.before)})`).join("\n") +
      "\n(Estimate from what's graded so far and the class weights; later work softens the swing.)"
    );
  },
};

export const tools: Tool[] = [getDueAssignments, getGradesTool, getAnnouncements, getSyllabus, gradeImpactTool, checkPlanConflicts, calendarLink];
