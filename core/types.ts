// THE persona contract. Every personas/<id>/index.ts default-exports a `Persona`.
// Personas import only this file and core/kit.ts. Change this file only with the whole team.

export type PersonaId = "academic" | "financial" | "social";
export const PERSONA_IDS: PersonaId[] = ["academic", "financial", "social"];

export interface UserProfile {
  phone: string; // E.164, e.g. "+19195550001" — the user's id everywhere
  name?: string;
  budgetMonthly?: number; // dollars
  savingsGoal?: string; // free text, e.g. "spring break, $400"
  canvasLinked: boolean;
  onboardingStep: 0 | 1 | 2 | "done";
  onboardingRetries?: number;
}

// What every tool, watch() and trigger receives.
export interface Ctx {
  user: UserProfile;
  mock: boolean; // MOCK=1 (the default) → read mock/ instead of real APIs
  now: Date;
  kv: { get<T>(k: string): T | undefined; set(k: string, v: unknown): void }; // per persona + user, persisted
  log: (msg: string) => void;
}

export interface ToolParam {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
}

// A function Gemini can call. Copy personas/academic/tools.ts to add one.
export interface Tool {
  name: string; // snake_case, unique within the persona
  description: string; // Gemini reads this to decide WHEN to call it — be specific
  parameters: { properties: Record<string, ToolParam>; required?: string[] };
  run(args: Record<string, unknown>, ctx: Ctx): Promise<string>; // return plain text or JSON text; Gemini reads it
}

// Something worth texting the user about, unprompted. Core writes the actual text in the
// persona's voice from `facts`, and never delivers the same dedupeKey twice.
export interface WatchEvent {
  kind: string; // "purchase" | "due_today" | "match" ...
  userPhone: string; // who gets the DM (sent from this persona's own number)
  facts: string; // plain facts, e.g. "New purchase: DoorDash $23.40 at 3:12 AM. Budget left: $212."
  dedupeKey: string; // e.g. "purchase:<nessie id>"
}

export interface Persona {
  id: PersonaId;
  prompt: string; // contents of prompt.md: voice + rules
  routerLine: string; // one sentence: when should this persona speak in the group chat?
  tools: Tool[];
  // Polled every WATCH_MS for each onboarded user. Optional.
  watch?(ctx: Ctx): Promise<WatchEvent[]>;
  // Named proactive messages. The scheduler AND /demo/trigger call these by name.
  triggers?: Record<string, (ctx: Ctx) => Promise<WatchEvent[]>>;
}

// ---- core-internal (transport-agnostic message shapes) ----

export interface Inbound {
  persona: PersonaId; // whose number received it
  kind: "dm" | "group";
  sender: string; // user phone/handle
  text?: string;
  image?: { bytes: Uint8Array; mimeType: string };
  handle: string; // conversation id on that persona's line
  messageId: string;
}

export interface Outbound {
  persona: PersonaId; // send FROM this persona's number
  handle: string; // conversation id on that line, or "dm:<phone>" to start/continue a DM
  text: string;
}
