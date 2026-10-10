// Small helpers personas may import (alongside core/types.ts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Read a file next to the calling module: loadText(import.meta.url, "prompt.md")
export function loadText(metaUrl: string, file: string): string {
  return readFileSync(join(dirname(fileURLToPath(metaUrl)), file), "utf8");
}

// Read mock/<name>.json from the repo root.
export function loadMock<T>(name: string): T {
  return JSON.parse(readFileSync(join(ROOT, "mock", `${name}.json`), "utf8")) as T;
}

// "2026-10-10" in local time.
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Mock dates are relative so the demo works any day: { dueInDays: 0 } = today, { dueWeekday: "sun" } = next Sunday
// (today if today is Sunday), { daysAgo: 1 } = yesterday. `time` is "HH:MM" local.
export function relativeDate(now: Date, r: { dueInDays?: number; dueWeekday?: string; daysAgo?: number; time?: string }): Date {
  const d = new Date(now);
  if (r.dueWeekday) {
    const target = DAYS.indexOf(r.dueWeekday.slice(0, 3).toLowerCase());
    d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7));
  } else if (r.dueInDays !== undefined) d.setDate(d.getDate() + r.dueInDays);
  else if (r.daysAgo !== undefined) d.setDate(d.getDate() - r.daysAgo);
  const [h, m] = (r.time ?? "23:59").split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

export function fmtWhen(d: Date, now: Date): string {
  const day = ymd(d) === ymd(now) ? "today" : d.toLocaleDateString("en-US", { weekday: "long" });
  return `${day} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
