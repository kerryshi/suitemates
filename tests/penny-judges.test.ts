// The live server runs MOCK=0 for the owner's real Nessie account (the roast beat), while judges get Penny on a demo
// bank: their own sample history and demo purchases, never the owner's real account, never a Nessie call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MOCK_PURCHASES_FILE = join(mkdtempSync(join(tmpdir(), "penny-judges-")), "purchases.json");
process.env.NESSIE_OWNER_PHONE = "+19195550002";
process.env.NESSIE_API_KEY = "k";
process.env.NESSIE_ACCOUNT_ID = "acct";
const { getPurchases, getBalance, writeExtras, realBank } = await import("../personas/financial/nessie.ts");
const { insightEvents, habitSwap } = await import("../personas/financial/insights.ts");
const { tryBuy } = await import("../personas/financial/demo.ts");
const financial = (await import("../personas/financial/index.ts")).default;
import type { Ctx } from "../core/types.ts";

const OWNER = "+19195550002";
const JUDGE = "+19195550123";
const NOW = new Date(2026, 9, 11, 1, 30);
let fetches = 0;
let rows: unknown[] = [];
globalThis.fetch = (async (u: string | URL) => {
  fetches++;
  return new Response(JSON.stringify(String(u).includes("/purchases") ? rows : { balance: 500 }));
}) as typeof fetch;

function ctx(phone: string, mock = false, now = NOW): Ctx {
  const kv = new Map<string, unknown>();
  return {
    user: { phone, name: "Sam", budgetMonthly: 600, savingsGoal: "spring break, $400", canvasLinked: false, onboardingStep: "done", agents: ["social", "financial"], greeted: ["social", "financial"], signedUpAt: NOW.toISOString() },
    mock,
    now,
    kv: { get: <T>(k: string) => kv.get(k) as T, set: (k: string, v: unknown) => void kv.set(k, v) },
    log: () => {},
  };
}

test("MOCK=0: the owner is on the real bank; a judge is on a demo bank with sample history and never touches Nessie", async () => {
  assert.equal(realBank(ctx(OWNER)), true);
  assert.equal(realBank(ctx(JUDGE)), false);
  assert.equal(realBank(ctx(OWNER, true)), false, "MOCK=1: everyone is on demo data");
  fetches = 0;
  const judge = await getPurchases(ctx(JUDGE));
  await getBalance(ctx(JUDGE));
  assert.equal(fetches, 0, "a judge never hits the owner's Nessie account");
  assert.ok(judge.some((p) => p.simulated), "a judge gets sample history");
  rows = [{ _id: "r1", description: "Sheetz", amount: 4, purchase_date: "2026-10-10" }];
  const owner = await getPurchases(ctx(OWNER));
  assert.ok(fetches >= 1);
  assert.deepEqual(owner.map((p) => [p.merchant, Boolean(p.simulated)]), [["Sheetz", false]], "the owner sees real rows only, no sample history");
});

test("F1/F6: Penny's habit texts never run on the real account; a judge gets them from sample history, with no Nessie call", async () => {
  fetches = 0;
  rows = Array.from({ length: 9 }, (_, i) => ({ _id: `r${i}`, description: "Sheetz", amount: 4, purchase_date: "2026-10-0" + ((i % 9) + 1) }));
  assert.deepEqual(await insightEvents(ctx(OWNER)), [], "no insights from the owner's real account");
  assert.equal(fetches, 0, "and no extra Nessie call per poll for it");
  const judge = await insightEvents(ctx(JUDGE));
  assert.equal(judge.length, 1);
  assert.equal(judge[0].kind, "habit_question");
  assert.equal(fetches, 0);
});

test("F3: a spending-trend alert needs a real baseline, not 'up 100% from nothing'", async () => {
  // Someone whose only spending is this fortnight: last 2 weeks > 0, the 2 before = 0.
  const c = ctx(OWNER, true, NOW);
  c.user.signedUpAt = undefined; // no sample history: just the base mock file + this
  writeExtras([{ id: "x1", merchant: "Target", amount: 40, at: new Date(NOW.getTime() - 86_400_000).toISOString(), phone: OWNER }]);
  const evs = await insightEvents(c);
  assert.ok(!evs.some((e) => e.kind === "spending_trend" && /\+100%/.test(e.facts)), JSON.stringify(evs));
  writeExtras([]);
});

test("F5: habit_swap for a place that isn't a habit says so, instead of answering about another one", async () => {
  const out = await habitSwap.run({ place: "Trader Joe's", item: "snacks" }, ctx(JUDGE));
  assert.match(out, /No repeat habit at Trader Joe's/);
  assert.doesNotMatch(out, /DoorDash \(/);
});

test("try Penny works for a judge on MOCK=0 (their demo bank) and is refused for the owner's real account", async () => {
  const judge = await tryBuy("coffee", ctx(JUDGE));
  assert.ok("note" in judge, JSON.stringify(judge));
  const owner = await tryBuy("coffee", ctx(OWNER));
  assert.ok("error" in owner);
  writeExtras([]);
});

test("a judge's own demo purchase is roasted on MOCK=0; nobody else's ledger is", async () => {
  const c = ctx(JUDGE);
  await financial.watch!(c); // baseline
  writeExtras([
    { id: "mine", merchant: "Starbucks", amount: 7.25, at: NOW.toISOString(), phone: JUDGE },
    { id: "shared", merchant: "Sheetz", amount: 4, at: NOW.toISOString() }, // `npm run buy` in mock mode: nobody's on MOCK=0
    { id: "other", merchant: "Chipotle", amount: 12, at: NOW.toISOString(), phone: "+19195550999" },
  ]);
  const evs = (await financial.watch!(c)).filter((e) => e.kind === "purchase");
  assert.deepEqual(evs.map((e) => e.dedupeKey), [`purchase:${JUDGE}:mine`]);
  writeExtras([]);
});

test("a judge is told it's a demo bank (sample spending), the owner isn't", async () => {
  const judge = await financial.triggers!.intro(ctx(JUDGE));
  assert.ok(judge.some((e) => /demo bank/.test(e.facts)), JSON.stringify(judge.map((e) => e.facts)));
  rows = [];
  const owner = await financial.triggers!.intro(ctx(OWNER));
  assert.ok(!owner.some((e) => /demo bank/.test(e.facts)));
});
