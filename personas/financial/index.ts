// Financial persona (owner: Kerry).
import type { Persona } from "../../core/types.ts";
import { loadText } from "../../core/kit.ts";
import { tools } from "./tools.ts";
import { watch, triggers } from "./watch.ts";
import { intro, moneyContext, tryBuy } from "./demo.ts";

const financial: Persona = {
  id: "financial",
  prompt: loadText(import.meta.url, "prompt.md"),
  routerLine:
    "Wake me for money: spending, buying, purchases, prices, cost, 'how much is…', afford, budget, savings, or any plan that costs money.",
  tools,
  watch,
  triggers: { ...triggers, intro },
  context: moneyContext,
  tryIt: tryBuy,
};

export default financial;
