// THE TEMPLATE: to add a tool, copy this object, rename it, change description/parameters/run,
// and add it to the `tools` array at the bottom. Test it with:  npm run chat -- academic
import type { Tool } from "../../core/types.ts";
import { getAssignments, getGrades, describe, TAG } from "./canvas.ts";
import { checkPlanConflicts } from "./conflicts.ts";

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
    const want = typeof args.course === "string" ? args.course.replace(/\s+/g, "").toUpperCase() : "";
    const pick = want ? courses.filter((c) => c.code.replace(/\s+/g, "").toUpperCase().includes(want)) : courses;
    if (pick.length === 0) return `No class matching "${args.course}". Classes: ${courses.map((c) => c.code).join(", ")}.`;
    return pick
      .map((c) => {
        const work = graded
          .filter((a) => a.course === c.code)
          .map((a) => `  - ${a.name}${TAG[a.type ?? ""] ?? ""}: ${a.score}/${a.points}`)
          .join("\n");
        return `${c.code} ${c.name}: ${c.grade !== undefined ? `${c.grade}%` : "no grade yet"}${work ? `\n${work}` : ""}`;
      })
      .join("\n");
  },
};

export const tools: Tool[] = [getDueAssignments, getGradesTool, checkPlanConflicts];
