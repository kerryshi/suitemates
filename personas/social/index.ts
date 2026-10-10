// Social persona (owner: Abdallah). Abdallah also owns router-prompt.md (the group chat router).
import type { Persona } from "../../core/types.ts";
import { loadText } from "../../core/kit.ts";
import { tools } from "./tools.ts";

const social: Persona = {
  id: "social",
  prompt: loadText(import.meta.url, "prompt.md"),
  routerLine:
    "Wake me for plans and hanging out: trips, outings, parties, sports, events, weekend plans, or 'anyone down for…'.",
  tools,
  // watch: TODO(social), e.g. "3 people want pickup soccer Sunday" when a new match forms.
};

export default social;
