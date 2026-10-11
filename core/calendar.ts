// The student's shared calendar: every agent they signed up with adds its items (Persona.calendar), served as a
// private .ics feed at /cal/<token>.ics. Google Calendar → "Other calendars" → "From URL" subscribes to it and
// refreshes on its own, so Dean's deadlines and Sunny's plans sit next to their real schedule. No Google sign-in.
// The token is an HMAC of the phone, so links can't be guessed and nothing extra is stored.
import type { Engine } from "./engine.ts";
import type { CalendarItem, PersonaId } from "./types.ts";
export { calToken, calUrl } from "./kit.ts";

const ALL: PersonaId[] = ["academic", "financial", "social"];

export async function calendarItems(engine: Engine, phone: string): Promise<CalendarItem[]> {
  const user = engine.d.store.user(phone);
  const items: CalendarItem[] = [];
  for (const id of user.agents ?? ALL) {
    const p = engine.d.personas.get(id);
    if (!p?.calendar) continue;
    try {
      items.push(...(await p.calendar(engine.ctx(id, user))));
    } catch (err) {
      engine.log(`WARN ${id} calendar failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return items.sort((a, b) => +a.start - +b.start);
}

// RFC 5545, just what calendar apps need: UTC times, escaped text, lines folded at 75 octets.
export function toIcs(items: CalendarItem[], name: string, now = new Date()): string {
  const t = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = (line: string) => {
    const out: string[] = [];
    let rest = line;
    while (Buffer.byteLength(rest) > 75) {
      let n = 75;
      while (Buffer.byteLength(rest.slice(0, n)) > 75) n--;
      out.push(rest.slice(0, n));
      rest = " " + rest.slice(n);
    }
    return [...out, rest].join("\r\n");
  };
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Suitemates//HackNC 2026//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const it of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${esc(it.id)}@suitemates`,
      `DTSTAMP:${t(now)}`,
      `DTSTART:${t(it.start)}`,
      `DTEND:${t(it.end ?? new Date(it.start.getTime() + 30 * 60_000))}`,
      `SUMMARY:${esc(it.title)}`,
      ...(it.note ? [`DESCRIPTION:${esc(it.note)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
