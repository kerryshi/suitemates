// Proactive texts for Academic. Each returns WatchEvents; core writes the text in Academic's voice.
// If that LLM call fails, core sends `facts` as-is over iMessage, so they're written to the student ("you").
import type { Ctx, WatchEvent } from "../../core/types.ts";
import { fmtWhen, ymd } from "../../core/kit.ts";
import { describe, getAssignments, getSnapshot, isLive } from "./canvas.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Polled (only if "academic" is in WATCH): 24h warnings, a week's notice before each exam, and new announcements.
// Each fires once (dedupeKey).
export async function watch(ctx: Ctx): Promise<WatchEvent[]> {
  const now = ctx.now.getTime();
  const upcoming = await getAssignments(ctx);
  const events: WatchEvent[] = [];
  for (const a of upcoming) {
    const left = a.due.getTime() - now;
    if (left > 0 && left <= DAY) {
      events.push({
        kind: "due_within_24h",
        userPhone: ctx.user.phone,
        facts: `${a.course} ${a.name} is due ${fmtWhen(a.due, ctx.now)}. don't make me ask twice.`,
        dedupeKey: `academic:24h:${ctx.user.phone}:${a.id}:${ymd(a.due)}`,
      });
    }
    if (a.type === "exam" && left > DAY && left <= 7 * DAY) {
      const days = Math.round(left / DAY);
      events.push({
        kind: "exam_week",
        userPhone: ctx.user.phone,
        facts: `${a.course} ${a.name} is ${fmtWhen(a.due, ctx.now)}, ${days} days out. start reviewing today, a little every day. no cramming.`,
        dedupeKey: `academic:exam7:${ctx.user.phone}:${a.id}`,
      });
    }
  }
  const { announcements } = await getSnapshot(ctx);
  for (const n of announcements) {
    if (now - n.posted.getTime() > DAY || n.posted.getTime() > now) continue;
    events.push({
      kind: "announcement",
      userPhone: ctx.user.phone,
      facts: `new from ${n.course}: ${n.title}. ${n.message.slice(0, 220)}`,
      dedupeKey: `academic:ann:${ctx.user.phone}:${n.id}`,
    });
  }
  return events;
}

export const triggers = {
  // First text after sign-up: Dean introduces himself and what's due soonest. Fired by /demo/trigger (later: POST /signup).
  // Two texts: who Dean is (core sends his contact card right after it), then the first thing worth knowing.
  async intro(ctx: Ctx): Promise<WatchEvent[]> {
    const hello =
      `Hey${ctx.user.name ? ` ${ctx.user.name}` : ""}, I'm Dean, your school person` +
      ` (${process.env.FINANCIAL_NAME || "Penny"} has money, ${process.env.SOCIAL_NAME || "Sunny"} has plans). ` +
      `How it works: I keep track of your Canvas: deadlines, quizzes, exams and grades, ` +
      `and I'll give you a heads-up before anything's due. Text me "what's due?" anytime.` +
      (isLive(ctx) ? "" : " (for now that's a demo Canvas with sample classes, not your real one.)");
    const events: WatchEvent[] = [{ kind: "intro", userPhone: ctx.user.phone, facts: hello, verbatim: true, dedupeKey: `academic:intro:${ctx.user.phone}` }];
    const next = (await getAssignments(ctx))[0];
    if (next) {
      events.push({
        kind: "intro_next_up",
        userPhone: ctx.user.phone,
        facts: `first thing on your list: ${next.course} ${next.name}, due ${fmtWhen(next.due, ctx.now)}.`,
        dedupeKey: `academic:intro-next:${ctx.user.phone}`,
      });
    }
    return events;
  },

  // Every day at MORNING_AT (and on cue: npm run trigger -- academic morning_due): today's homework, plus tomorrow's.
  async morning_due(ctx: Ctx): Promise<WatchEvent[]> {
    const upcoming = await getAssignments(ctx);
    const today = upcoming.filter((a) => ymd(a.due) === ymd(ctx.now));
    const tomorrowYmd = ymd(new Date(ctx.now.getTime() + DAY));
    const tomorrow = upcoming.filter((a) => ymd(a.due) === tomorrowYmd);
    const facts =
      (today.length
        ? `morning. you've got ${today.length} thing${today.length > 1 ? "s" : ""} due today: ` +
          today.map((a) => `${a.course} ${a.name} at ${fmtWhen(a.due, ctx.now).replace("today ", "")}`).join("; ") + "."
        : "morning. nothing due today. don't get comfy.") +
      (tomorrow.length ? ` Tomorrow: ${tomorrow.map((a) => `${a.course} ${a.name}`).join("; ")}.` : "");
    return [{ kind: "morning_due", userPhone: ctx.user.phone, facts, dedupeKey: `academic:morning:${ctx.user.phone}:${ymd(ctx.now)}` }];
  },

  // Sunday evening (scheduler) or on cue: the week ahead by day, plus exams in the next two weeks.
  async weekly_plan(ctx: Ctx): Promise<WatchEvent[]> {
    const upcoming = await getAssignments(ctx);
    const end = ctx.now.getTime() + 7 * DAY;
    const week = upcoming.filter((a) => a.due.getTime() <= end);
    const byDay = new Map<string, string[]>();
    for (const a of week) {
      const day = a.due.toLocaleDateString("en-US", { weekday: "short" });
      byDay.set(day, [...(byDay.get(day) ?? []), `${a.course} ${a.name}${a.type === "exam" ? " (EXAM)" : a.type === "quiz" ? " (quiz)" : ""}`]);
    }
    const exams = upcoming.filter((a) => a.type === "exam" && a.due.getTime() > end && a.due.getTime() <= end + 7 * DAY);
    const facts = week.length
      ? `your week. ${[...byDay].map(([d, items]) => `${d}: ${items.join(", ")}`).join(" · ")}.` +
        (exams.length ? ` Exams after that: ${exams.map((a) => describe(a, ctx.now)).join("; ")}.` : "")
      : "your week is clear on canvas. nothing due for 7 days. enjoy it, quietly.";
    return [{ kind: "weekly_plan", userPhone: ctx.user.phone, facts, dedupeKey: `academic:week:${ctx.user.phone}:${ymd(ctx.now)}` }];
  },
};
