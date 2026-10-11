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
  onboardingWith?: PersonaId; // whose setup is in progress: texting another persona mid-setup restarts with theirs
  // Web sign-up (core/signup.ts): pending until we add them in Photon and send the intro texts.
  interests?: string[];
  focus?: "school" | "money" | "social" | "balance"; // "this semester I'm mostly trying to…"
  win?: string; // "what would make this semester a win?" (free text)
  signupStatus?: "pending" | "added" | "invited"; // pending → on the Photon allowlist → greeted
  agents?: PersonaId[]; // who they signed up with on the web (each agent has its own QR); unset = texted in directly
  greeted?: PersonaId[]; // agents that already sent their intro + contact card
  lastAgent?: PersonaId; // who answered their last DM (shared pool: replies go back to them by default)
  signedUpAt?: string; // ISO
  poolLine?: string; // the Photon number they text (shared pool: differs per person), from the sign-up lookup
  canvasToken?: string; // their own Canvas access token (Dean's sign-up). Server-side only: never logged or listed.
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
  // One or two lines the OTHER personas may know about this user (e.g. Dean: "midterm Wednesday"), so they can plan
  // together. Shown in their prompts. Optional; keep it short and leave out anything private (exact grades, balances).
  context?(ctx: Ctx): Promise<string>;
  // What this persona puts on the student's shared calendar (core/calendar.ts serves it as an .ics feed Google
  // Calendar subscribes to): Dean's deadlines and exams, Sunny's plans they joined. Optional.
  calendar?(ctx: Ctx): Promise<CalendarItem[]>;
  // Check this agent's own web sign-up fields (e.g. Dean verifies a Canvas token) and say what to save on the
  // profile. An error blocks the sign-up with that message. Optional.
  signup?(body: Record<string, unknown>, ctx: Ctx): Promise<{ error: string } | { profile: Partial<UserProfile>; note?: string }>;
  // A website demo action (POST /try/<persona> {phone, action}), e.g. Penny's "buy a $23 DoorDash" button.
  // Core only lets people who signed up with this agent and got its hello use it. Optional.
  tryIt?(action: string, ctx: Ctx): Promise<{ error: string } | { note: string }>;
}

export interface CalendarItem {
  id: string; // stable per item (the feed's UID), e.g. "academic:a3"
  title: string; // "COMP 421 Project 1 due"
  start: Date;
  end?: Date; // default: start + 30 min
  note?: string;
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
  // true when the number they texted belongs to `persona` alone (its own *_LINE or project). On the shared pool
  // it's unset, `persona` is just DEFAULT_PERSONA, and the engine picks among the user's own agents.
  lineKnown?: boolean;
}

export interface Outbound {
  persona: PersonaId; // send FROM this persona's number
  handle: string; // conversation id on that line, or "dm:<phone>" to start/continue a DM
  text: string;
  // A contact card (vCard: name, photo, the persona's own number if it has one) sent after `text` (which may be "").
  card?: { name: string; photo: string; phone?: string; note?: string }; // photo: repo-relative path
}
