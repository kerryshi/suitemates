// Proactive texts for Academic. Each returns WatchEvents; core writes the text in Academic's voice.
// If that LLM call fails, core sends `facts` as-is over iMessage, so they're written to the student ("you").
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
    facts: `Heads up: ${a.course} ${a.name} is due ${fmtWhen(a.due, ctx.now)}.`,
    dedupeKey: `academic:24h:${ctx.user.phone}:${a.id}:${ymd(a.due)}`,
  }));
}

export const triggers = {
  // First text after sign-up: Dean introduces himself and what's due soonest. Fired by /demo/trigger (later: POST /signup).
  async intro(ctx: Ctx): Promise<WatchEvent[]> {
    const next = (await getAssignments(ctx))[0];
    const facts =
      `Hey${ctx.user.name ? ` ${ctx.user.name}` : ""}, I'm Dean. I keep track of your Canvas deadlines so you don't have to. ` +
      (next ? `Next up: ${next.course} ${next.name}, due ${fmtWhen(next.due, ctx.now)}. ` : "") +
      `Text me "what's due?" anytime.`;
    return [{ kind: "intro", userPhone: ctx.user.phone, facts, dedupeKey: `academic:intro:${ctx.user.phone}` }];
  },

  // Scheduled at MORNING_AT, and fired on cue with: npm run trigger -- academic morning_due
  async morning_due(ctx: Ctx): Promise<WatchEvent[]> {
    const today = (await getAssignments(ctx)).filter((a) => ymd(a.due) === ymd(ctx.now));
    const facts = today.length
      ? `Morning! You have ${today.length} thing${today.length > 1 ? "s" : ""} due today: ` +
        today.map((a) => `${a.course} ${a.name} at ${fmtWhen(a.due, ctx.now).replace("today ", "")}`).join("; ") + "."
      : "Morning! Nothing is due today.";
    return [{ kind: "morning_due", userPhone: ctx.user.phone, facts, dedupeKey: `academic:morning:${ctx.user.phone}:${ymd(ctx.now)}` }];
  },
};
