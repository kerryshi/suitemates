// Pure money math for Financial. No I/O — every number Penny says is computed here, never by the LLM.
import type { UserProfile } from "../../core/types.ts";
import { fmtWhen, ymd } from "../../core/kit.ts";
import type { Purchase } from "./nessie.ts";

const CATEGORIES: [RegExp, string][] = [
  [/doordash|uber ?eats|grubhub|postmates|insomnia cookies/i, "delivery"],
  [/starbucks|dunkin|coffee|\bcafe\b|epilogue|bean/i, "coffee"],
  [/sheetz|monster|red ?bull|celsius|\bbang\b/i, "energy drink"],
  [/harris teeter|food lion|trader joe|whole foods|aldi|kroger|wegmans|publix|grocer/i, "groceries"],
  [/\buber\b|lyft/i, "rides"],
  [/amazon|target|walmart|shein|nike|best buy/i, "shopping"],
  [/netflix|spotify|hulu|steam|playstation|xbox/i, "subscriptions"],
  [/chipotle|mcdonald|cava|sup dogs|cantina|bojangles|chick-fil-a|taco bell|wendy/i, "eating out"],
  [/\bbar\b|brew|\bpub\b|top of the hill/i, "nightlife"],
];
const GOOD = new Set(["groceries"]);
const ROASTABLE = new Set(["delivery", "energy drink", "nightlife", "coffee"]);

export function categorize(merchant: string, given?: string): string {
  if (given) return given;
  return CATEGORIES.find(([re]) => re.test(merchant))?.[1] ?? "other";
}

export function isLateNight(d: Date): boolean {
  return d.getHours() < 5;
}

// Real Nessie purchases only carry a date, so never print (or judge) a time for them.
export function fmtPurchaseWhen(p: Pick<Purchase, "at" | "dateOnly">, now: Date): string {
  if (!p.dateOnly) return fmtWhen(p.at, now);
  return ymd(p.at) === ymd(now) ? "today" : p.at.toLocaleDateString("en-US", { weekday: "long" });
}

// Nessie gives "YYYY-MM-DD"; new Date() would read that as UTC midnight (= the previous evening in EDT).
export function parsePurchaseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
}

// First call (seen undefined) baselines: everything already there counts as seen, nothing is new.
export function diffNew(seen: string[] | undefined, all: Purchase[]): { baselined: boolean; fresh: Purchase[]; seen: string[] } {
  if (!seen) return { baselined: true, fresh: [], seen: all.map((p) => p.id) };
  const known = new Set(seen);
  const fresh = all.filter((p) => !known.has(p.id)).sort((a, b) => +b.at - +a.at);
  return { baselined: false, fresh, seen: [...seen, ...fresh.map((p) => p.id)] };
}

export function daysInMonth(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

export function monthStats(all: Purchase[], now: Date, budget?: number) {
  const spent = all
    .filter((p) => p.at.getFullYear() === now.getFullYear() && p.at.getMonth() === now.getMonth() && p.at <= now)
    .reduce((s, p) => s + p.amount, 0);
  const daysLeft = daysInMonth(now) - now.getDate() + 1; // today counts
  const left = budget === undefined ? undefined : budget - spent;
  return { spent, daysLeft, left, perDay: left === undefined ? undefined : left / daysLeft };
}

export function categoryWeek(all: Purchase[], now: Date, cat: string): { count: number; total: number } {
  const since = now.getTime() - 7 * 86_400_000;
  const hits = all.filter((p) => p.at.getTime() >= since && p.at <= now && categorize(p.merchant, p.category) === cat);
  return { count: hits.length, total: hits.reduce((s, p) => s + p.amount, 0) };
}

export function categoryBreakdown(all: Purchase[]): Record<string, { count: number; total: number }> {
  const out: Record<string, { count: number; total: number }> = {};
  for (const p of all) {
    const c = (out[categorize(p.merchant, p.category)] ??= { count: 0, total: 0 });
    c.count++;
    c.total += p.amount;
  }
  return out;
}

export function breakdownLine(all: Purchase[]): string {
  return Object.entries(categoryBreakdown(all))
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([cat, c]) => `${cat} $${c.total.toFixed(2)} (${c.count})`)
    .join(", ");
}

export function savingsTarget(goal?: string): number | undefined {
  const m = /\$\s*(\d[\d,]*(?:\.\d+)?)/.exec(goal ?? "");
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

// no: more than what's left this month. tight: eats half of what's left, or leaves under 40% of a normal day.
export function affordVerdict(price: number, left: number, daysLeft: number, budget: number): { verdict: "yes" | "tight" | "no"; dailyAfter: number } {
  const dailyAfter = (left - price) / Math.max(1, daysLeft);
  if (price > left) return { verdict: "no", dailyAfter };
  if (price >= 0.5 * left || dailyAfter < 0.4 * (budget / 30)) return { verdict: "tight", dailyAfter };
  return { verdict: "yes", dailyAfter };
}

export interface PlanCost {
  id: string;
  name: string;
  when: string;
  costEstimate: number;
}

const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]{3,}/g) ?? []).map((w) => w.replace(/s$/, "")));

export function matchActivity<T extends PlanCost>(plan: string, acts: T[]): T | undefined {
  const want = words(plan);
  const scored = acts
    .map((a) => ({ a, score: [...words(`${a.id} ${a.name}`)].filter((w) => want.has(w)).length }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored[0]?.a;
}

export function purchaseFacts(p: Purchase, all: Purchase[], balance: number, user: UserProfile, now: Date): string {
  const cat = categorize(p.merchant, p.category);
  const late = !p.dateOnly && isLateNight(p.at);
  const parts = [`New purchase: ${p.merchant} $${p.amount.toFixed(2)} ${fmtPurchaseWhen(p, now)} [${cat}]${late ? ", late night" : ""}.`];
  const week = categoryWeek(all, now, cat);
  if (week.count > 1) parts.push(`This week in ${cat}: ${week.count} purchases, $${week.total.toFixed(2)}.`);
  const m = monthStats(all, now, user.budgetMonthly);
  if (m.left !== undefined && m.perDay !== undefined) {
    parts.push(`Budget left this month: $${m.left.toFixed(2)} of $${user.budgetMonthly} (${m.daysLeft} days left, ~$${m.perDay.toFixed(2)}/day).`);
  }
  parts.push(`Balance $${balance.toFixed(2)}.`);
  const target = savingsTarget(user.savingsGoal);
  if (target) {
    const pct = (p.amount / target) * 100;
    parts.push(`Saving for: ${user.savingsGoal}. This purchase is ${pct < 1 ? "under 1%" : `${Math.round(pct)}%`} of that $${target} target.`);
  }
  if (GOOD.has(cat)) parts.push("Tone: a good choice, hype it.");
  else if (ROASTABLE.has(cat) || late) parts.push("Tone: roast-worthy.");
  return parts.join(" ");
}
