// Spending patterns, computed in code (Penny only words them): repeat habits, weekly trend and whether it's speeding
// up or slowing down, per-category shifts, and what a cheaper swap for a habit saves. Spending-habit coaching,
// never investment advice.
import type { Purchase } from "./nessie.ts";
import { categorize, savingsTarget } from "./money.ts";

const DAY = 86_400_000;
const money = (n: number) => `$${n.toFixed(2)}`;
const round = (n: number) => Math.round(n);

export interface Habit {
  key: string; // merchant without the "(store)" detail: "doordash", "sheetz"
  merchant: string;
  category: string;
  count: number; // in the last 28 days
  avg: number;
  perWeek: number;
  monthly: number;
  semester: number; // ~4 months
}

const keyOf = (merchant: string) => merchant.replace(/\(.*\)/, "").trim().toLowerCase();

// Same place at least twice a week over the last 4 weeks.
export function findHabits(all: Purchase[], now: Date): Habit[] {
  const since = now.getTime() - 28 * DAY;
  const groups = new Map<string, Purchase[]>();
  for (const p of all) {
    if (p.at.getTime() < since || p.at > now) continue;
    const k = keyOf(p.merchant);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups]
    .filter(([, ps]) => ps.length >= 8)
    .map(([key, ps]) => {
      const total = ps.reduce((s, p) => s + p.amount, 0);
      const perWeek = ps.length / 4;
      const avg = total / ps.length;
      const monthly = avg * perWeek * 4.33;
      return { key, merchant: ps[0].merchant.replace(/\s*\(.*\)/, ""), category: categorize(ps[0].merchant, ps[0].category), count: ps.length, avg, perWeek, monthly, semester: monthly * 4 };
    })
    .sort((a, b) => b.monthly - a.monthly);
}

// Totals for the last N weeks, newest first (w[0] = the last 7 days).
export function weeklyTotals(all: Purchase[], now: Date, weeks = 6, cat?: string): number[] {
  const w = Array<number>(weeks).fill(0);
  for (const p of all) {
    if (p.at > now || (cat && categorize(p.merchant, p.category) !== cat)) continue;
    const i = Math.floor((now.getTime() - p.at.getTime()) / (7 * DAY));
    if (i >= 0 && i < weeks) w[i] += p.amount;
  }
  return w;
}

export interface Trend {
  last2: number; // last 2 weeks
  prior2: number; // the 2 weeks before
  change: number; // last2 vs prior2, fraction (+0.4 = 40% more)
  direction: "up" | "down" | "flat";
  speed: "speeding up" | "slowing down" | "steady"; // is the week-over-week change itself growing?
}

export function trend(w: number[]): Trend {
  const last2 = w[0] + w[1];
  const prior2 = w[2] + w[3];
  const change = prior2 > 0 ? (last2 - prior2) / prior2 : last2 > 0 ? 1 : 0;
  const direction = change > 0.1 ? "up" : change < -0.1 ? "down" : "flat";
  // Rate of change of the rate of change: compare the latest week-over-week step with the one before.
  const step1 = w[0] - w[1];
  const step2 = w[1] - w[2];
  const speed = step1 - step2 > 10 ? "speeding up" : step1 - step2 < -10 ? "slowing down" : "steady";
  return { last2, prior2, change, direction, speed };
}

// Categories whose last 2 weeks moved the most against the 2 weeks before (at least $15 and 25%).
export function categoryShifts(all: Purchase[], now: Date): { category: string; t: Trend }[] {
  const cats = [...new Set(all.filter((p) => p.at <= now && now.getTime() - p.at.getTime() < 28 * DAY).map((p) => categorize(p.merchant, p.category)))];
  return cats
    .map((category) => ({ category, t: trend(weeklyTotals(all, now, 4, category)) }))
    .filter(({ t }) => Math.abs(t.last2 - t.prior2) >= 15 && Math.abs(t.change) >= 0.25)
    .sort((a, b) => Math.abs(b.t.last2 - b.t.prior2) - Math.abs(a.t.last2 - a.t.prior2));
}

