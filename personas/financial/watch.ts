// Proactive texts for Financial (owner: Kerry).
import type { Ctx, WatchEvent } from "../../core/types.ts";
import { ymd } from "../../core/kit.ts";
import { getBalance, getPurchases } from "./nessie.ts";

// Polled every WATCH_MS (financial is in WATCH by default). Return one event per NEW purchase and core
// texts the user in Clover's voice. dedupeKey "purchase:<id>" makes sure each purchase is roasted once.
// TODO(financial): turn this on. Sketch:
//   const fresh = (await getPurchases(ctx)).filter((p) => ctx.now.getTime() - p.at.getTime() < 10 * 60_000);
//   return fresh.map((p) => ({ kind: "purchase", userPhone: ctx.user.phone,
//     facts: `New purchase: ${p.merchant} $${p.amount.toFixed(2)} at ${p.at.toLocaleTimeString()}.`, dedupeKey: `purchase:${p.id}` }));
export async function watch(_ctx: Ctx): Promise<WatchEvent[]> {
  return [];
}

export const triggers = {
  // Scheduled at WEEKLY_AT, and fired on cue with: npm run trigger -- financial weekly_money
  async weekly_money(ctx: Ctx): Promise<WatchEvent[]> {
    const weekAgo = ctx.now.getTime() - 7 * 86_400_000;
    const week = (await getPurchases(ctx)).filter((p) => p.at.getTime() >= weekAgo);
    const spent = week.reduce((s, p) => s + p.amount, 0);
    const weeklyBudget = ctx.user.budgetMonthly ? ctx.user.budgetMonthly / 4.3 : undefined;
    const facts =
      `Weekly money check-in. Spent $${spent.toFixed(2)} across ${week.length} purchases this week` +
      (weeklyBudget ? ` against a weekly budget of about $${weeklyBudget.toFixed(0)}` : "") +
      `. Balance $${(await getBalance(ctx)).toFixed(2)}.` +
      (ctx.user.savingsGoal ? ` Saving for: ${ctx.user.savingsGoal}.` : "");
    return [{ kind: "weekly_money", userPhone: ctx.user.phone, facts, dedupeKey: `financial:weekly:${ctx.user.phone}:${ymd(ctx.now)}` }];
  },
};
