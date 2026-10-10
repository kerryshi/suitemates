// Loads and checks the three persona folders. The ONLY core file that imports personas by name.
import type { Persona, PersonaId } from "./types.ts";
import { loadText } from "./kit.ts";
import academic from "../personas/academic/index.ts";
import financial from "../personas/financial/index.ts";
import social from "../personas/social/index.ts";

export function loadPersonas(): Map<PersonaId, Persona> {
  const all: [PersonaId, Persona][] = [
    ["academic", academic],
    ["financial", financial],
    ["social", social],
  ];
  return new Map(all.map(([id, p]) => [id, validatePersona(p, id)]));
}

// The group chat router prompt is owned by Social; core fills in {{ROUTER_LINES}}.
export function loadRouterPrompt(): string {
  return loadText(import.meta.url, "../personas/social/router-prompt.md");
}

// Throws a message the folder's owner can act on. Called at startup, so a broken persona fails loudly.
export function validatePersona(p: Persona, expectedId: PersonaId): Persona {
  const where = `personas/${expectedId}/index.ts`;
  const fail = (msg: string): never => {
    throw new Error(`${where}: ${msg}`);
  };
  if (!p || typeof p !== "object") fail("must `export default` a Persona object");
  if (p.id !== expectedId) fail(`id is "${p.id}", expected "${expectedId}"`);
  if (!p.prompt?.trim()) fail("prompt is empty (is prompt.md there?)");
  if (!p.routerLine?.trim()) fail("routerLine is empty");
  if (!Array.isArray(p.tools)) fail("tools must be an array (use [] for none)");
  const names = new Set<string>();
  for (const t of p.tools) {
    if (!/^[a-z][a-z0-9_]*$/.test(t.name ?? "")) fail(`tool name "${t.name}" must be snake_case`);
    if (names.has(t.name)) fail(`two tools are named "${t.name}"`);
    names.add(t.name);
    if (!t.description?.trim()) fail(`tool "${t.name}" needs a description`);
    if (typeof t.run !== "function") fail(`tool "${t.name}" needs a run(args, ctx) function`);
    const props = t.parameters?.properties ?? fail(`tool "${t.name}" needs parameters.properties ({} for none)`);
    for (const r of t.parameters.required ?? []) {
      if (!(r in props)) fail(`tool "${t.name}" requires "${r}" but it isn't in parameters.properties`);
    }
  }
  if (p.watch !== undefined && typeof p.watch !== "function") fail("watch must be a function");
  for (const [name, fn] of Object.entries(p.triggers ?? {})) {
    if (typeof fn !== "function") fail(`trigger "${name}" must be a function`);
  }
  return p;
}
