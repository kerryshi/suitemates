// Penny noticing habits: two tools (spending_patterns, habit_swap) and two proactive texts (ask about a habit she
// spotted, a weekly heads-up when spending speeds up). All numbers from patterns.ts; Penny only words them.
import type { Ctx, Tool, WatchEvent } from "../../core/types.ts";
import { getPurchases, realBank } from "./nessie.ts";
import { categoryShifts, findHabits, patternReport, swapSavings, trend, weeklyTotals } from "./patterns.ts";

const ASKED_KEY = "askedHabits";
const LAST_KEY = "lastInsightAt";
const INSIGHT_GAP_MS = 12 * 3_600_000;

export const spendingPatterns: Tool = {
  name: "spending_patterns",
  description:
    "The student's spending habits and how their spending is changing: repeat purchases at the same place (with monthly and " +
    "semester cost), the last 2 weeks vs the 2 before, whether it's speeding up or slowing down, and categories that shifted " +
    "(e.g. delivery up, groceries down). Use for 'how's my spending', 'am I doing better', 'where is my money going', habits.",
  parameters: { properties: {} },
  async run(_args, ctx) {
    return (
      patternReport(await getPurchases(ctx), ctx.now) +
      "\nIf you don't know what they buy at a habit place, ask them (don't guess), then use habit_swap."
    );
  },
};

export const habitSwap: Tool = {
  name: "habit_swap",
  description:
    "What swapping one spending habit for a cheaper version saves per week, month and semester, and how fast that reaches their " +
    "savings goal. Use after they tell you what they buy at a place (\"coffee at Sheetz\", \"snacks at Circle K\").",
  parameters: {
    properties: {
      place: { type: "string", description: "Where, e.g. 'Sheetz', 'Circle K', 'DoorDash'." },
      item: { type: "string", description: "What they buy there, in their words, e.g. 'coffee', 'monster', 'chips'." },
    },
    required: ["item"],
  },
  async run(args, ctx) {
    const habits = findHabits(await getPurchases(ctx), ctx.now);
    if (habits.length === 0) return "No repeat habits in their last 4 weeks of spending.";
    const place = String(args.place ?? "").toLowerCase().replace(/\s+/g, "");
    const h = place ? habits.find((x) => x.key.replace(/\s+/g, "").includes(place) || place.includes(x.key.replace(/\s+/g, ""))) : habits[0];
    // Never answer about a different habit than the one they named.
    if (!h) return `No repeat habit at ${String(args.place)} in their last 4 weeks. Their repeat places: ${habits.map((x) => x.key).join(", ")}.`;
    return swapSavings(h, String(args.item ?? ""), ctx.user.savingsGoal);
  },
};

// Proactive: ask about the most frequent habit once (Penny doesn't know what they buy at a gas station), and a
// weekly heads-up when spending is up 25%+ on the 2 weeks before.
export async function insightEvents(ctx: Ctx): Promise<WatchEvent[]> {
  // Habit texts run on the demo bank only: never on the owner's real account (one Nessie call fewer per poll, and its
  // numbers are never presented to anyone as their own habits).
  if (realBank(ctx)) return [];
  // One noticed-pattern text per 12 hours: a habit question and a trend alert back to back read like spam.
  const last = ctx.kv.get<number>(LAST_KEY);
  if (last && ctx.now.getTime() - last < INSIGHT_GAP_MS) return [];
  const all = await getPurchases(ctx);
  const events: WatchEvent[] = [];
  const asked = ctx.kv.get<string[]>(ASKED_KEY) ?? [];
  const habit = findHabits(all, ctx.now)
    .filter((h) => !asked.includes(h.key) && h.category !== "subscription")
    .sort((a, b) => b.count - a.count)[0];
  if (habit) {
    ctx.kv.set(ASKED_KEY, [...asked, habit.key]);
    events.push({
      kind: "habit_question",
      userPhone: ctx.user.phone,
      facts:
        `noticed a pattern: ${habit.merchant} ${habit.count} times in the last 4 weeks, about $${habit.avg.toFixed(2)} each, ~$${habit.monthly.toFixed(0)} a month. ` +
        `ask what they usually get there. don't guess and don't lecture yet.`,
      dedupeKey: `financial:habit:${ctx.user.phone}:${habit.key}`,
    });
    ctx.kv.set(LAST_KEY, ctx.now.getTime());
    return events;
  }
  const t = trend(weeklyTotals(all, ctx.now));
  // A real baseline first: "+100%" from a fortnight with no spending is noise, not a trend.
  if (t.direction === "up" && t.change >= 0.25 && t.prior2 >= 50) {
    ctx.kv.set(LAST_KEY, ctx.now.getTime());
    const shift = categoryShifts(all, ctx.now)[0];
    const week = Math.floor(ctx.now.getTime() / (7 * 86_400_000));
    events.push({
      kind: "spending_trend",
      userPhone: ctx.user.phone,
      facts:
        `spending check: last 2 weeks $${t.last2.toFixed(0)} vs $${t.prior2.toFixed(0)} the 2 weeks before (+${Math.round(t.change * 100)}%), ${t.speed}.` +
        (shift ? ` biggest shift: ${shift.category} $${shift.t.last2.toFixed(0)} vs $${shift.t.prior2.toFixed(0)}.` : "") +
        ` one concrete change to try this week, no investing talk.`,
      dedupeKey: `financial:trend:${ctx.user.phone}:${week}`,
    });
  }
  return events;
}
