// Proactive texts for Financial (owner: Kerry).
import type { Ctx, WatchEvent } from "../../core/types.ts";
import { ymd } from "../../core/kit.ts";
import { getBalance, getPurchases, type Purchase } from "./nessie.ts";
import { breakdownLine, diffNew, purchaseFacts } from "./money.ts";

const SEEN_KEY = "seenPurchaseIds";
const MAX_PER_POLL = 3; // after downtime, roast the newest few instead of flooding the thread
const LOW_BALANCE = 100;

export interface WatchDeps {
  getPurchases(ctx: Ctx): Promise<Purchase[]>;
  getBalance(ctx: Ctx): Promise<number>;
  owner?: string; // phone that owns the bank account; others get no purchase texts
}

const digits = (s?: string) => (s ?? "").replace(/\D/g, "").slice(-10);
const isOwner = (phone: string, owner = process.env.NESSIE_OWNER_PHONE) => !owner || digits(owner) === digits(phone);

// Polled every WATCH_MS (financial is in WATCH by default). One event per NEW purchase; core
// texts the user in Penny's voice from `facts`. The first poll only records what's already there.
export async function watchWith(ctx: Ctx, deps: WatchDeps): Promise<WatchEvent[]> {
  // One demo bank account: without this, every onboarded user is texted about every purchase.
  if (!isOwner(ctx.user.phone, deps.owner ?? "")) return [];
  const all = await deps.getPurchases(ctx);
  const balance = await deps.getBalance(ctx);
  const { baselined, fresh, seen } = diffNew(ctx.kv.get<string[]>(SEEN_KEY), all);
  ctx.kv.set(SEEN_KEY, seen);
  const events: WatchEvent[] = [];
  if (baselined) ctx.log(`baselined ${seen.length} purchases`);
  for (const p of fresh.slice(0, MAX_PER_POLL)) {
    const stamped = p.dateOnly && ymd(p.at) === ymd(ctx.now) ? { ...p, at: ctx.now, dateOnly: false } : p;
    const withStamp = all.map((x) => (x.id === p.id ? stamped : x));
    events.push({
      kind: "purchase",
      userPhone: ctx.user.phone,
      facts: purchaseFacts(stamped, withStamp, balance, ctx.user, ctx.now),
      dedupeKey: `purchase:${ctx.user.phone}:${p.id}`,
    });
  }
  if (balance < LOW_BALANCE) {
    events.push({
      kind: "low_balance",
      userPhone: ctx.user.phone,
      facts: `Low balance warning: $${balance.toFixed(2)} left in checking.`,
      dedupeKey: `financial:lowbal:${ctx.user.phone}:${ymd(ctx.now)}`,
    });
  }
  return events;
}

export const watch = (ctx: Ctx) => watchWith(ctx, { getPurchases, getBalance, owner: process.env.NESSIE_OWNER_PHONE });

export const triggers = {
  // Scheduled at WEEKLY_AT, and fired on cue with: npm run trigger -- financial weekly_money
  async weekly_money(ctx: Ctx): Promise<WatchEvent[]> {
    if (!isOwner(ctx.user.phone)) return []; // the account's numbers go to its owner only
    const weekAgo = ctx.now.getTime() - 7 * 86_400_000;
    const week = (await getPurchases(ctx)).filter((p) => p.at.getTime() >= weekAgo && p.at <= ctx.now);
    const spent = week.reduce((s, p) => s + p.amount, 0);
    const weeklyBudget = ctx.user.budgetMonthly ? ctx.user.budgetMonthly / 4.3 : undefined;
    const facts =
      `Weekly money check-in. Spent $${spent.toFixed(2)} across ${week.length} purchases this week` +
      (weeklyBudget ? ` against a weekly budget of about $${weeklyBudget.toFixed(0)}` : "") +
      `. By category: ${breakdownLine(week) || "nothing"}. Balance $${(await getBalance(ctx)).toFixed(2)}.` +
      (ctx.user.savingsGoal ? ` Saving for: ${ctx.user.savingsGoal}.` : "");
    return [{ kind: "weekly_money", userPhone: ctx.user.phone, facts, dedupeKey: `financial:weekly:${ctx.user.phone}:${ymd(ctx.now)}` }];
  },
};
