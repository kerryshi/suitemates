// Assignments from Canvas, or from mock/canvas.json when ctx.mock.
import type { Ctx } from "../../core/types.ts";
import { loadMock, relativeDate } from "../../core/kit.ts";

export interface Assignment {
  id: string;
  course: string;
  name: string;
  due: Date;
  points?: number;
  type?: string;
}

interface MockCanvas {
  assignments: { id: string; course: string; name: string; dueInDays?: number; dueWeekday?: string; time?: string; points?: number; type?: string }[];
}

export async function getAssignments(ctx: Ctx): Promise<Assignment[]> {
  const list = ctx.mock ? fromMock(ctx.now) : await fromCanvas(ctx.now);
  return list.filter((a) => a.due >= startOfDay(ctx.now)).sort((a, b) => +a.due - +b.due);
}

function fromMock(now: Date): Assignment[] {
  return loadMock<MockCanvas>("canvas").assignments.map((a) => ({ ...a, due: relativeDate(now, a) }));
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
    }));
}

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}
