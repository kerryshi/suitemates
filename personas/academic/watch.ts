// Proactive texts for Academic. Each returns WatchEvents; core writes the text in Academic's voice.
import type { Ctx, WatchEvent } from "../../core/types.ts";
import { fmtWhen, ymd } from "../../core/kit.ts";
import { getAssignments } from "./canvas.ts";

// Polled (only if "academic" is in WATCH): 24h warnings, once per assignment.
export async function watch(ctx: Ctx): Promise<WatchEvent[]> {
  const soon = (await getAssignments(ctx)).filter((a) => {
    const hours = (a.due.getTime() - ctx.now.getTime()) / 3_600_000;
    return hours > 0 && hours <= 24;
  });
  return soon.map((a) => ({
    kind: "due_within_24h",
    userPhone: ctx.user.phone,
    facts: `${a.course}: ${a.name} is due ${fmtWhen(a.due, ctx.now)}.`,
    dedupeKey: `academic:24h:${ctx.user.phone}:${a.id}:${ymd(a.due)}`,
  }));
}

export const triggers = {
  // Scheduled at MORNING_AT, and fired on cue with: npm run trigger -- academic morning_due
  async morning_due(ctx: Ctx): Promise<WatchEvent[]> {
    const today = (await getAssignments(ctx)).filter((a) => ymd(a.due) === ymd(ctx.now));
    const facts = today.length
      ? `Morning check-in. ${today.length} thing${today.length > 1 ? "s" : ""} due today: ` +
        today.map((a) => `${a.course} ${a.name} at ${fmtWhen(a.due, ctx.now).replace("today ", "")}`).join("; ") + "."
      : "Morning check-in. Nothing is due today.";
    return [{ kind: "morning_due", userPhone: ctx.user.phone, facts, dedupeKey: `academic:morning:${ctx.user.phone}:${ymd(ctx.now)}` }];
  },
};
