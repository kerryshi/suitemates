// Who answers a DM on a shared number: each persona's routerLine says what it handles; the one with the most of
// those words in the text wins (core/engine.ts pickPersona).
import type { Persona, PersonaId } from "./types.ts";
import { stem } from "./llm/fake.ts";

const STOP = new Set(
  "when user users mentions mention asks about their with that this they wake speak should anything like something talks what into have from".split(" "),
);

// How many distinct routerLine words each persona has in the text (DM routing on a shared number picks the max).
export function keywordScores(text: string, personas: Map<PersonaId, Persona>): Map<PersonaId, number> {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g)?.map(stem) ?? []);
  return new Map(
    [...personas.values()].map((p) => {
      const line = new Set((p.routerLine.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem));
      return [p.id, [...line].filter((w) => words.has(w)).length] as const;
    }),
  );
}
