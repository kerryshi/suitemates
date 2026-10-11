// Real UNC events from Heel Life (heellife.unc.edu, Campus Labs Engage): the public JSON feed its own event
// pages use (no login). Unofficial, so be polite: one request per CACHE_MS per server, a short timeout, and if
// it fails Sunny says she can't reach Heel Life right now instead of inventing events.
import { clean } from "./board.ts";

export interface HeelEvent {
  id: string;
  name: string;
  start: Date;
  end: Date;
  location: string;
  org: string;
  theme: string; // Heel Life's theme: Arts, Athletics, Social, CommunityService, Cultural, ThoughtfulLearning, …
  categories: string[]; // Heel Life's own category names
  freeFood: boolean;
  rsvps: number;
  url: string;
}

const BASE = "https://heellife.unc.edu";
export const CACHE_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000; // after a failed fetch, don't try again for this long (no 8 s stall on every text)
const DAYS_AHEAD = 7;
const TIMEOUT_MS = 8_000;
const HOUR = 3_600_000;
const MAX_HOURS = 12; // longer "events" are exhibits, programs or online drives running for weeks: not a plan
const STARTED_GRACE_HOURS = 3; // an event that started a bit ago is still worth mentioning

type Fetcher = (url: string) => Promise<unknown>;
const live: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Heel Life answered ${res.status}`);
  return res.json();
};
let fetcher: Fetcher = live;
let cache: { at: number; events: HeelEvent[] } | undefined;
let failedAt: number | undefined;
let inflight: Promise<HeelEvent[]> | undefined; // one request shared by everyone asking at the same moment

// Tests: useEventsFetcher(fake) never touches the network; useEventsFetcher() goes back to the live feed.
export function useEventsFetcher(f?: Fetcher) {
  fetcher = f ?? live;
  cache = undefined;
  failedAt = undefined;
  inflight = undefined;
}

const text = (v: unknown, max: number) => clean(typeof v === "string" ? v : "", max);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// The feed's `value` array → events. Only public, approved events with a name and valid times.
export function parseEvents(json: unknown): HeelEvent[] {
  const rows = (json as { value?: unknown })?.value;
  if (!Array.isArray(rows)) throw new Error("Heel Life sent something that isn't an event list");
  const seen = new Set<string>(); // the feed repeats some events (same name and start): keep one
  return rows.flatMap((r: Record<string, unknown>) => {
    const start = new Date(String(r.startsOn));
    const end = new Date(String(r.endsOn));
    const name = text(r.name, 80);
    const id = String(r.id ?? "").replace(/\D/g, "");
    if (!id || !name || isNaN(+start) || isNaN(+end)) return [];
    if ((r.visibility && r.visibility !== "Public") || (r.status && r.status !== "Approved")) return [];
    const key = `${name.toLowerCase()}|${+start}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        id,
        name,
        start,
        end,
        location: text(r.location, 80),
        org: text(r.organizationName, 80),
        theme: text(r.theme, 40),
        categories: list(r.categoryNames).map((c) => text(c, 60)),
        freeFood: list(r.benefitNames).some((b) => /free food/i.test(b)),
        rsvps: typeof r.rsvpTotal === "number" ? r.rsvpTotal : 0,
        url: `${BASE}/event/${id}`,
      },
    ];
  });
}

// This week's events (now → now + 7 days), soonest first: not over, not started more than a few hours ago, and
// no longer than MAX_HOURS. Cached for CACHE_MS; a failed refresh falls back to the last good list and waits
// RETRY_MS before trying again; with nothing cached the error propagates.
export async function campusEvents(now: Date): Promise<HeelEvent[]> {
  const t = now.getTime();
  const upcoming = (events: HeelEvent[]) =>
    events.filter((e) => +e.end > t && +e.start >= t - STARTED_GRACE_HOURS * HOUR && +e.end - +e.start <= MAX_HOURS * HOUR);
  if (cache && t - cache.at < CACHE_MS) return upcoming(cache.events);
  if (failedAt !== undefined && t - failedAt < RETRY_MS) {
    if (cache) return upcoming(cache.events);
    throw new Error("Heel Life was unreachable a moment ago");
  }
  const q = new URLSearchParams({
    endsAfter: now.toISOString(),
    startsBefore: new Date(now.getTime() + DAYS_AHEAD * 86_400_000).toISOString(),
    orderByField: "endsOn",
    orderByDirection: "ascending",
    status: "Approved",
    take: "200",
    query: "",
  });
  inflight ??= (async () => {
    try {
      const events = parseEvents(await fetcher(`${BASE}/api/discovery/event/search?${q}`)).sort((a, b) => +a.start - +b.start);
      cache = { at: t, events };
      failedAt = undefined;
      return events;
    } catch (err) {
      failedAt = t;
      throw err;
    } finally {
      inflight = undefined;
    }
  })();
  try {
    return upcoming(await inflight);
  } catch (err) {
    if (cache) return upcoming(cache.events);
    throw err;
  }
}
