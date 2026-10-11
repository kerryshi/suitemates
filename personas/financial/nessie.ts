// Purchases from Capital One Nessie, or from mock data when ctx.mock.
// Mock = mock/nessie-purchases.json + anything queued by `npm run buy` (data/mock-new-purchases.json).
// Nessie docs: http://api.nessieisreal.com/documentation
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "../../core/types.ts";
import { loadMock, relativeDate, ymd } from "../../core/kit.ts";
import { parsePurchaseDate } from "./money.ts";

export interface Purchase {
  id: string;
  merchant: string;
  amount: number; // dollars
  at: Date;
  category?: string;
  dateOnly?: boolean; // Nessie only stores the day; watch() stamps today's with the time it first saw them
}

export interface ExtraPurchase {
  id: string;
  merchant: string;
  amount: number;
  at: string; // ISO
  category?: string;
  phone?: string; // whose demo ledger (the website's "try Penny" buttons); unset = everyone's (npm run buy)
}

interface MockNessie {
  balance: number;
  purchases: { id: string; merchant: string; amount: number; daysAgo: number; time: string; category?: string }[];
}

const BASE = "https://api.nessieisreal.com";
const DATA = join(dirname(fileURLToPath(import.meta.url)), "../../data");
export const EXTRA_FILE = process.env.MOCK_PURCHASES_FILE || join(DATA, "mock-new-purchases.json"); // tests use a temp file
export const NESSIE_IDS_FILE = join(DATA, "nessie.json");

export function readExtras(phone?: string): ExtraPurchase[] {
  const all = existsSync(EXTRA_FILE) ? (JSON.parse(readFileSync(EXTRA_FILE, "utf8")) as ExtraPurchase[]) : [];
  if (phone === undefined) return all;
  const d = (s: string) => s.replace(/\D/g, "").slice(-10);
  return all.filter((e) => !e.phone || d(e.phone) === d(phone)); // shared ones + only this person's own
}

export function writeExtras(list: ExtraPurchase[]) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(EXTRA_FILE, JSON.stringify(list, null, 2));
}

export async function getPurchases(ctx: Ctx): Promise<Purchase[]> {
  if (ctx.mock) {
    const base = loadMock<MockNessie>("nessie-purchases").purchases.map((p) => ({ ...p, at: relativeDate(ctx.now, p) }));
    const extras = readExtras(ctx.user.phone).map((e) => ({ ...e, at: new Date(e.at) }));
    return [...base, ...extras].sort((a, b) => +b.at - +a.at);
  }
  type Row = { _id: string; description?: string; amount: number; purchase_date?: string; merchant_id?: string };
  let rows: Row[];
  try {
    rows = await nessie<Row[]>("GET", `/accounts/${accountId()}/purchases`);
  } catch (err) {
    // A brand-new account may 404 instead of returning []. A wrong account id still fails loudly
    // in getBalance, which watch() calls on every poll.
    if (!(err instanceof NessieError && err.status === 404)) throw err;
    ctx.log("Nessie: 404 on the purchase list, treating it as no purchases yet");
    rows = [];
  }
  return rows
    .map((r) => ({
      id: r._id,
      merchant: r.description || r.merchant_id || "unknown",
      amount: r.amount,
      at: r.purchase_date ? parsePurchaseDate(r.purchase_date) : new Date(),
      dateOnly: true,
    }))
    .sort((a, b) => +b.at - +a.at);
}

export async function getBalance(ctx: Ctx): Promise<number> {
  if (ctx.mock) {
    const spentSince = readExtras(ctx.user.phone).reduce((s, e) => s + e.amount, 0);
    return Math.round((loadMock<MockNessie>("nessie-purchases").balance - spentSince) * 100) / 100;
  }
  return (await nessie<{ balance: number }>("GET", `/accounts/${accountId()}`)).balance;
}

// Real Nessie only. The merchant is a single demo merchant; the description carries the store name.
// `status` is required: Nessie stores a purchase without it, then 400s every GET of the account's purchases.
export async function postPurchase(p: { merchant: string; amount: number; now: Date }): Promise<{ _id: string }> {
  return nessie("POST", `/accounts/${accountId()}/purchases`, {
    merchant_id: merchantId(),
    medium: "balance",
    purchase_date: ymd(p.now),
    amount: p.amount,
    status: "completed",
    description: p.merchant,
  });
}

export async function nessie<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}?key=${encodeURIComponent(requireEnv("NESSIE_API_KEY"))}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new NessieError(res.status, `Nessie ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  const json = text ? JSON.parse(text) : null;
  // Nessie wraps created objects as { code, message, objectCreated }.
  return (json && typeof json === "object" && "objectCreated" in json ? json.objectCreated : json) as T;
}

export class NessieError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function savedIds(): { accountId?: string; merchantId?: string } {
  return existsSync(NESSIE_IDS_FILE) ? JSON.parse(readFileSync(NESSIE_IDS_FILE, "utf8")) : {};
}

function accountId(): string {
  const id = process.env.NESSIE_ACCOUNT_ID || savedIds().accountId;
  if (!id) throw new Error("NESSIE_ACCOUNT_ID is not set (run `npm run setup-nessie`, or use MOCK=1)");
  return id;
}

function merchantId(): string {
  const id = process.env.NESSIE_MERCHANT_ID || savedIds().merchantId;
  if (!id) throw new Error("NESSIE_MERCHANT_ID is not set (run `npm run setup-nessie`)");
  return id;
}

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (or run with MOCK=1)`);
  return v;
}
