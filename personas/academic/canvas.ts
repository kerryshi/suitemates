// Assignments and grades from Canvas, or from personas/academic/mock-canvas.json when ctx.mock.
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
}

export interface Course {
  code: string;
  name: string;
  grade?: number; // current score, percent
}

interface MockCanvas {
  courses: Course[];
  assignments: (Omit<Assignment, "due"> & { dueInDays?: number; dueWeekday?: string; daysAgo?: number; time?: string })[];
}

export const TAG: Record<string, string> = { exam: " (EXAM)", quiz: " (QUIZ)" };

// "COMP 421: Quiz 4 (QUIZ), due Monday 10:00 AM, 10 pts"
export function describe(a: Assignment, now: Date): string {
  return `${a.course}: ${a.name}${TAG[a.type ?? ""] ?? ""}, due ${fmtWhen(a.due, now)}${a.points ? `, ${a.points} pts` : ""}`;
}

const mock = (): MockCanvas => JSON.parse(loadText(import.meta.url, "mock-canvas.json"));

// Upcoming work (due today or later), soonest first.
export async function getAssignments(ctx: Ctx): Promise<Assignment[]> {
  const list = ctx.mock ? fromMock(ctx.now) : await fromCanvas(ctx.now);
  return list.filter((a) => a.due >= startOfDay(ctx.now)).sort((a, b) => +a.due - +b.due);
}

// Current course grades plus graded work, newest first.
export async function getGrades(ctx: Ctx): Promise<{ courses: Course[]; graded: Assignment[] }> {
  if (!ctx.mock) throw new Error("grades from real Canvas aren't wired up yet (run with MOCK=1)");
  const graded = fromMock(ctx.now)
    .filter((a) => a.score !== undefined)
    .sort((a, b) => +b.due - +a.due);
  return { courses: mock().courses, graded };
}

function fromMock(now: Date): Assignment[] {
  return mock().assignments.map(({ dueInDays, dueWeekday, daysAgo, time, ...a }) => ({
    ...a,
    due: relativeDate(now, { dueInDays, dueWeekday, daysAgo, time }),
  }));
}

// UNVERIFIED until we have a UNC token (Canvas → Account → Settings → New Access Token).
async function fromCanvas(now: Date): Promise<Assignment[]> {
  const token = process.env.CANVAS_TOKEN;
  const base = process.env.CANVAS_BASE_URL ?? "https://uncch.instructure.com";
  if (!token) throw new Error("CANVAS_TOKEN is not set (or run with MOCK=1)");
  const start = startOfDay(now);
  const end = new Date(start.getTime() + 14 * 86_400_000);
  const url = `${base}/api/v1/planner/items?start_date=${start.toISOString()}&end_date=${end.toISOString()}&per_page=100`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Canvas ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items = (await res.json()) as {
    plannable_id: number;
    plannable_type?: string;
    context_name?: string;
    plannable_date?: string;
    plannable?: { title?: string; name?: string; due_at?: string; points_possible?: number };
  }[];
  return items
    .filter((i) => i.plannable?.due_at ?? i.plannable_date)
    .map((i) => ({
      id: String(i.plannable_id),
      course: i.context_name ?? "",
      name: i.plannable?.title ?? i.plannable?.name ?? "untitled",
      due: new Date(i.plannable?.due_at ?? i.plannable_date!),
      points: i.plannable?.points_possible,
      type: i.plannable_type === "quiz" ? "quiz" : i.plannable_type === "discussion_topic" ? "discussion" : "assignment",
    }));
}

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}
