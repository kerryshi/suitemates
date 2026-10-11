// Dean's part of the shared calendar (core/calendar.ts → /cal/<token>.ics → Google Calendar "From URL"):
// the next 3 weeks of deadlines, quizzes and exams that aren't turned in yet.
import type { CalendarItem, Ctx, Tool } from "../../core/types.ts";
import { calUrl } from "../../core/kit.ts";
import { getAssignments } from "./canvas.ts";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export async function schoolCalendar(ctx: Ctx): Promise<CalendarItem[]> {
  const until = ctx.now.getTime() + 21 * DAY;
  return (await getAssignments(ctx))
    .filter((a) => a.due.getTime() <= until)
    .map((a) =>
      a.type === "exam"
        ? // An exam's Canvas date is when it starts.
          { id: `academic:${a.id}`, title: `${a.course} ${a.name}`, start: a.due, end: new Date(a.due.getTime() + 75 * MIN), note: "Exam (from Canvas, via Dean)" }
        : // A deadline: a 30-min block ending when it's due, so it shows up before it's too late.
          {
            id: `academic:${a.id}`,
            title: `${a.course} ${a.name} due`,
            start: new Date(a.due.getTime() - 30 * MIN),
            end: a.due,
            note: `${a.type === "quiz" ? "Quiz" : "Due"}${a.points ? `, ${a.points} pts` : ""} (from Canvas, via Dean)`,
          },
    );
}

export const calendarLink: Tool = {
  name: "calendar_link",
  description:
    "The student's private calendar link with their deadlines and exams (and plans from the other agents) for Google Calendar. " +
    "Use when they ask to put deadlines in their calendar, sync with Google Calendar, or see everything in one place.",
  parameters: { properties: {} },
  async run(_args, ctx) {
    return (
      `Their private calendar link: ${calUrl(ctx.user.phone)}\n` +
      "To add it: open Google Calendar on a computer → Other calendars (+) → From URL → paste the link → Add calendar. " +
      "It updates on its own. On iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar. " +
      "Tell them the link is private: anyone with it can see their deadlines."
    );
  },
};
