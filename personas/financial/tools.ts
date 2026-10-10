// Financial tools (owner: Kerry). Same shape as personas/academic/tools.ts.
import type { Ctx, Tool } from "../../core/types.ts";
import { fmtWhen, loadMock } from "../../core/kit.ts";
import { getBalance, getPurchases } from "./nessie.ts";
import { affordVerdict, breakdownLine, matchActivity, monthStats, savingsTarget, type PlanCost } from "./money.ts";

const getRecentPurchases: Tool = {
  name: "get_recent_purchases",
  description:
    "List the student's purchases from the last N days (newest first) with totals by category, the account balance and their monthly budget. " +
    "Use for spending questions or reacting to what they bought.",
  parameters: {
    properties: {
      days: { type: "number", description: "How many days back. Default 7." },
    },
  },
  async run(args, ctx) {
    const days = typeof args.days === "number" && args.days > 0 ? args.days : 7;
    const since = ctx.now.getTime() - days * 86_400_000;
    const recent = (await getPurchases(ctx)).filter((p) => p.at.getTime() >= since && p.at <= ctx.now);
    const total = recent.reduce((s, p) => s + p.amount, 0);
    const lines = recent.map((p) => `${p.merchant} $${p.amount.toFixed(2)} ${fmtWhen(p.at, ctx.now)}${p.category ? ` [${p.category}]` : ""}`);
    return [
      `Balance: $${(await getBalance(ctx)).toFixed(2)}. Monthly budget: ${ctx.user.budgetMonthly ? `$${ctx.user.budgetMonthly}` : "unknown"}.`,
      `Last ${days} days: ${recent.length} purchases, $${total.toFixed(2)} total. By category: ${breakdownLine(recent) || "nothing"}.`,
      ...lines,
    ].join("\n");
  },
};

const canIAfford: Tool = {
  name: "can_i_afford",
  description:
    "Decide whether the student can afford a specific purchase right now, from their monthly budget, what they've spent this month, " +
    "and the days left. Returns a verdict (yes / tight / no) with the numbers. Use for 'can I afford X', 'should I buy X'.",
  parameters: {
    properties: {
      item: { type: "string", description: "What they want to buy, e.g. 'laptop'." },
      price: { type: "number", description: "Price in dollars." },
    },
    required: ["price"],
  },
  async run(args, ctx) {
    const price = toDollars(args.price);
    if (price === undefined) return "Need a price to check, e.g. 'can I afford a $40 hoodie?'";
    const item = typeof args.item === "string" && args.item ? args.item : "that";
    const balance = await getBalance(ctx);
    return affordText(item, price, await getPurchases(ctx), balance, ctx);
  },
};

const estimatePlanCost: Tool = {
  name: "estimate_plan_cost",
  description:
    "Estimate what a social plan or outing costs (e.g. 'beach trip', 'soccer', 'boba') and what share of the student's remaining " +
    "monthly budget it takes. Use whenever they mention going on a trip or outing.",
  parameters: {
    properties: {
      plan: { type: "string", description: "The plan in their words, e.g. 'beach trip Saturday'." },
    },
  },
  async run(args, ctx) {
    // Social's sign-up list is the only cost source we have (mock/students.json), in mock and real mode.
    const acts = loadMock<{ activities: PlanCost[] }>("students").activities;
    const plan = typeof args.plan === "string" ? args.plan : "";
    const hit = matchActivity(plan, acts);
    if (!hit) return `No cost estimate for "${plan}". Known plans: ${acts.map((a) => `${a.name} ~$${a.costEstimate}`).join("; ")}.`;
    const m = monthStats(await getPurchases(ctx), ctx.now, ctx.user.budgetMonthly);
    const share = m.left && m.left > 0 ? ` That's ${Math.round((hit.costEstimate / m.left) * 100)}% of the $${m.left.toFixed(2)} left in this month's budget (${m.daysLeft} days left).` : "";
    return `${hit.name} (${hit.when}) costs about $${hit.costEstimate} per person.${share}`;
  },
};

function affordText(item: string, price: number, purchases: Awaited<ReturnType<typeof getPurchases>>, balance: number, ctx: Ctx): string {
  const budget = ctx.user.budgetMonthly;
  const m = monthStats(purchases, ctx.now, budget);
  const target = savingsTarget(ctx.user.savingsGoal);
  const goal = target ? ` Savings goal: ${ctx.user.savingsGoal} (this price is ${Math.round((price / target) * 100)}% of the target).` : "";
  if (budget === undefined || m.left === undefined) {
    const verdict = price > balance ? "no" : price > balance * 0.5 ? "tight" : "yes";
    return `Verdict: ${verdict}. ${item} $${price.toFixed(2)}. No monthly budget set; balance $${balance.toFixed(2)}.${goal}`;
  }
  const v = affordVerdict(price, m.left, m.daysLeft, budget);
  return (
    `Verdict: ${v.verdict}. ${item} $${price.toFixed(2)}. Budget left this month: $${m.left.toFixed(2)} of $${budget}, ${m.daysLeft} days left. ` +
    `After buying: ~$${v.dailyAfter.toFixed(2)}/day for the rest of the month. Balance $${balance.toFixed(2)}.${goal}`
  );
}

function toDollars(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export const tools: Tool[] = [getRecentPurchases, canIAfford, estimatePlanCost];
