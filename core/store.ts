// State in one JSON file (data/state.json). Tiny on purpose: a demo has a handful of users.
// Pass file = null for an in-memory store (tests).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PersonaId, UserProfile } from "./types.ts";

export interface Turn {
  role: "user" | "model";
  text: string;
}

interface State {
  users: Record<string, UserProfile>;
  history: Record<string, Turn[]>; // "<persona>:<phone>"
  seen: Record<string, number>; // delivered WatchEvent dedupeKeys → epoch ms
  kv: Record<string, Record<string, unknown>>; // "<persona>:<phone>"
}

const HISTORY_TURNS = 12;

export class Store {
  private state: State = { users: {}, history: {}, seen: {}, kv: {} };
  private readonly file: string | null;

  constructor(file: string | null) {
    this.file = file;
    if (file && existsSync(file)) this.state = { ...this.state, ...JSON.parse(readFileSync(file, "utf8")) };
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  user(phone: string): UserProfile {
    return (this.state.users[phone] ??= { phone, canvasLinked: false, onboardingStep: 0 });
  }

  saveUser(u: UserProfile) {
    this.state.users[u.phone] = u;
    this.save();
  }

  resetUser(phone: string) {
    delete this.state.users[phone];
    for (const k of Object.keys(this.state.history)) if (k.endsWith(`:${phone}`)) delete this.state.history[k];
    for (const k of Object.keys(this.state.kv)) if (k.endsWith(`:${phone}`)) delete this.state.kv[k];
    this.save();
  }

  onboardedUsers(): UserProfile[] {
    return Object.values(this.state.users).filter((u) => u.onboardingStep === "done");
  }

  history(persona: PersonaId, phone: string): Turn[] {
    return this.state.history[`${persona}:${phone}`] ?? [];
  }

  pushHistory(persona: PersonaId, phone: string, ...turns: Turn[]) {
    const key = `${persona}:${phone}`;
    this.state.history[key] = [...(this.state.history[key] ?? []), ...turns].slice(-HISTORY_TURNS);
    this.save();
  }

  // true the first time a key is claimed, false after (WatchEvent dedupe)
  claim(dedupeKey: string): boolean {
    if (this.state.seen[dedupeKey]) return false;
    this.state.seen[dedupeKey] = Date.now();
    this.save();
    return true;
  }

  kv(persona: PersonaId, phone: string) {
    const key = `${persona}:${phone}`;
    return {
      get: <T>(k: string) => this.state.kv[key]?.[k] as T | undefined,
      set: (k: string, v: unknown) => {
        (this.state.kv[key] ??= {})[k] = v;
        this.save();
      },
    };
  }
}
