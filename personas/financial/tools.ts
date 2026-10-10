// Financial tools (owner: Kerry). Copy getRecentPurchases to add one; see personas/academic/tools.ts.
import type { Tool } from "../../core/types.ts";
import { fmtWhen } from "../../core/kit.ts";
import { getBalance, getPurchases } from "./nessie.ts";

const getRecentPurchases: Tool = {
  name: "get_recent_purchases",
  description:
    "List the student's purchases from the last N days (newest first) with the account balance and their monthly budget. " +
    "Use for spending questions, 'can I afford X', or reacting to what they bought.",
  parameters: {
    properties: {
      days: { type: "number", description: "How many days back. Default 7." },
    },
  },
  async run(args, ctx) {
    const days = typeof args.days === "number" && args.days > 0 ? args.days : 7;
    const since = ctx.now.getTime() - days * 86_400_000;
    const recent = (await getPurchases(ctx)).filter((p) => p.at.getTime() >= since);
    const total = recent.reduce((s, p) => s + p.amount, 0);
    const lines = recent.map((p) => `${p.merchant} $${p.amount.toFixed(2)} ${fmtWhen(p.at, ctx.now)}${p.category ? ` [${p.category}]` : ""}`);
    return [
      `Balance: $${(await getBalance(ctx)).toFixed(2)}. Monthly budget: ${ctx.user.budgetMonthly ? `$${ctx.user.budgetMonthly}` : "unknown"}.`,
      `Last ${days} days: ${recent.length} purchases, $${total.toFixed(2)} total.`,
      ...lines,
    ].join("\n");
  },
};

// TODO(financial): can_i_afford, set/check savings goal, estimate a plan's cost (mock/students.json has costEstimate).
export const tools: Tool[] = [getRecentPurchases];
