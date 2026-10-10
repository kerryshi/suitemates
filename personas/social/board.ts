// The shared sign-up board (owner: Abdallah). ctx.kv is per user, but plans are shared by everyone,
// so they live in one JSON file (data/social.json, gitignored), seeded from mock/students.json.
// The file is re-read on every call so `npm run chat` and `npm run dev` see each other's sign-ups.
// Reset between rehearsals: `rm data/social.json` (chat's /reset doesn't touch it). SOCIAL_FILE overrides the path.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "../../core/types.ts";
import { loadMock } from "../../core/kit.ts";

export interface Activity {
  id: string;
  name: string;
  when: string;
  costEstimate?: number;
  signups: string[]; // phones
}

export interface Board {
  students: { phone: string; name: string }[];
  activities: Activity[];
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let override: string | null | undefined; // undefined = use SOCIAL_FILE / default; null = in memory
let memory: Board | undefined;

// Tests: useBoardFile(null) keeps the board in memory, freshly seeded from the mock; useBoardFile() goes back to the file.
export function useBoardFile(f?: string | null) {
  override = f;
  memory = undefined;
}

// Resolved on every call so SOCIAL_FILE from .env (loaded after imports) still counts.
function boardFile(): string | null {
  if (override !== undefined) return override;
  return resolve(ROOT, process.env.SOCIAL_FILE || "data/social.json");
}

function seed(): Board {
  const { students, activities } = loadMock<Board>("students");
  return { students, activities };
}

export function loadBoard(): Board {
  const file = boardFile();
  if (!file) return structuredClone(memory ?? seed());
  if (!existsSync(file)) return seed();
  try {
    const b = JSON.parse(readFileSync(file, "utf8")) as Board;
    if (Array.isArray(b?.students) && Array.isArray(b?.activities)) return b;
    throw new Error("missing students/activities");
  } catch (err) {
    // A broken file would break every Social tool forever; set it aside and start over from the mock.
    console.warn(`[social] ${file} is unreadable (${err instanceof Error ? err.message : err}); moved to .bad, reseeding`);
    renameSync(file, `${file}.bad`);
    return seed();
  }
}

export function saveBoard(b: Board) {
  const file = boardFile();
  if (!file) {
    memory = structuredClone(b);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(b, null, 2));
  renameSync(`${file}.tmp`, file); // atomic: a reader never sees a half-written board
}

// Remember the user's first name so their matches see it. Onboarding doesn't ask for one, so tools
// take an optional my_name; ctx.user.name is used if core ever fills it in.
export function rememberUser(b: Board, ctx: Ctx, myName?: string): boolean {
  const name = (myName || ctx.user.name || "").trim();
  if (!name) return b.students.some((s) => s.phone === ctx.user.phone);
  const known = b.students.find((s) => s.phone === ctx.user.phone);
  if (known) known.name = name;
  else b.students.push({ phone: ctx.user.phone, name });
  return true;
}

// Never show phone digits: an unknown person is just "someone new".
export function nameOf(b: Board, phone: string, ctx: Ctx): string {
  if (phone === ctx.user.phone) return "you";
  return b.students.find((s) => s.phone === phone)?.name ?? "someone new";
}

const STOP = new Set(["the", "and", "for", "with", "this", "that", "one", "plan", "plans", "anyone", "down", "going", "join"]);
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "today", "tonight", "tomorrow"];
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)));
const days = (s: string) => [...words(s)].filter((w) => DAYS.includes(w));
const nameWords = (s: string) => [...words(s)].filter((w) => !DAYS.includes(w));

// Find activities by a loose description: "beach", "the soccer one", "boba friday", "the saturday one".
// Exact id, then whole-phrase match on id/name, then the most name words in common. A weekday in the
// query must agree with the plan's day ("soccer saturday" won't silently pick Sunday soccer).
export function findActivities(b: Board, query: string): Activity[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = b.activities.find((a) => a.id === q);
  if (exact) return [exact];
  const qDays = days(q);
  const dayOk = (a: Activity) => !qDays.length || !days(a.when).length || qDays.some((d) => days(a.when).includes(d));
  const phrase = b.activities.filter((a) => `${a.id} ${a.name}`.toLowerCase().includes(q) && dayOk(a));
  if (phrase.length) return phrase;
  const qWords = nameWords(q);
  if (!qWords.length) return qDays.length ? b.activities.filter((a) => days(a.when).some((d) => qDays.includes(d))) : [];
  const scored = b.activities
    .filter(dayOk)
    .map((a) => {
      const aw = words(`${a.id} ${a.name}`);
      return { a, score: qWords.filter((w) => aw.has(w)).length };
    })
    .filter((s) => s.score > 0);
  const best = Math.max(0, ...scored.map((s) => s.score));
  return scored.filter((s) => s.score === best).map((s) => s.a);
}

// Stricter than findActivities, for start_activity: is this new plan really one that already exists?
// Most of the new name's words (ignoring days) must already be in one plan's name.
export function findDuplicate(b: Board, name: string): Activity | undefined {
  const nw = nameWords(name);
  if (!nw.length) return undefined;
  return b.activities.find((a) => {
    const aw = words(`${a.id} ${a.name}`);
    return nw.filter((w) => aw.has(w)).length / nw.length >= 0.6;
  });
}

export function describe(b: Board, a: Activity, ctx: Ctx): string {
  const who = a.signups.length ? a.signups.map((p) => nameOf(b, p, ctx)).join(", ") : "nobody yet";
  return `${a.name}, ${a.when}: ${a.signups.length} in (${who})${a.costEstimate ? `, ~$${a.costEstimate}` : ""}`;
}

export function slug(name: string, taken: Activity[]): string {
  const base = nameWords(name).slice(0, 3).join("-") || "plan";
  let id = base;
  for (let n = 2; taken.some((a) => a.id === id); n++) id = `${base}-${n}`;
  return id;
}
