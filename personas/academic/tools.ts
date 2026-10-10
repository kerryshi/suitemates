// THE TEMPLATE: to add a tool, copy this object, rename it, change description/parameters/run,
// and add it to the `tools` array at the bottom. Test it with:  npm run chat -- academic
import type { Tool } from "../../core/types.ts";
import { fmtWhen } from "../../core/kit.ts";
import { getAssignments } from "./canvas.ts";

const getDueAssignments: Tool = {
  name: "get_due_assignments",
  description:
    "List the student's assignments and exams due in the next N days, soonest first. " +
    "Use for 'what's due', deadlines, 'do I have time for X', or anything about upcoming schoolwork. " +
    "Also use when they mention a plan (a trip, party, concert, tonight, the weekend, Friday/Saturday/Sunday) to check what collides with it.",
  parameters: {
    properties: {
      days: { type: "number", description: "How many days ahead to look. Default 7." },
    },
  },
  async run(args, ctx) {
    const days = typeof args.days === "number" && args.days > 0 ? args.days : 7;
    const until = ctx.now.getTime() + days * 86_400_000;
    const due = (await getAssignments(ctx)).filter((a) => a.due.getTime() <= until);
    if (due.length === 0) return `Nothing due in the next ${days} days.`;
    return due
      .map((a) => `${a.course}: ${a.name}${a.type === "exam" ? " (EXAM)" : ""}, due ${fmtWhen(a.due, ctx.now)}${a.points ? `, ${a.points} pts` : ""}`)
      .join("\n");
  },
};

export const tools: Tool[] = [getDueAssignments];
