// Financial persona (owner: Kerry).
import type { Persona } from "../../core/types.ts";
import { loadText } from "../../core/kit.ts";
import { tools } from "./tools.ts";
import { watch, triggers } from "./watch.ts";
import { intro, moneyContext, tryBuy } from "./demo.ts";
import { habitSwap, insightEvents, spendingPatterns } from "./insights.ts";

const financial: Persona = {
  id: "financial",
  prompt: loadText(import.meta.url, "prompt.md"),
  routerLine:
    "Wake me for money: spending, buying, purchases, prices, cost, 'how much is…', afford, budget, savings, spending habits or patterns, or any plan that costs money.",
  tools: [...tools, spendingPatterns, habitSwap],
  // New purchases (watch.ts), then habits she noticed and spending speeding up (insights.ts).
  watch: async (ctx) => [...(await watch(ctx)), ...(await insightEvents(ctx))],
  triggers: { ...triggers, intro },
  context: moneyContext,
  tryIt: tryBuy,
};

export default financial;
