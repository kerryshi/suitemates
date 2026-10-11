// Social persona (owner: Abdullah). Abdullah also owns router-prompt.md (the group chat router).
import type { Persona } from "../../core/types.ts";
import { loadText } from "../../core/kit.ts";
import { tools } from "./tools.ts";
import { triggers, watch } from "./watch.ts";
import { plansCalendar } from "./calendar.ts";

const social: Persona = {
  id: "social",
  prompt: loadText(import.meta.url, "prompt.md"),
  routerLine:
    "Wake me for plans and hanging out: trips, outings, parties, sports, soccer, games, boba, events, weekend plans, " +
    "'anyone down for…', or joining or dropping out of a plan.",
  tools,
  watch, // "Jordan joined soccer after you" for plans you're in; "3 people want boba" when a plan takes off without you
  triggers,
  calendar: plansCalendar, // the plans they joined, on their shared Google Calendar feed
};

export default social;
