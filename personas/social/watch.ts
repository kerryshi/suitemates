// Proactive texts for Social (owner: Abdullah). Core writes the DM in Social's voice from `facts`;
// if that LLM call fails, core sends `facts` as-is, so they're written to the user ("you").
// Polled only if "social" is in WATCH (e.g. WATCH=financial,social). On cue, to a real phone over iMessage:
// SERVER_URL=http://localhost:3000 npm run trigger -- social match +1<phone> (without SERVER_URL it only prints).
// Use the poll OR the cue in a demo, not both: the cue is forced, so it resends what the poll already sent.
// Stateless on purpose: who-joined-after-whom lives on the shared board (joinedAt), and core's dedupeKey
// claim makes each text go out once, while the forced demo trigger can always resend it.
import type { Ctx, WatchEvent } from "../../core/types.ts";
import { type Activity, type Board, loadBoard, nameOf } from "./board.ts";

export const HOT_AT = 3; // a plan the user was never in is worth a text when a live join brings it to this many

const roster = (b: Board, a: Activity, ctx: Ctx) => a.signups.map((p) => nameOf(b, p, ctx)).join(", ");

// A match formed: someone joined a plan after the user did (seeded people were there before anyone).
// Newest join first.
function matches(b: Board, ctx: Ctx): WatchEvent[] {
  const me = ctx.user.phone;
  return b.activities
    .filter((a) => a.signups.includes(me))
    .flatMap((a) => {
      const mine = a.joinedAt?.[me] ?? 0;
      return a.signups
        .filter((p) => p !== me && (a.joinedAt?.[p] ?? 0) > mine)
        .map((p) => ({
          at: a.joinedAt?.[p] ?? 0,
          ev: {
            kind: "match",
            userPhone: me,
            facts: `${nameOf(b, p, ctx)} joined ${a.name} (${a.when}) after you. Now ${a.signups.length} in: ${roster(b, a, ctx)}.`,
            dedupeKey: `social:match:${b.gen ?? "v1"}:${me}:${a.id}:${p}`,
          },
        }));
    })
    .sort((x, y) => y.at - x.at)
    .map((m) => m.ev);
}

// A plan took off without the user: a live join made it HOT_AT+ and they've never been in it.
// Newest first; core's dedupeKey claim sends each one once, so an older hot plan isn't dropped.
function hotPlan(b: Board, ctx: Ctx): WatchEvent[] {
  const me = ctx.user.phone;
  const crossedAt = (a: Activity) => a.joinedAt?.[a.signups[HOT_AT - 1]] ?? 0; // when the HOT_AT-th person joined
  return b.activities
    .filter((a) => a.signups.length >= HOT_AT && !a.signups.includes(me) && a.joinedAt?.[me] === undefined && crossedAt(a) > 0)
    .sort((x, y) => crossedAt(y) - crossedAt(x))
    .map((hot) => ({
      kind: "hot_plan",
      userPhone: me,
      facts: `${hot.signups.length} people want ${hot.name}, ${hot.when} (${roster(b, hot, ctx)})${hot.costEstimate ? `, ~$${hot.costEstimate}` : ""}. You're not in yet; want in?`,
      dedupeKey: `social:hot:${b.gen ?? "v1"}:${me}:${hot.id}`,
    }));
}

export async function watch(ctx: Ctx): Promise<WatchEvent[]> {
  const b = loadBoard();
  return [...matches(b, ctx), ...hotPlan(b, ctx)];
}

export const triggers = {
  // On cue for the demo: only the newest "someone joined your plan" text, so a forced re-run
  // can't replay every old match on stage. npm run trigger -- social match
  async match(ctx: Ctx): Promise<WatchEvent[]> {
    return matches(loadBoard(), ctx).slice(0, 1);
  },
};
