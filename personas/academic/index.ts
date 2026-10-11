// Academic persona (owner: Ismail). The four contract exports, wired the same way in every folder.
import type { Persona } from "../../core/types.ts";
import { loadText } from "../../core/kit.ts";
import { tools } from "./tools.ts";
import { watch, triggers } from "./watch.ts";
import { schoolContext } from "./conflicts.ts";
import { schoolCalendar } from "./calendar.ts";
import { deanSignup } from "./canvas.ts";

const academic: Persona = {
  id: "academic",
  prompt: loadText(import.meta.url, "prompt.md"),
  routerLine:
    "Wake me for school (classes, assignments, homework, deadlines, exams, quizzes, midterms, finals, studying, Canvas, grades) " +
    "and for any plan with a day attached (trip, party, game, concert, weekend, tonight, tomorrow, Friday, Saturday, Sunday) so I can flag deadlines it collides with.",
  tools,
  watch,
  triggers,
  context: schoolContext,
  calendar: schoolCalendar,
  signup: deanSignup,
};

export default academic;
