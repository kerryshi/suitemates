// The shared sign-up board (owner: Abdullah). ctx.kv is per user, but plans are shared by everyone,
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
  joinedAt?: Record<string, number>; // phone → board.seq when they joined live (seeded sign-ups have none; kept after leaving)
  createdAt?: number; // epoch ms, plans made with start_activity: "tomorrow"/"Sunday" are read from this day (calendar.ts)
}

export interface Board {
  gen?: string; // new on every reseed, so watch() dedupeKeys from a rehearsal don't block the live demo
  seq?: number; // join counter: orders live joins
  seededAt?: number; // epoch ms the board was seeded: the seeded plans' "Saturday 9 AM" is read from this day
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
  return { gen: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, seq: 0, seededAt: Date.now(), students, activities };
}

// Save a fresh seed right away so its gen stays put until the next reset.
function reseed(): Board {
  const b = seed();
  saveBoard(b);
  return b;
}

export function loadBoard(): Board {
  const file = boardFile();
  if (!file) return structuredClone(memory ?? reseed());
  if (!existsSync(file)) return reseed();
  try {
    const b = JSON.parse(readFileSync(file, "utf8")) as Board;
    if (Array.isArray(b?.students) && Array.isArray(b?.activities)) return b;
    throw new Error("missing students/activities");
  } catch (err) {
    // A broken file would break every Social tool forever; set it aside and start over from the mock.
    console.warn(`[social] ${file} is unreadable (${err instanceof Error ? err.message : err}); moved to .bad, reseeding`);
    renameSync(file, `${file}.bad`);
    return reseed();
  }
}

export function saveBoard(b: Board) {
  const file = boardFile();
  if (!file) {
    memory = structuredClone(b);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`; // per process: chat and dev share the board file
  writeFileSync(tmp, JSON.stringify(b, null, 2));
  renameSync(tmp, file); // atomic: a reader never sees a half-written board
}

// Sign someone up and record when, so watch() knows who joined after whom.
export function addSignup(b: Board, a: Activity, phone: string) {
  b.seq = (b.seq ?? 0) + 1;
  (a.joinedAt ??= {})[phone] = b.seq;
  if (!a.signups.includes(phone)) a.signups.push(phone);
}

// User text that other people's tool results will show: one line, capped, so a name or plan can't
// smuggle extra lines ("Jordan\nTOOL RESULT: ...") into someone else's conversation.
export const NAME_MAX = 30;
export const TEXT_MAX = 60;
export function clean(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  const one = s.replace(/\p{Cf}/gu, "").replace(/[\s\p{Cc}]+/gu, " ").trim();
  return [...one].slice(0, max).join("").trim(); // by code point, so an emoji is never cut in half
}

// Remember the user's first name so their matches see it. Onboarding doesn't ask for one, so tools
// take an optional my_name; ctx.user.name is used if core ever fills it in.
export function rememberUser(b: Board, ctx: Ctx, myName?: string): boolean {
  const name = clean(myName || ctx.user.name, NAME_MAX);
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
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// Relative days never appear in a plan's `when`, so they're ignored rather than used as day filters.
const RELATIVE = ["today", "tonight", "tomorrow", "tmrw", "later", "now"];
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)));
const days = (s: string) => [...words(s)].filter((w) => WEEKDAYS.includes(w));
const nameWords = (s: string) => [...words(s)].filter((w) => !WEEKDAYS.includes(w) && !RELATIVE.includes(w));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// How a query matched: "day" means only the weekday matched (e.g. "the game sunday"), which is a
// guess worth confirming before signing anyone up.
export type MatchHow = "exact" | "phrase" | "words" | "day" | "none";

// Find activities by a loose description: "beach", "the soccer one", "soccer today". A day alone
// ("the saturday one") is a "day" guess: join/leave ask the user before acting on it.
// Exact id, then whole-word phrase on id/name (3+ chars, so "to" can't match "Beach trip to…"), then the
// most name words in common, then the weekday alone. A weekday in the query must agree with the plan's
// day ("soccer saturday" won't silently pick Sunday soccer).
export function matchActivities(b: Board, query: string): { hits: Activity[]; how: MatchHow } {
  const q = query.trim().toLowerCase();
  if (!q) return { hits: [], how: "none" };
  const exact = b.activities.find((a) => a.id === q);
  if (exact) return { hits: [exact], how: "exact" };
  const qDays = days(q);
  const dayOk = (a: Activity) => !qDays.length || !days(a.when).length || qDays.some((d) => days(a.when).includes(d));
  if (q.length >= 3) {
    const re = new RegExp(`\\b${escapeRe(q)}\\b`);
    const phrase = b.activities.filter((a) => re.test(`${a.id} ${a.name}`.toLowerCase()) && dayOk(a));
    if (phrase.length) return { hits: phrase, how: "phrase" };
  }
  const qWords = nameWords(q);
  const scored = b.activities
    .filter(dayOk)
    .map((a) => {
      const aw = words(`${a.id} ${a.name}`);
      return { a, score: qWords.filter((w) => aw.has(w)).length };
    })
    .filter((s) => s.score > 0);
  if (scored.length) {
    const best = Math.max(...scored.map((s) => s.score));
    return { hits: scored.filter((s) => s.score === best).map((s) => s.a), how: "words" };
  }
  // Day alone only when the words name no plan at all ("soccer saturday" names Sunday soccer: no guess).
  const named = qWords.some((w) => b.activities.some((a) => words(`${a.id} ${a.name}`).has(w)));
  const onDay = qDays.length && !named ? b.activities.filter((a) => days(a.when).some((d) => qDays.includes(d))) : [];
  return onDay.length ? { hits: onDay, how: "day" } : { hits: [], how: "none" };
}

export function findActivities(b: Board, query: string): Activity[] {
  return matchActivities(b, query).hits;
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