// Cheaper versions of common habits, with a rough per-time price. Keywords are what the student might say.
const SWAPS: { words: RegExp; what: string; swap: string; price: number }[] = [
  { words: /coffee|latte|cold brew|espresso|cappuccino/i, what: "coffee", swap: "coffee brewed at home or the dining hall", price: 0.6 },
  { words: /energy|monster|celsius|red ?bull|alani|bang/i, what: "an energy drink", swap: "a 12-pack from Target or Costco", price: 1.6 },
  { words: /snack|chips|candy|soda|gum|food/i, what: "snacks", swap: "snacks from a weekly grocery run", price: 2.5 },
  { words: /lunch|dinner|meal|burrito|taco|pizza|delivery|doordash|ubereats/i, what: "a delivered meal", swap: "cooking or the dining hall", price: 6 },
  { words: /boba|tea|smoothie/i, what: "boba", swap: "making it at home, or boba once a week", price: 2 },
  { words: /gas|fuel/i, what: "gas", swap: "the cheapest station nearby (GasBuddy)", price: -1 },
];

export function swapFor(item: string): (typeof SWAPS)[number] | undefined {
  return SWAPS.find((s) => s.words.test(item));
}

// What swapping one habit saves: per week, per month, per semester, and how fast it reaches their savings goal.
export function swapSavings(h: Habit, item: string, goal?: string): string {
  const s = swapFor(item);
  if (!s) return `No cheaper swap on file for "${item}". ${h.merchant}: ${h.count} times in 4 weeks, ${money(h.avg)} each, about ${money(h.monthly)} a month. Ask what would make it cheaper for them, or suggest cutting it to a few times a week.`;
  if (s.price < 0) return `${h.merchant} for gas: ${money(h.monthly)} a month. Gas is a need; suggest ${s.swap}, no cutting.`;
  const per = Math.max(0, h.avg - s.price);
  const week = per * h.perWeek;
  const month = week * 4.33;
  const target = savingsTarget(goal);
  const toGoal = target && month > 0 ? ` That alone reaches their goal (${goal}) in about ${Math.max(1, Math.ceil(target / month))} month${Math.ceil(target / month) === 1 ? "" : "s"}.` : "";
  const half = (per * h.perWeek * 4.33) / 2;
  return (
    `${h.merchant} ${s.what}: ${h.count} times in 4 weeks at ${money(h.avg)}. Swap to ${s.swap} (~${money(s.price)}) and save about ` +
    `${money(week)} a week, ${money(month)} a month, ${money(month * 4)} a semester.${toGoal} ` +
    `Even swapping half the time saves about ${money(half)} a month.`
  );
}

// The whole picture, as plain facts for the tool and the weekly check-in.
export function patternReport(all: Purchase[], now: Date): string {
  const habits = findHabits(all, now);
  const t = trend(weeklyTotals(all, now));
  const shifts = categoryShifts(all, now);
  const pct = (x: number) => `${x > 0 ? "+" : ""}${round(x * 100)}%`;
  const lines = [
    `Last 2 weeks ${money(t.last2)} vs ${money(t.prior2)} the 2 weeks before (${pct(t.change)}, ${t.direction}); week to week it's ${t.speed}.`,
    ...habits.slice(0, 4).map((h) => `Habit: ${h.merchant} (${h.category}) ${h.count}x in 4 weeks, ${money(h.avg)} avg, ~${money(h.monthly)}/month, ~${money(h.semester)}/semester.`),
    ...shifts.slice(0, 3).map(({ category, t: c }) => `Shift: ${category} ${money(c.last2)} vs ${money(c.prior2)} (${pct(c.change)})${c.speed !== "steady" ? `, ${c.speed}` : ""}.`),
  ];
  if (habits.length === 0) lines.push("No repeat habits yet (nothing at the same place 2+ times a week).");
  return lines.join("\n");
}
