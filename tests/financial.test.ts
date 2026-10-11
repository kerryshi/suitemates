import { test } from "node:test";
import assert from "node:assert/strict";
import { affordVerdict, categorize, diffNew, matchActivity, parsePurchaseDate, purchaseFacts } from "../personas/financial/money.ts";
import { watchWith } from "../personas/financial/watch.ts";
import financial from "../personas/financial/index.ts";
import { getPurchases, postPurchase, type Purchase } from "../personas/financial/nessie.ts";
import type { Ctx, UserProfile } from "../core/types.ts";
import { loadPersonas } from "../core/personas.ts";
import { keywordScores } from "../core/router.ts";
// Which agents a text is about (DM routing on a shared number).
const keywordRoute = (text: string, personas: Parameters<typeof keywordScores>[1]) => [...keywordScores(text, personas)].filter(([, n]) => n > 0).map(([id]) => id);

const NOW = new Date(2026, 9, 10, 23, 2); // Sat Oct 10 2026, 11:02 PM local
const user: UserProfile = { phone: "+1", budgetMonthly: 800, savingsGoal: "spring break, $400", canvasLinked: true, onboardingStep: "done" };
const buy = (id: string, merchant: string, amount: number, at = new Date(2026, 9, 9, 12, 0), category?: string): Purchase => ({ id, merchant, amount, at, category });
const six = [
  buy("p1", "Harris Teeter", 42.18),
  buy("p2", "DoorDash (Cosmic Cantina)", 23.4),
  buy("p3", "Starbucks", 6.85),
  buy("p4", "Target", 31.97),
  buy("p5", "Sheetz", 4.29),
  buy("p6", "Uber Eats (Sup Dogs)", 18.75),
];

function ctxWith(): Ctx {
  const kv = new Map<string, unknown>();
  return { user, mock: true, now: NOW, kv: { get: <T>(k: string) => kv.get(k) as T, set: (k, v) => void kv.set(k, v) }, log: () => {} };
}
const deps = (purchases: () => Purchase[], balance = 412.55) => ({ getPurchases: async () => purchases(), getBalance: async () => balance });

test("first poll baselines existing purchases and roasts nothing", async () => {
  const ctx = ctxWith();
  assert.deepEqual(await watchWith(ctx, deps(() => six)), []);
  assert.equal(ctx.kv.get<string[]>("seenPurchaseIds")?.length, 6);
});

test("a new purchase is roasted exactly once", async () => {
  const ctx = ctxWith();
  let list = six;
  await watchWith(ctx, deps(() => list));
  list = [...six, buy("p7", "Sheetz", 4.29, NOW)];
  const second = await watchWith(ctx, deps(() => list));
  assert.deepEqual(second.map((e: { kind: string; dedupeKey: string }) => [e.kind, e.dedupeKey]), [["purchase", "purchase:+1:p7"]]);
  assert.match(second[0].facts, /Sheetz \$4\.29/);
  assert.deepEqual(await watchWith(ctx, deps(() => list)), []);
});

test("a burst after downtime roasts at most 3 but marks all seen", async () => {
  const ctx = ctxWith();
  let list = six;
  await watchWith(ctx, deps(() => list));
  list = [...six, ...[7, 8, 9, 10, 11, 12, 13].map((n) => buy(`p${n}`, "Starbucks", 5, new Date(2026, 9, 10, n)))];
  assert.equal((await watchWith(ctx, deps(() => list))).length, 3);
  assert.equal(ctx.kv.get<string[]>("seenPurchaseIds")?.length, 13);
});

test("a date-only Nessie purchase from today is stamped with the time it was first seen", async () => {
  const ctx = ctxWith();
  let list = six;
  await watchWith(ctx, deps(() => list));
  list = [...six, { ...buy("p7", "Sheetz", 4.29, new Date(2026, 9, 10)), dateOnly: true }];
  const [ev] = await watchWith(ctx, deps(() => list));
  assert.match(ev.facts, /11:02 PM/);
});

test("low balance warns once per day", async () => {
  const ctx = ctxWith();
  const evs = await watchWith(ctx, deps(() => six, 80));
  assert.deepEqual(evs.map((e: { dedupeKey: string }) => e.dedupeKey), ["financial:lowbal:+1:2026-10-10"]);
});

test("Nessie YYYY-MM-DD dates parse as local days, not UTC", () => {
  const d = parsePurchaseDate("2026-10-10");
  assert.equal(d.getDate(), 10);
  assert.equal(d.getHours(), 0);
});

test("categories come from the merchant name unless given", () => {
  assert.equal(categorize("DoorDash (Cosmic Cantina)"), "delivery");
  assert.equal(categorize("Harris Teeter"), "groceries");
  assert.equal(categorize("Sheetz"), "energy drink");
  assert.equal(categorize("Uber Eats (Sup Dogs)"), "delivery");
  assert.equal(categorize("Somewhere", "coffee"), "coffee");
  assert.equal(categorize("Barnes & Noble"), "other");
});

test("afford verdict boundaries: over budget, half of what's left, small", () => {
  assert.equal(affordVerdict(700, 600, 20, 800).verdict, "no");
  assert.equal(affordVerdict(300, 600, 20, 800).verdict, "tight");
  assert.equal(affordVerdict(20, 600, 20, 800).verdict, "yes");
});

