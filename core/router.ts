// Group chat router: which persona(s) should answer this message? Possibly none.
// Core runs it; the prompt is personas/social/router-prompt.md; each persona supplies its routerLine.
import type { Persona, PersonaId } from "./types.ts";
import type { LlmClient } from "./llm/client.ts";
import { stem } from "./llm/fake.ts";

export interface RouteArgs {
  text: string;
  personas: Map<PersonaId, Persona>;
  names: Record<PersonaId, string>;
  llm: LlmClient;
  routerPrompt: string;
  fakeRoute?: PersonaId[];
  log?: (msg: string) => void;
}

export async function route(a: RouteArgs): Promise<PersonaId[]> {
  if (a.fakeRoute) return a.fakeRoute.filter((id) => a.personas.has(id));
  if (a.llm.name === "fake") return keywordRoute(a.text, a.personas);
  const lines = [...a.personas.values()].map((p) => `- ${p.id} (${a.names[p.id]}): ${p.routerLine}`).join("\n");
  try {
    const out = await a.llm.json({ system: a.routerPrompt.replace("{{ROUTER_LINES}}", lines), text: a.text });
    const ids = (JSON.parse(out) as { personas?: unknown }).personas;
    if (!Array.isArray(ids)) throw new Error(`router returned ${out.slice(0, 200)}`);
    return ids.filter((id): id is PersonaId => typeof id === "string" && a.personas.has(id as PersonaId));
  } catch (err) {
    a.log?.(`router LLM failed, using keywords: ${err instanceof Error ? err.message : err}`);
    return keywordRoute(a.text, a.personas);
  }
}

const STOP = new Set(
  "when user users mentions mention asks about their with that this they wake speak should anything like something talks what into have from".split(" "),
);

// Fallback + keyless mode: a persona wakes if any 4+ letter word of its routerLine appears in the text.
export function keywordRoute(text: string, personas: Map<PersonaId, Persona>): PersonaId[] {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g)?.map(stem) ?? []);
  return [...personas.values()]
    .filter((p) => (p.routerLine.toLowerCase().match(/[a-z]{4,}/g) ?? []).some((w) => !STOP.has(w) && words.has(stem(w))))
    .map((p) => p.id);
}
