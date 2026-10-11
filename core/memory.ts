// Shared memory: short durable facts about a user ("vegetarian, no car") that every agent reads.
// Any agent saves one with the `remember` tool, which core adds to every persona; the notes go into every prompt,
// so reading them costs no Gemini call. Stored per server in the Store's kv under "shared:<phone>", so /reset and
// deleting the state file clear them.
import type { Persona, PersonaId, Tool, UserProfile } from "./types.ts";
import type { Store } from "./store.ts";

export interface Note {
  text: string;
  by: PersonaId;
  at: string; // ISO time it was saved
}

export const MAX_NOTES = 15; // oldest dropped first
export const NOTE_MAX_CHARS = 120;
const ALREADY_KNOWN = "budget, savings goal, semester focus, what a win looks like, interests";
// Backstop only; the tool description carries the rule. Mirrors Persona.context: no exact grades or balances,
// and no phone numbers (Social keeps phone digits out of model-visible text too).
const PRIVATE = /\d\s*%|\b(balance|grade|gpa|score|scored)\b[^.]*\d|\d[^.]*\b(balance|grade|gpa)\b|\+?\d[\d\s().-]{8,}\d/i;

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");

export function listNotes(store: Store, phone: string): Note[] {
  return store.kv("shared", phone).get<Note[]>("notes") ?? [];
}

export function addNote(store: Store, phone: string, by: PersonaId, text: string, now: Date): "saved" | "duplicate" | "private" | "empty" {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX_CHARS);
  if (!clean) return "empty";
  if (PRIVATE.test(clean)) return "private";
  const notes = listNotes(store, phone);
  if (notes.some((n) => norm(n.text) === norm(clean))) return "duplicate";
  store.kv("shared", phone).set("notes", [...notes, { text: clean, by, at: now.toISOString() }].slice(-MAX_NOTES));
  return "saved";
}

function rememberTool(store: Store, by: PersonaId, userText: string, all: string): Tool {
  return {
    name: "remember",
    description:
      `Save one durable fact about this user for all of you (${all}) to see in later texts: a preference (vegetarian, ` +
      "hates mornings), a constraint (no car, works Tuesdays), or a decision or plan they made (finishing Project 1 " +
      "Saturday). One short sentence. Call it in the same turn as your other tools. Never save exact balances or grades, " +
      `chit-chat, questions, or what's already known (${ALREADY_KNOWN}).`,
    parameters: { properties: { note: { type: "string", description: `One sentence, under ${NOTE_MAX_CHARS} characters.` } }, required: ["note"] },
    async run(args, ctx) {
      // The keyless stand-in model calls tools with no arguments: then only an explicit "remember: …" counts, so an
      // ordinary question that happened to match this tool's description is never saved.
      const said = /^\s*remember(?: that)?:?\s*([\s\S]+)$/i.exec(userText.replace(/\n\n\(Already said[\s\S]*$/, ""));
      const note = typeof args.note === "string" && args.note.trim() ? args.note : (said?.[1] ?? "");
      const result = addNote(store, ctx.user.phone, by, note, ctx.now);
      if (result === "saved") return `saved: ${listNotes(store, ctx.user.phone).at(-1)!.text}`;
      if (result === "duplicate") return "already noted";
      if (result === "private") return "not saved: notes can't hold balances or grades; save the preference or plan instead";
      return "error: nothing to save";
    },
  };
}

function notesSection(notes: Note[], names: Record<PersonaId, string>, all: string): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return [
    "## Shared notes (written by core)",
    `All of you (${all}) read these; whoever learns something durable writes it with the remember tool. Use them; don't recite them.`,
    ...(notes.length ? notes.map((n) => `- ${names[n.by] ?? n.by}, ${day(n.at)}: ${n.text}`) : ["- (nothing yet)"]),
    "Remember when you learn a preference, constraint, decision or plan: one short sentence, no exact balances or grades. " +
      `Skip chit-chat, questions, and what's already known (${ALREADY_KNOWN}).`,
  ].join("\n");
}

// The persona as the model sees it for this turn: its prompt plus this user's notes, its tools plus `remember`
// (last, so the keyless model still prefers the persona's own tools). A copy: loaded personas are shared.
export function withMemory(persona: Persona, o: { store: Store; user: UserProfile; names: Record<PersonaId, string>; text: string }): Persona {
  const all = Object.values(o.names).join(", ");
  return {
    ...persona,
    prompt: `${persona.prompt.trim()}\n\n${notesSection(listNotes(o.store, o.user.phone), o.names, all)}`,
    tools: [...persona.tools, rememberTool(o.store, persona.id, o.text, all)],
  };
}
