// Post a purchase on cue (the demo's "buy an energy drink" moment).
//   npm run buy -- Sheetz 4.29 [category]   MOCK=1 (default): queue it for the watcher; MOCK=0: POST it to Nessie
//   npm run buy -- --reset                  clear the mock queue
// The running server's watcher (WATCH_MS) picks it up and Penny roasts it.
import { loadDotEnv } from "../../core/env.ts";
import { postPurchase, readExtras, writeExtras, EXTRA_FILE } from "./nessie.ts";

loadDotEnv();
const args = process.argv.slice(2);
if (args[0] === "--reset") {
  writeExtras([]);
  console.log(`cleared ${EXTRA_FILE}`);
  process.exit(0);
}
const [merchant, rawAmount, category] = args;
const amount = Number((rawAmount ?? "").replace(/[$,]/g, ""));
if (!merchant || !(amount > 0)) {
  console.error('usage: npm run buy -- "<merchant>" <amount> [category]   e.g. npm run buy -- Sheetz 4.29');
  process.exit(1);
}

if (process.env.MOCK === "0") {
  const created = await postPurchase({ merchant, amount, now: new Date() });
  console.log(`posted to Nessie: ${merchant} $${amount.toFixed(2)} (purchase ${created?._id ?? "?"})`);
} else {
  writeExtras([...readExtras(), { id: `demo-${Date.now()}`, merchant, amount, at: new Date().toISOString(), ...(category ? { category } : {}) }]);
  console.log(`posted (mock): ${merchant} $${amount.toFixed(2)} → the watcher will pick it up within WATCH_MS`);
}
