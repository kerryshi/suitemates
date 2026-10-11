// Canvas data for one student as a snapshot: courses (grade, weights, syllabus), every assignment (due date, score)
// and recent announcements. From mock-canvas.json, or live from the Canvas API for the token's owner only.
// Live snapshots are cached 10 min and saved to data/canvas/<phone>.json (the per-student dataset; data/ is gitignored).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Ctx } from "../../core/types.ts";
import { fmtWhen, loadText, relativeDate } from "../../core/kit.ts";

export interface Assignment {
  id: string;
  course: string;
  name: string;
  due: Date;
  points?: number;
  type?: string; // assignment | quiz | exam | discussion
  score?: number; // points earned, once graded
  submitted?: boolean; // turned in (graded or not): no more reminders
  group?: string; // key into Course.weights
}

export interface Course {
  code: string; // "COMP 421"
  name: string;
  grade?: number; // current score, percent (Canvas's number)
  weights?: Record<string, number>; // assignment-group weights in percent; absent = points-based
  syllabus?: string; // plain text
}

export interface Announcement {
  id: string;
  course: string;
  title: string;
  message: string; // plain text
  posted: Date;
}

export interface Snapshot {
  source: "mock" | "canvas";
  courses: Course[];
  assignments: Assignment[];
  announcements: Announcement[];
}

export const TAG: Record<string, string> = { exam: " (EXAM)", quiz: " (QUIZ)" };

// "COMP 421: Quiz 4 (QUIZ), due Monday 10:00 AM, 10 pts"
export function describe(a: Assignment, now: Date): string {
  return `${a.course}: ${a.name}${TAG[a.type ?? ""] ?? ""}, due ${fmtWhen(a.due, now)}${a.points ? `, ${a.points} pts` : ""}`;
}

// ---- reading the snapshot ----

export async function getSnapshot(ctx: Ctx): Promise<Snapshot> {
  return isLive(ctx) ? live(ctx) : fromMock(ctx.now);
}

// Upcoming work still to do (due today or later, not turned in), soonest first.
export async function getAssignments(ctx: Ctx): Promise<Assignment[]> {
  const { assignments } = await getSnapshot(ctx);
  return assignments.filter((a) => a.due >= startOfDay(ctx.now) && !a.submitted).sort((a, b) => +a.due - +b.due);
}

// Current course grades plus graded work, newest first.
export async function getGrades(ctx: Ctx): Promise<{ courses: Course[]; graded: Assignment[] }> {
  const { courses, assignments } = await getSnapshot(ctx);
  return { courses, graded: assignments.filter((a) => a.score !== undefined).sort((a, b) => +b.due - +a.due) };
}

// ---- grade math ----

// Score from graded work: weighted by assignment group when the course has weights, else total points.
export function courseScore(course: Course, assignments: Assignment[]): number | undefined {
  const graded = assignments.filter((a) => a.course === course.code && a.score !== undefined && a.points);
  if (graded.length === 0) return undefined;
  const ratio = (items: Assignment[]) => items.reduce((s, a) => s + a.score!, 0) / items.reduce((s, a) => s + a.points!, 0);
  if (!course.weights) return 100 * ratio(graded);
  let num = 0;
  let den = 0;
  for (const [group, weight] of Object.entries(course.weights)) {
    const items = graded.filter((a) => a.group === group);
    if (items.length === 0 || weight <= 0) continue;
    num += weight * ratio(items);
    den += weight;
  }
  return den ? (100 * num) / den : undefined;
}

