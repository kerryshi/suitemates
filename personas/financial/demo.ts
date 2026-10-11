// Penny's intro, her line for the other agents, and the website's "try Penny" purchases (POST /try/financial).
// Mock mode: each person gets their own demo ledger (nessie.ts readExtras(phone)), so every judge has a Penny.
import type { Ctx, WatchEvent } from "../../core/types.ts";
import { getBalance, getPurchases, readExtras, realBank, writeExtras } from "./nessie.ts";
import { monthStats } from "./money.ts";

const SEEN_KEY = "seenPurchaseIds"; // watch.ts's baseline key
const MAX_DEMO_PER_HOUR = 12;
const money = (n: number) => `$${n.toFixed(2)}`;

// The purchases the site offers. Ids stay server-side so nobody can post arbitrary merchants or amounts.
export const DEMO_BUYS: Record<string, { merchant: string; amount: number; category: string; label: string }> = {
  doordash: { merchant: "DoorDash (Cosmic Cantina)", amount: 23.4, category: "delivery", label: "$23.40 DoorDash at 3 AM" },
  coffee: { merchant: "Starbucks", amount: 7.25, category: "coffee", label: "$7.25 Starbucks (again)" },
  groceries: { merchant: "Harris Teeter", amount: 38.6, category: "groceries", label: "$38.60 groceries" },
  concert: { merchant: "Ticketmaster", amount: 89, category: "entertainment", label: "$89 concert tickets" },
};

// Two texts: who Penny is (core sends her contact card right after), then where the month stands.
export async function intro(ctx: Ctx): Promise<WatchEvent[]> {
  const hello =
    `hey${ctx.user.name ? ` ${ctx.user.name}` : ""}, i'm Penny, your money person` +
    ` (${process.env.ACADEMIC_NAME || "Dean"} has school, ${process.env.SOCIAL_NAME || "Sunny"} has plans). ` +
    `how it works: i keep an eye on your spending against your monthly budget, text you when a purchase looks off, ` +
    `and before you buy something you can ask me "can i afford it?". ` +
    `and yes, i will absolutely say something about the 3 am DoorDash.`;
  const events: WatchEvent[] = [{ kind: "intro", userPhone: ctx.user.phone, facts: hello, verbatim: true, dedupeKey: `financial:intro:${ctx.user.phone}` }];
  const budget = ctx.user.budgetMonthly;
  if (budget) {
    const { left, perDay } = monthStats(await getPurchases(ctx), ctx.now, budget);
    const goal = ctx.user.savingsGoal ? ` saving for: ${ctx.user.savingsGoal}.` : "";
    events.push({
      kind: "intro_budget",
      userPhone: ctx.user.phone,
      // Honest about the numbers: anyone not on the owner's real account is on a demo bank (sample spending).
      facts: `this month: ${money(budget)} budget, ${money(left!)} left, about ${money(Math.max(0, perDay!))} a day.${goal}${realBank(ctx) ? "" : " (demo bank: sample spending, not your real account)"}`,
      dedupeKey: `financial:intro-budget:${ctx.user.phone}`,
    });
  }
  return events;
}

// What Dean and Sunny may know: how the month is going, in words. Never the balance or exact numbers.
export async function moneyContext(ctx: Ctx): Promise<string> {
  const budget = ctx.user.budgetMonthly;
  if (!budget) return "";
  const { left, daysLeft } = monthStats(await getPurchases(ctx), ctx.now, budget);
  const pace = left! / Math.max(1, daysLeft) / (budget / 30);
  const state = left! <= 0 ? "over budget this month" : pace < 0.6 ? "money is tight this month" : pace < 1 ? "spending is a bit fast this month" : "spending is on track this month";
  return `${state}; suggest free or cheap plans when it's tight.`;
}

// "try Penny" on the website: add one of DEMO_BUYS to this person's ledger; the watcher roasts it within WATCH_MS.
export async function tryBuy(action: string, ctx: Ctx): Promise<{ error: string } | { note: string }> {
  const buy = DEMO_BUYS[action];
  if (!buy) return { error: "Unknown purchase." };
  if (realBank(ctx)) return { error: "Demo purchases are for the demo bank; yours come from your real account." };
  const mine = readExtras(ctx.user.phone, { ownOnly: true });
  if (mine.filter((e) => Date.now() - Date.parse(e.at) < 3_600_000).length >= MAX_DEMO_PER_HOUR) {
    return { error: "That's a lot of shopping for one hour. Try again later." };
  }
  // Record what's already there first, so this purchase counts as new even if the watcher hasn't run for them yet.
  if (!ctx.kv.get<string[]>(SEEN_KEY)) ctx.kv.set(SEEN_KEY, (await getPurchases(ctx)).map((p) => p.id));
  const all = readExtras();
  writeExtras([...all, { id: `try-${Date.now()}`, merchant: buy.merchant, amount: buy.amount, at: ctx.now.toISOString(), category: buy.category, phone: ctx.user.phone }]);
  const balance = await getBalance(ctx);
  return { note: `Bought: ${buy.label}. Penny will text you in a few seconds. (Demo balance: ${money(balance)})` };
}
