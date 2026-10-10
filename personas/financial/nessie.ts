// Purchases from Capital One Nessie, or from mock/nessie-purchases.json when ctx.mock.
// Nessie docs: http://api.nessieisreal.com/documentation
import type { Ctx } from "../../core/types.ts";
import { loadMock, relativeDate } from "../../core/kit.ts";

export interface Purchase {
  id: string;
  merchant: string;
  amount: number; // dollars
  at: Date;
  category?: string;
}

interface MockNessie {
  balance: number;
  purchases: { id: string; merchant: string; amount: number; daysAgo: number; time: string; category?: string }[];
}

const BASE = "https://api.nessieisreal.com";

export async function getPurchases(ctx: Ctx): Promise<Purchase[]> {
  if (ctx.mock) {
    return loadMock<MockNessie>("nessie-purchases")
      .purchases.map((p) => ({ ...p, at: relativeDate(ctx.now, p) }))
      .sort((a, b) => +b.at - +a.at);
  }
  // TODO(financial): verify against the real API once NESSIE_API_KEY + NESSIE_ACCOUNT_ID exist.
  const rows = await nessie<{ _id: string; description?: string; amount: number; purchase_date?: string; merchant_id?: string }[]>(
    `/accounts/${requireEnv("NESSIE_ACCOUNT_ID")}/purchases`,
  );
  return rows
    .map((r) => ({ id: r._id, merchant: r.description ?? r.merchant_id ?? "unknown", amount: r.amount, at: new Date(r.purchase_date ?? Date.now()) }))
    .sort((a, b) => +b.at - +a.at);
}

export async function getBalance(ctx: Ctx): Promise<number> {
  if (ctx.mock) return loadMock<MockNessie>("nessie-purchases").balance;
  const acct = await nessie<{ balance: number }>(`/accounts/${requireEnv("NESSIE_ACCOUNT_ID")}`);
  return acct.balance;
}

async function nessie<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}?key=${encodeURIComponent(requireEnv("NESSIE_API_KEY"))}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Nessie ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (or run with MOCK=1)`);
  return v;
}
