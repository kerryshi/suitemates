// Plan vs deadline: what's due during a plan's day (or weekend) and the day right after it.
import type { Ctx, Tool } from "../../core/types.ts";
import { fmtWhen } from "../../core/kit.ts";
import { getAssignments, describe } from "./canvas.ts";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface Window {
  label: string;
  start: Date;
  end: Date; // exclusive
}

// "saturday", "sat", "today", "tonight", "tomorrow", "this weekend", "2026-10-17". Undefined if unreadable.
export function planWindow(day: string, now: Date): Window | undefined {
  const d = day.trim().toLowerCase();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const span = (label: string, start: Date, days: number): Window => ({ label, start, end: new Date(start.getTime() + days * DAY_MS) });
  const plus = (n: number) => {
    const s = new Date(today);
    s.setDate(s.getDate() + n);
    return s;
  };

  // Each window covers the plan day plus the day after (a Sunday 11:59 PM deadline collides with a Saturday trip).
  if (d === "today" || d === "tonight") return span(d, today, 2);
  if (d === "tomorrow") return span(d, plus(1), 2);
  if (d.includes("weekend")) {
    const sat = (6 - today.getDay() + 7) % 7;
    return span("this weekend", plus(today.getDay() === 0 ? 0 : sat), today.getDay() === 0 ? 2 : 3);
  }
  const wd = WEEKDAYS.indexOf(d.replace(/^(this|next)\s+/, "").slice(0, 3));
  if (wd >= 0) {
    const s = plus((wd - today.getDay() + 7) % 7);
    return span(s.toLocaleDateString("en-US", { weekday: "long" }), s, 2);
  }
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return span(d, new Date(+iso[1], +iso[2] - 1, +iso[3]), 2);
  return undefined;
}

export const checkPlanConflicts: Tool = {
  name: "check_plan_conflicts",
  description:
    "Check whether a plan (a trip, party, concert, game, going out tonight, Friday, Saturday, Sunday, the weekend) collides with schoolwork. " +
    "Returns what's due on that day or the day after, plus any exam in the two days that follow. " +
    "Use this whenever the student mentions a plan with a day attached.",
  parameters: {
    properties: {
      day: {
        type: "string",
        description: "When the plan is: 'today', 'tonight', 'tomorrow', a weekday like 'saturday', 'this weekend', or YYYY-MM-DD.",
      },
    },
  },
  async run(args, ctx) {
    const asked = typeof args.day === "string" ? args.day : "";
    // A day we can't read is never "clear" (Dean told a student "clear for fall break" on a 3-day fallback, 2026-10-11).
    if (asked.trim() && !planWindow(asked, ctx.now)) return `Couldn't read "${asked}" as a day. Ask which day the plan is (a weekday, "this weekend", or YYYY-MM-DD). Don't tell them they're clear.`;
    const win = planWindow(asked, ctx.now) ?? { label: "the next 3 days", start: ctx.now, end: new Date(ctx.now.getTime() + 3 * DAY_MS) };
    const all = await getAssignments(ctx);
    const during = all.filter((a) => a.due >= win.start && a.due < win.end && a.due >= ctx.now);
    const examsAfter = all.filter((a) => a.type === "exam" && a.due >= win.end && a.due.getTime() < win.end.getTime() + 2 * DAY_MS);

    const head = win.label !== "the next 3 days" ? `Plan: ${win.label}.`
      : asked ? `Couldn't read "${asked}", so checking the next 3 days.` : "No day given, so checking the next 3 days.";
    const body = during.length
      ? `Due during it or right after:\n${during.map((a) => `- ${describe(a, ctx.now)}`).join("\n")}`
      : "Nothing due during it or right after. Clear.";
    const exams = examsAfter.length ? `\nExam coming up after: ${examsAfter.map((a) => describe(a, ctx.now)).join("; ")}` : "";
    return `${head}\n${body}${exams}`;
  },
};

// What Penny and Sunny may know (Persona.context): the next few days' load and the next exam. No grades.
export async function schoolContext(ctx: Ctx): Promise<string> {
  const upcoming = await getAssignments(ctx);
  const soon = upcoming.filter((a) => a.due.getTime() <= ctx.now.getTime() + 4 * DAY_MS);
  const byDay = new Map<string, string[]>();
  for (const a of soon) {
    const day = fmtWhen(a.due, ctx.now).split(" ")[0];
    byDay.set(day, [...(byDay.get(day) ?? []), `${a.course} ${a.name}`]);
  }
  const busiest = [...byDay].sort((x, y) => y[1].length - x[1].length)[0];
  const exam = upcoming.find((a) => a.type === "exam");
  return [
    soon.length ? `${soon.length} things due in the next 4 days${busiest && busiest[1].length > 1 ? ` (busiest: ${busiest[0]}, ${busiest[1].join(" + ")})` : ""}` : "nothing due in the next 4 days",
    exam ? `next exam: ${describe(exam, ctx.now)}` : "",
  ].filter(Boolean).join("; ") + ".";
}