test("purchase facts carry the numbers the roast needs", () => {
  const p = buy("p7", "Sheetz", 4.29, NOW);
  const facts = purchaseFacts(p, [...six, p], 408.26, user, NOW);
  assert.match(facts, /Sheetz \$4\.29 today 11:02 PM/);
  assert.doesNotMatch(facts, /late night/);
  assert.match(facts, /This week in energy drink: 2 purchases, \$8\.58/);
  assert.match(facts, /Budget left this month: \$/);
  assert.match(facts, /\$400/);
});

test("a 3 AM delivery order is flagged late night", () => {
  const p = buy("p8", "DoorDash (Insomnia Cookies)", 14.5, new Date(2026, 9, 10, 3, 12));
  assert.match(purchaseFacts(p, [...six, p], 400, user, NOW), /late night/);
});

test("a real (date-only) purchase from an earlier day is not called late night or given a fake time", () => {
  const p: Purchase = { id: "x", merchant: "Harris Teeter", amount: 42.18, at: new Date(2026, 9, 9), dateOnly: true };
  const facts = purchaseFacts(p, [p], 400, user, NOW);
  assert.doesNotMatch(facts, /late night/);
  assert.doesNotMatch(facts, /12:00 AM/);
  assert.match(facts, /Harris Teeter \$42\.18 Friday \[groceries\]/);
});

test("a date-only purchase stamped with first-seen time is roasted with that time", async () => {
  const ctx = ctxWith();
  const lateNow = new Date(2026, 9, 10, 2, 30);
  ctx.now = lateNow;
  await watchWith(ctx, deps(() => six));
  const [ev] = await watchWith(ctx, deps(() => [...six, { ...buy("p9", "DoorDash", 20, new Date(2026, 9, 10)), dateOnly: true }]));
  assert.match(ev.facts, /2:30 AM \[delivery\], late night/);
});

test("purchase roasts go only to the account owner when NESSIE_OWNER_PHONE is set", async () => {
  const ctx = ctxWith();
  const evs = await watchWith(ctx, { ...deps(() => six, 80), owner: "+19195550002" });
  assert.deepEqual(evs, []);
  assert.equal(ctx.kv.get("seenPurchaseIds"), undefined);
  const mine = await watchWith(ctx, { ...deps(() => six, 80), owner: "+1" });
  assert.equal(mine.length, 1); // low balance for the owner
});

test("the weekly check-in also goes only to the account owner when NESSIE_OWNER_PHONE is set", async () => {
  process.env.NESSIE_OWNER_PHONE = "+19195550002";
  try {
    assert.deepEqual(await financial.triggers!.weekly_money(ctxWith()), []);
  } finally {
    delete process.env.NESSIE_OWNER_PHONE;
  }
  assert.equal((await financial.triggers!.weekly_money(ctxWith())).length, 1);
});

test("a fresh Nessie account (404 on the purchase list) reads as no purchases, other errors still throw", async () => {
  const realFetch = globalThis.fetch;
  process.env.NESSIE_API_KEY = "k";
  process.env.NESSIE_ACCOUNT_ID = "acct";
  try {
    globalThis.fetch = (async () => new Response('{"code":404,"message":"no purchases"}', { status: 404 })) as typeof fetch;
    assert.deepEqual(await getPurchases({ ...ctxWith(), mock: false }), []);
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await assert.rejects(getPurchases({ ...ctxWith(), mock: false }), /500/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.NESSIE_API_KEY;
    delete process.env.NESSIE_ACCOUNT_ID;
  }
});

// Live run 2026-10-10: a purchase POSTed without `status` was stored, then every GET of the account's purchases
// returned 400 ("validation error for Purchase: status field required"), so Penny never saw a purchase again.
test("a real Nessie purchase is posted with a status, or Nessie can't list the account's purchases afterwards", async () => {
  const realFetch = globalThis.fetch;
  process.env.NESSIE_API_KEY = "k";
  process.env.NESSIE_ACCOUNT_ID = "acct";
  process.env.NESSIE_MERCHANT_ID = "m";
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  try {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response('{"code":201,"message":"Created purchase","objectCreated":{"_id":"p1"}}', { status: 201 });
    }) as typeof fetch;
    assert.deepEqual(await postPurchase({ merchant: "Sheetz", amount: 4.29, now: new Date(2026, 9, 10, 18, 31) }), { _id: "p1" });
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /\/accounts\/acct\/purchases\?key=k$/);
    assert.deepEqual(sent[0].body, { merchant_id: "m", medium: "balance", purchase_date: "2026-10-10", amount: 4.29, status: "completed", description: "Sheetz" });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.NESSIE_API_KEY;
    delete process.env.NESSIE_ACCOUNT_ID;
    delete process.env.NESSIE_MERCHANT_ID;
  }
});

test("the beach trip matches its cost estimate", async () => {
  assert.equal(matchActivity("going on the beach trip saturday", [{ id: "beach", name: "Beach trip to Wrightsville", when: "Saturday", costEstimate: 45 }])?.costEstimate, 45);
  const tool = financial.tools.find((t) => t.name === "estimate_plan_cost")!;
  assert.match(await tool.run({ plan: "beach trip" }, ctxWith()), /\$45/);
});

test("keyword routing (keyless mode) wakes Financial for 'how much is the beach trip', nobody for small talk", () => {
  const personas = loadPersonas();
  assert.ok(keywordRoute("how much is the beach trip", personas).includes("financial"));
  assert.deepEqual(keywordRoute("lol ok", personas), []);
});
