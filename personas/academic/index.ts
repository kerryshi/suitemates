// Academic persona (owner: Ismail). The four contract exports, wired the same way in every folder.
import type { Persona } from "../../core/types.ts";
import { loadText } from "../../core/kit.ts";
import { tools } from "./tools.ts";
import { watch, triggers } from "./watch.ts";

const academic: Persona = {
  id: "academic",
  prompt: loadText(import.meta.url, "prompt.md"),
  routerLine:
    "Wake me for school: classes, assignments, homework, deadlines, exams, studying, Canvas, or plans that could collide with something due.",
  tools,
  watch,
  triggers,
};

export default academic;
