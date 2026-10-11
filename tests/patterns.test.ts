// Penny's pattern math (personas/financial/patterns.ts) on hand-made purchases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findHabits, swapSavings, trend, weeklyTotals } from "../personas/financial/patterns.ts";
import type { Purchase } from "../personas/financial/nessie.ts";

const now = new Date(2026, 9, 11, 12);
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
const buy = (d: number, merchant: string, amount: number, category?: string): Purchase => ({ id: `${merchant}${d}`, merchant, amount, at: ago(d), category });

test("a habit is the same place 2+ times a week for 4 weeks; one-offs aren't", () => {
  const all = [...Array.from({ length: 20 }, (_, i) => buy(i + 1, "Sheetz", 4.29, "energy drink")), buy(3, "Target", 31)];
  const [h, ...rest] = findHabits(all, now);
  assert.equal(rest.length, 0);
  assert.equal(h.merchant, "Sheetz");
  assert.equal(h.count, 20);
  assert.equal(h.perWeek, 5);
  assert.equal(Math.round(h.monthly), Math.round(4.29 * 5 * 4.33));
});

test("trend: up vs the 2 weeks before, and whether the change is speeding up", () => {
  assert.deepEqual(trend([100, 60, 40, 40, 0, 0]).direction, "up");
  assert.equal(trend([100, 60, 40, 40, 0, 0]).speed, "speeding up"); // +40 after +20
  assert.equal(trend([60, 50, 20, 20, 0, 0]).speed, "slowing down"); // +10 after +30
  assert.equal(trend([40, 40, 80, 80, 0, 0]).direction, "down");
  const w = weeklyTotals([buy(1, "A", 10), buy(8, "A", 20), buy(9, "A", 5)], now);
  assert.deepEqual(w.slice(0, 3), [10, 25, 0]);
});

test("swap math: per week, month, semester, and months to the savings goal; gas is never 'cut'", () => {
  const [h] = findHabits(Array.from({ length: 28 }, (_, i) => buy(i + 1, "Sheetz", 4.29, "coffee")), now); // daily
  const out = swapSavings(h, "coffee", "spring break, $400");
  // (4.29 - 0.60) × 7 = 25.83 a week; × 4.33 = 111.84 a month
  assert.match(out, /save about \$25\.83 a week, \$111\.84 a month, \$447\.38 a semester\./);
  assert.match(out, /in about 4 months/);
  assert.match(swapSavings(h, "gas", undefined), /Gas is a need/);
  assert.match(swapSavings(h, "lottery tickets", undefined), /No cheaper swap on file/);
});
