// Governance: every persona text is checked against what actually happened this turn before it goes out.
// Skeleton only (2026-10-11): signatures and rules are fixed; bodies are TODO. Plan: architect plan of record
// (G1 hand-off claims, G2 grounded numbers, G3 lanes, G4 junk/duplicates, E1 two-way hand-off).
import type { Outbound, PersonaId } from "./types.ts";

export const GOVERN = process.env.GOVERN !== "0"; // kill switch

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

// What the gate knows about a turn.
export interface TurnFacts {
  persona: PersonaId;
  setting: "dm" | "proactive" | "recruit";
  grounding?: string; // the student's text (dm), p.text (recruit), event facts (proactive)
  trace: ToolTrace[]; // this turn's tool calls and results
  dispatched: PersonaId[]; // agents whose hand-off actually went out this turn
  alreadyIn: PersonaId[]; // agents the student already has (don't re-offer)
}

export interface Verdict {
  text: string; // what may be sent (possibly rewritten)
  hits: { rule: "G1" | "G2" | "G3" | "G4"; detail: string }[];
}

// Match on a normalized copy (curly apostrophes → '), edit the original.
export const norm = (s: string) => s.replace(/[’‘]/g, "'");

// G1: "<agent> is texting you" only if dispatched; no offering an agent that is already in.
export function g1HandoffClaims(text: string, f: TurnFacts, names: Record<PersonaId, string>): Verdict {
  void f;
  void names;
  return { text, hits: [] }; // TODO
}

// G2: $ amounts and % must appear in trace results, grounding or profile (whole-dollar rounding allowed).
export function g2GroundedNumbers(text: string, f: TurnFacts): Verdict {
  void f;
  return { text, hits: [] }; // TODO
}

// G3: another agent's domain facts only from this persona's own tool results.
export function g3Lanes(text: string, f: TurnFacts): Verdict {
  void f;
  return { text, hits: [] }; // TODO
}

// Content gate (G1–G3): runs in Engine.replyOrThrow between respond() and pushHistory.
export function govern(text: string, f: TurnFacts, names: Record<PersonaId, string>): Verdict {
  if (!GOVERN) return { text, hits: [] };
  const hits: Verdict["hits"] = [];
  for (const step of [(t: string) => g1HandoffClaims(t, f, names), (t: string) => g2GroundedNumbers(t, f), (t: string) => g3Lanes(t, f)]) {
    const v = step(text);
    text = v.text;
    hits.push(...v.hits);
  }
  return { text, hits };
}

// Exit gate (G4): empty / "(no reply)" / exact duplicate per (sender, student). Drops and logs, never throws;
// a recruit-setting text is replaced, never silenced. Installed as a transport wrapper in core/main.ts.
export function exitCheck(o: Outbound, lastSent: Map<string, string>): { send: boolean; replacement?: string; reason?: string } {
  void o;
  void lastSent;
  return { send: true }; // TODO
}
