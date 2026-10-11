// Sunny's part of the shared calendar (core/calendar.ts → /cal/<token>.ics → Google Calendar "From URL"):
// the plans this student joined. Plan times are free text on the board ("Sunday 4 PM", "tonight", "tomorrow at
// 3pm", "Sun 4-6 p.m."), read from the day each plan was made so an event never moves; a plan with no day is left off.
import type { CalendarItem, Ctx, Tool } from "../../core/types.ts";
import { calUrl, relativeDate } from "../../core/kit.ts";
import { loadBoard, nameOf } from "./board.ts";

const HOUR = 3_600_000;
const PLAN_HOURS = 2; // a plan is a 2-hour block unless we know better
const DAYS: Record<string, string> = {
  sunday: "sun", sun: "sun", monday: "mon", mon: "mon", tuesday: "tue", tue: "tue", tues: "tue",
  wednesday: "wed", wed: "wed", thursday: "thu", thu: "thu", thur: "thu", thurs: "thu",
  friday: "fri", fri: "fri", saturday: "sat", sat: "sat",
};

// Times people type: "4pm", "4 p.m.", "4p", "4:30", "4.30pm", "16:00", and ranges "4-6 PM" / "11am to 1pm".
const TIME = /(?<![\da-z.:])(\d{1,2})(?:[:.](\d{2}))?\s*(?:(a|p)\.?\s*m?\.?)?(?![\da-z])/g;
const RANGE_SEP = /^\s*(?:-|–|to|until|till)\s*$/;

type Clock = { h: number; m: number; mer?: "a" | "p" };

// No am/pm: 1–8 means afternoon/evening (nobody plays soccer at 4 AM), 9–11 morning, 12 noon, 13+ is 24-hour.
function to24(c: Clock, fallbackMer?: "a" | "p"): number {
  const mer = c.mer ?? fallbackMer;
  if (mer === "p") return c.h % 12 + 12;
  if (mer === "a") return c.h % 12;
  if (c.h >= 13 || c.h === 12) return c.h;
  return c.h <= 8 ? c.h + 12 : c.h;
}

const at = (base: Date, h: number, m: number) => {
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
};

// A plan's time, read from the day it was made (`anchor`), so it never drifts on later feed refreshes:
// "tomorrow at 3pm" stays the day after it was made, "Sunday 4 PM" is the first Sunday 4 PM after it was made.
// No time → a default for the part of day ("tonight"/"night"/"evening" 8 PM, "afternoon" 3 PM, "morning" 10 AM,
// otherwise noon), marked untimed. No day at all → undefined (it can't be placed).
export function parseWhen(when: string, anchor: Date): { start: Date; end?: Date; timed: boolean } | undefined {
  const t = when.toLowerCase();
  const words: string[] = t.match(/[a-z]+/g) ?? [];
  const weekday = words.map((w) => DAYS[w] ?? DAYS[w.replace(/s$/, "")]).find(Boolean); // "sundays" too
  const rel = words.includes("tonight") || words.includes("today") ? 0 : words.includes("tomorrow") || words.includes("tmrw") ? 1 : undefined;
  if (!weekday && rel === undefined) return undefined;

  const clocks = [...t.matchAll(TIME)]
    .map((m) => ({ h: Number(m[1]), m: Number(m[2] ?? 0), mer: m[3] as Clock["mer"], i: m.index!, len: m[0].length }))
    .filter((c) => c.h <= 23 && c.m <= 59);
  let startHM: [number, number] | undefined;
  let endHM: [number, number] | undefined;
  if (clocks.length) {
    const [a, b] = clocks;
    const isRange = b && RANGE_SEP.test(t.slice(a.i + a.len, b.i));
    startHM = [to24(a, isRange ? b.mer : undefined), a.m];
    if (isRange) endHM = [to24(b, a.mer && !b.mer ? a.mer : undefined), b.m];
  } else if (words.includes("noon")) startHM = [12, 0];
  const timed = startHM !== undefined;
  startHM ??=
    words.includes("tonight") || words.includes("night") || words.includes("evening")
      ? [20, 0]
      : words.includes("afternoon")
        ? [15, 0]
        : words.includes("morning")
          ? [10, 0]
          : [12, 0];

  let day: Date;
  if (weekday) {
    day = relativeDate(anchor, { dueWeekday: weekday, time: "12:00" });
    // Same weekday as the day it was made, but that time had already passed → the following week.
    if (at(day, ...startHM).getTime() < anchor.getTime() - PLAN_HOURS * HOUR) day.setDate(day.getDate() + 7);
  } else {
    day = new Date(anchor);
    day.setDate(day.getDate() + (rel ?? 0));
  }
  const start = at(day, ...startHM);
  let end = endHM ? at(day, ...endHM) : undefined;
  if (end && end <= start) end = new Date(end.getTime() + 12 * HOUR); // "11-1" → 11 AM to 1 PM
  return { start, ...(end ? { end } : {}), timed };
}

export async function plansCalendar(ctx: Ctx): Promise<CalendarItem[]> {
  const b = loadBoard();
  const me = ctx.user.phone;
  return b.activities
    .filter((a) => a.signups.includes(me))
    .flatMap((a) => {
      // Read from the day the plan was made (seeded plans: the day the board was set up), not from now.
      const w = parseWhen(a.when, new Date(a.createdAt ?? b.seededAt ?? ctx.now.getTime()));
      if (!w) return [];
      const others = a.signups.filter((p) => p !== me).map((p) => nameOf(b, p, ctx));
      const note =
        `With ${others.length ? others.join(", ") : "just you so far"}` +
        (a.costEstimate ? `, about $${a.costEstimate}` : "") +
        (w.timed ? "" : `. Time not set yet ("${a.when}")`) +
        " (from Sunny)";
      return [{ id: `social:${a.id}`, title: a.name, start: w.start, end: w.end ?? new Date(w.start.getTime() + PLAN_HOURS * HOUR), note }];
    });
}

// Someone who signed up only with Sunny has no Dean to hand them the link, so Sunny can too.
export const calendarLink: Tool = {
  name: "calendar_link",
  description:
    "The student's private calendar link: the plans they joined (and the other agents' items) for Google Calendar or iPhone. " +
    "Use when they ask to put plans in their calendar, sync with Google Calendar, or see everything in one place.",
  parameters: { properties: {} },
  async run(_args, ctx) {
    return (
      `Their private calendar link: ${calUrl(ctx.user.phone)}\n` +
      "To add it: Google Calendar on a computer → Other calendars (+) → From URL → paste → Add calendar; it updates on its own. " +
      "On iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar. " +
      "The link is private: anyone with it can see their plans."
    );
  },
};