// What happens to the course grade if this assignment scores `percent` (0 = skipped). Applies the change in our
// estimate from graded work to Canvas's own current grade, so the "before" matches what the student sees.
export function gradeImpact(snap: Snapshot, assignment: Assignment, percent: number): { before: number; after: number } | undefined {
  const course = snap.courses.find((c) => c.code === assignment.course);
  if (!course || !assignment.points) return undefined;
  const others = snap.assignments.filter((a) => a.id !== assignment.id);
  const est = courseScore(course, others);
  const withIt = courseScore(course, [...others, { ...assignment, score: (assignment.points * percent) / 100 }]);
  if (withIt === undefined) return undefined;
  const before = course.grade ?? est ?? withIt;
  return { before: round1(before), after: round1(before + withIt - (est ?? before)) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- mock ----

interface MockCanvas {
  courses: Course[];
  assignments: (Omit<Assignment, "due"> & { dueInDays?: number; dueWeekday?: string; daysAgo?: number; time?: string })[];
  announcements: (Omit<Announcement, "posted"> & { daysAgo: number; time?: string })[];
}

function fromMock(now: Date): Snapshot {
  const m: MockCanvas = JSON.parse(loadText(import.meta.url, "mock-canvas.json"));
  return {
    source: "mock",
    courses: m.courses,
    assignments: m.assignments.map(({ dueInDays, dueWeekday, daysAgo, time, ...a }) => ({
      ...a,
      group: a.type === "discussion" ? "assignment" : a.type,
      due: relativeDate(now, { dueInDays, dueWeekday, daysAgo, time }),
    })),
    announcements: m.announcements.map(({ daysAgo, time, ...n }) => ({ ...n, posted: relativeDate(now, { daysAgo, time }) })),
  };
}

// ---- live Canvas ----

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; snap: Snapshot }>();
const digits = (s?: string) => (s ?? "").replace(/\D/g, "").slice(-10);

// Live only for the token's owner (CANVAS_OWNER_PHONE), so nobody else ever sees their data, and only when
// MOCK=0 or CANVAS_LIVE=1 (lets Canvas go live while Nessie stays on mock).
export function isLive(ctx: Ctx): boolean {
  const owner = process.env.CANVAS_OWNER_PHONE;
  const on = !ctx.mock || process.env.CANVAS_LIVE === "1";
  return on && !!process.env.CANVAS_TOKEN && !!owner && digits(owner) === digits(ctx.user.phone);
}

async function live(ctx: Ctx): Promise<Snapshot> {
  const hit = cache.get(ctx.user.phone);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.snap;
  const snap = await fetchCanvas(ctx.now);
  cache.set(ctx.user.phone, { at: Date.now(), snap });
  const file = join(dirname(process.env.DATA_FILE ?? "data/state.json"), "canvas", `${digits(ctx.user.phone)}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), ...snap }, null, 2));
  ctx.log(`canvas: ${snap.courses.length} courses, ${snap.assignments.length} assignments, ${snap.announcements.length} announcements`);
  return snap;
}

async function api<T>(path: string): Promise<T> {
  const base = process.env.CANVAS_BASE_URL ?? "https://uncch.instructure.com";
  const res = await fetch(`${base}/api/v1${path}`, {
    headers: { authorization: `Bearer ${process.env.CANVAS_TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Canvas ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface ApiCourse {
  id: number;
  name: string;
  course_code: string;
  apply_assignment_group_weights?: boolean;
  syllabus_body?: string | null;
  term?: { name?: string };
  enrollments?: { computed_current_score?: number | null }[];
}
interface ApiAssignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible?: number | null;
  assignment_group_id?: number;
  is_quiz_assignment?: boolean;
  submission_types?: string[];
  submission?: { score?: number | null; excused?: boolean | null; submitted_at?: string | null; workflow_state?: string };
}

// Exported for tests. "COMP311.001.FA26" → "COMP 311".
export function courseCode(raw: string): string {
  const m = /^([A-Z]{2,5})\s*(\d{2,3}[A-Z]?)/.exec(raw);
  return m ? `${m[1]} ${m[2]}` : raw;
}

export function kindOf(a: Pick<ApiAssignment, "name" | "is_quiz_assignment" | "submission_types">): string {
  const practice = /\b(practice|optional)\b/i.test(a.name);
  if (!practice && /\b(midterm|final|exam)\b/i.test(a.name)) return "exam";
  if (a.is_quiz_assignment || a.submission_types?.includes("online_quiz") || /\bquiz\b/i.test(a.name)) return "quiz";
  if (a.submission_types?.includes("discussion_topic")) return "discussion";
  return "assignment";
}

export function htmlToText(html?: string | null): string {
  return (html ?? "")
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

async function fetchCanvas(now: Date): Promise<Snapshot> {
  const raw = await api<ApiCourse[]>("/courses?enrollment_state=active&include[]=total_scores&include[]=term&include[]=syllabus_body&per_page=50");
  // Skip org shells (advising, career hubs, trainings): real classes have a term.
  const classes = raw.filter((c) => c.term?.name && c.term.name !== "Default Term");
  const courses: Course[] = [];
  const assignments: Assignment[] = [];
  for (const c of classes) {
    const code = courseCode(c.course_code);
    const [list, groups] = await Promise.all([
      api<ApiAssignment[]>(`/courses/${c.id}/assignments?include[]=submission&per_page=100`),
      api<{ id: number; group_weight?: number }[]>(`/courses/${c.id}/assignment_groups?per_page=50`),
    ]);
    courses.push({
      code,
      name: c.name,
      grade: c.enrollments?.[0]?.computed_current_score ?? undefined,
      weights: c.apply_assignment_group_weights ? Object.fromEntries(groups.map((g) => [String(g.id), g.group_weight ?? 0])) : undefined,
      syllabus: htmlToText(c.syllabus_body) || undefined,
    });
    for (const a of list) {
      if (!a.due_at && a.submission?.score == null) continue; // undated and ungraded: nothing to say about it
      assignments.push({
        id: String(a.id),
        course: code,
        name: a.name,
        due: new Date(a.due_at ?? now),
        points: a.points_possible ?? undefined,
        type: kindOf(a),
        score: a.submission?.excused ? undefined : a.submission?.score ?? undefined,
        submitted: !!a.submission?.submitted_at || a.submission?.workflow_state === "graded",
        group: a.assignment_group_id !== undefined ? String(a.assignment_group_id) : undefined,
      });
    }
  }
  // Announcements also come from the non-class pages (CS department hub, advising): students want those too.
  const codes = raw.map((c) => `context_codes[]=course_${c.id}`).join("&");
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const anns = codes
    ? await api<{ id: number; title: string; message?: string; posted_at?: string; context_code?: string }[]>(
        `/announcements?${codes}&start_date=${since}&end_date=${new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)}&per_page=50`,
      )
    : [];
  // Classes by code ("COMP 311"); org pages by their name ("UNC Department of Computer Science: Career Services Hub").
  const byCtx = new Map(raw.map((c) => [`course_${c.id}`, classes.includes(c) ? courseCode(c.course_code) : c.name]));
  return {
    source: "canvas",
    courses,
    assignments,
    announcements: anns.map((n) => ({
      id: String(n.id),
      course: byCtx.get(n.context_code ?? "") ?? "",
      title: n.title,
      message: htmlToText(n.message).slice(0, 600),
      posted: new Date(n.posted_at ?? now),
    })),
  };
}

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}
