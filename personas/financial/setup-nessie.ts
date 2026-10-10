// One-time Nessie setup for the demo: customer → checking account → one merchant.
// Saves the ids to data/nessie.json (read by nessie.ts) and prints the .env lines.
//   npm run setup-nessie        (needs NESSIE_API_KEY in .env)
// UNVERIFIED until the first real run: the exact POST /merchants body Nessie accepts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadDotEnv } from "../../core/env.ts";
import { nessie, NESSIE_IDS_FILE } from "./nessie.ts";

loadDotEnv();
const START_BALANCE = Number(process.env.SEED_BALANCE ?? 412.55);
const address = { street_number: "201", street_name: "S Columbia St", city: "Chapel Hill", state: "NC", zip: "27599" };

if (existsSync(NESSIE_IDS_FILE)) {
  console.log(`already set up (${NESSIE_IDS_FILE}):\n${readFileSync(NESSIE_IDS_FILE, "utf8")}`);
  process.exit(0);
}
const customer = await nessie<{ _id: string }>("POST", "/customers", { first_name: "Demo", last_name: "Student", address });
const account = await nessie<{ _id: string }>("POST", `/customers/${customer._id}/accounts`, {
  type: "Checking",
  nickname: "Student Checking",
  rewards: 0,
  balance: START_BALANCE,
});
const merchant = await nessie<{ _id: string }>("POST", "/merchants", {
  name: "Franklin St Demo Merchant",
  category: "food",
  address,
  geocode: { lat: 35.9132, lng: -79.0558 },
});
const ids = { customerId: customer._id, accountId: account._id, merchantId: merchant._id };
mkdirSync(dirname(NESSIE_IDS_FILE), { recursive: true });
writeFileSync(NESSIE_IDS_FILE, JSON.stringify(ids, null, 2));
console.log(`created customer ${ids.customerId}, account ${ids.accountId} ($${START_BALANCE}), merchant ${ids.merchantId}`);
console.log(`\nadd to .env:\nNESSIE_ACCOUNT_ID=${ids.accountId}\nNESSIE_MERCHANT_ID=${ids.merchantId}\n\nthen: MOCK=0 npm run buy -- Sheetz 4.29`);
