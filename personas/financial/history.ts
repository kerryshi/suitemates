// Six weeks of believable fake spending for each web sign-up (mock mode), so Penny has habits and trends to notice:
// a Sheetz energy drink most mornings, Circle K snacks a few afternoons a week, Starbucks twice a week, DoorDash that
// creeps up week over week while the grocery runs shrink, and a Spotify subscription. Same history for the same
// phone on every call (seeded by phone + day). Up to yesterday only: today's purchases are real demo buys.
import { ymd } from "../../core/kit.ts";
import type { Purchase } from "./nessie.ts";

const DAY = 86_400_000;

// Deterministic 0..1 from a string (FNV-1a).
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

function at(day: Date, hh: number, mm: number): Date {
  const d = new Date(day);
  d.setHours(hh, mm, 0, 0);
  return d;
}

export function simulatedHistory(phone: string, now: Date, days = 42): Purchase[] {
  const out: Purchase[] = [];
  const add = (key: string, day: Date, merchant: string, amount: number, category: string, hh: number, mm: number) =>
    out.push({ id: `sim-${key}-${ymd(day)}`, merchant, amount, category, at: at(day, hh, mm), simulated: true });
  for (let ago = days; ago >= 1; ago--) {
    const day = new Date(now.getTime() - ago * DAY);
    const dow = day.getDay(); // 0 Sun
    const week = Math.floor((ago - 1) / 7); // 0 = the last 7 days
    const r = (k: string) => rand(`${phone}|${k}|${ymd(day)}`);
    if (r("sheetz") < 0.88) add("sheetz", day, "Sheetz", 4.29, "energy drink", 8, 5 + Math.floor(r("sm") * 20));
    if (dow >= 1 && dow <= 5 && r("circlek") < 0.62) add("circlek", day, "Circle K", 9.8 + Math.round(r("ca") * 120) / 100, "snacks", 15, 10 + Math.floor(r("cm") * 40));
    if ((dow === 2 || dow === 4) && r("sbux") < 0.9) add("sbux", day, "Starbucks", 6.85, "coffee", 10, 5);
    // DoorDash: about 1 a week six weeks ago, climbing to 4 a week now (late nights).
    const perWeek = [4, 3, 2, 2, 1, 1][Math.min(week, 5)];
    if (r("dd") < perWeek / 7) add("dd", day, "DoorDash (Cosmic Cantina)", 19 + Math.round(r("da") * 900) / 100, "delivery", r("dl") < 0.5 ? 1 : 21, 15 + Math.floor(r("dm") * 40));
    // Groceries every Sunday, smaller each week (the delivery is replacing them).
    if (dow === 0) add("ht", day, "Harris Teeter", Math.max(18, 58 - (5 - Math.min(week, 5)) * 7) + Math.round(r("ha") * 300) / 100, "groceries", 17, 40);
    if (day.getDate() === 3) add("spotify", day, "Spotify", 11.99, "subscription", 6, 0);
  }
  return out;
}
