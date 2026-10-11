// Proactive loop: polls watch() for personas in WATCH every WATCH_MS, and fires the named check-ins
// (Academic morning_due at MORNING_AT and weekly_plan at WEEKLY_PLAN_AT, Financial weekly_money at WEEKLY_AT) once per day/week.
// For the demo, /demo/trigger fires any of these on cue; this is the "real" schedule.
import type { App } from "./app.ts";
import type { Transport } from "./transport.ts";
import type { PersonaId } from "./types.ts";
import { ymd } from "./kit.ts";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function startScheduler(app: App, transport: Transport) {
  const { engine, config } = app;
  const schedule: { persona: PersonaId; trigger: string; at: string }[] = [
    { persona: "academic", trigger: "morning_due", at: config.MORNING_AT },
    { persona: "academic", trigger: "weekly_plan", at: process.env.WEEKLY_PLAN_AT ?? "sun 19:00" },
    { persona: "financial", trigger: "weekly_money", at: config.WEEKLY_AT },
  ];
  const fired = new Set<string>();
  let busy = false;

  const tick = async () => {
    if (busy) return; // a slow LLM call must not stack ticks
    busy = true;
    try {
      for (const persona of config.watchList) {
        if (!app.personas.get(persona)?.watch) continue;
        for (const o of await engine.trigger(persona, "watch")) await transport.send(o);
      }
      const now = new Date();
      for (const s of schedule) {
        if (!app.personas.get(s.persona)?.triggers?.[s.trigger] || !due(s.at, now)) continue;
        const key = `${s.persona}:${s.trigger}:${ymd(now)}`;
        if (fired.has(key)) continue;
        fired.add(key);
        for (const o of await engine.trigger(s.persona, s.trigger)) await transport.send(o);
      }
    } catch (err) {
      console.error("[scheduler]", err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  };
  console.log(`[scheduler] watch=${config.watchList.join(",") || "none"} every ${config.WATCH_MS}ms; ${schedule.map((s) => `${s.persona}.${s.trigger}@${s.at}`).join(", ")}`);
  return setInterval(tick, config.WATCH_MS);
}

// "08:00" = daily; "sun 18:00" = weekly. Due during the minute it names.
function due(at: string, now: Date): boolean {
  const m = /^(?:([a-z]{3})\s+)?(\d{1,2}):(\d{2})$/i.exec(at.trim());
  if (!m) return false;
  if (m[1] && DAYS.indexOf(m[1].toLowerCase()) !== now.getDay()) return false;
  return now.getHours() === Number(m[2]) && now.getMinutes() === Number(m[3]);
}
