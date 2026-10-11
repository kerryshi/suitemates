// Web sign-up: the form on GET / posts here. A sign-up skips text onboarding (the form already asked) and waits as
// "pending" until someone adds the phone under Photon Users (no API for that) and sends the intro texts from /admin.
import type { Engine } from "./engine.ts";
import type { Outbound, PersonaId, UserProfile } from "./types.ts";
import { parseBudget } from "./onboarding.ts";

const FOCUS = ["school", "money", "social", "balance"] as const;

export const INTERESTS = ["pickup sports", "gym", "food", "study groups", "concerts", "parties", "outdoors", "gaming", "art", "volunteering"];

// "919-555-0177", "(919) 555 0177", "+1 919..." → "+19195550177". US numbers only (Photon pool is US iMessage).
export function normalizePhone(raw: unknown): string | undefined {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return undefined;
}

export function parseSignup(
  body: Record<string, unknown>,
  existing: UserProfile,
  now = new Date(),
): { user: UserProfile } | { error: string } {
  const phone = normalizePhone(body.phone);
  if (!phone) return { error: "Enter a 10-digit US phone number." };
  if (phone !== existing.phone) return { error: "Phone mismatch." };
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (!name) return { error: "Tell us your first name." };
  const budget = body.budget === undefined || body.budget === "" ? undefined : parseBudget(String(body.budget));
  const goal = String(body.goal ?? "").trim().slice(0, 120);
  const interests = (Array.isArray(body.interests) ? body.interests : [])
    .map((i) => String(i).trim().toLowerCase().slice(0, 30))
    .filter(Boolean)
    .slice(0, 10);
  const focus = FOCUS.find((f) => f === body.focus);
  const win = String(body.win ?? "").trim().slice(0, 160);
  // One agent's QR (body.agent) signs you up with that agent and only touches its fields; the old all-in-one form
  // (no agent) signs you up with all three. Answers given to another agent are kept: the backend is shared.
  const agent = AGENTS.find((a) => a === body.agent);
  if (body.agent !== undefined && !agent) return { error: "Unknown agent." };
  const has = (field: string) => body[field] !== undefined && body[field] !== "";
  const forMe = (who: PersonaId) => !agent || agent === who;
  return {
    user: {
      ...existing,
      phone,
      name,
      ...(focus ? { focus } : {}),
      ...(win ? { win } : {}),
      budgetMonthly: (forMe("financial") ? budget : undefined) ?? existing.budgetMonthly ?? 500,
      savingsGoal: (forMe("financial") && goal) || existing.savingsGoal || "an emergency fund",
      interests: forMe("social") && (has("interests") || !agent) ? interests : existing.interests ?? [],
      canvasLinked: forMe("academic") ? body.canvas !== false : existing.canvasLinked, // demo: mock Canvas unless they opt out
      onboardingStep: "done",
      signupStatus: existing.signupStatus ?? "pending",
      signedUpAt: existing.signedUpAt ?? now.toISOString(),
      agents: [...new Set([...(existing.agents ?? []), ...(agent ? [agent] : AGENTS)])],
    },
  };
}

const AGENTS: PersonaId[] = ["academic", "financial", "social"];

const AVATAR: Record<PersonaId, string> = { academic: "dean", financial: "penny", social: "sunny" };
const ROLE: Record<PersonaId, string> = { academic: "school", financial: "money", social: "plans" };
// Until a persona writes its own `intro` trigger: a plain hello (no LLM call, so it can't glitch).
const DEFAULT_INTRO: Record<PersonaId, (name: string) => string> = {
  academic: (n) => `hey, I'm ${n}. I keep your Canvas deadlines, quizzes and exams in check. Text me "what's due?" anytime.`,
  financial: (n) => `hey, I'm ${n}. I keep an eye on your spending so you hit your budget. Ask me "can I afford it?" anytime.`,
  social: (n) => `hey, I'm ${n}. I find people who want to do the same things you do. Ask me "what's happening this weekend?"`,
};

// Each persona's hello, then its contact card (name, avatar, its own number if it has a dedicated line), in this
// order. A persona's own `intro` trigger wins over the default. The caller sends them, then marks the user
// invited (a Photon refusal must leave them pending).
export async function introTexts(engine: Engine, phone: string, order: PersonaId[] = ["academic", "financial", "social"]): Promise<Outbound[]> {
  const out: Outbound[] = [];
  const { names } = engine.d.config;
  for (const id of order) {
    if (!engine.d.personas.has(id)) continue;
    const own = engine.d.personas.get(id)!.triggers?.intro;
    const said = own
      ? await engine.trigger(id, "intro", { phone, force: true })
      : [{ persona: id, handle: `dm:${phone}`, text: DEFAULT_INTRO[id](names[id]) }];
    // hello → contact card → anything else the intro says (Dean's "next up: …").
    out.push(...said.slice(0, 1), cardFor(engine, id, phone), ...said.slice(1));
  }
  return out;
}

// A persona's contact card as its own message: name, avatar, and its number if it has a dedicated line.
export function cardFor(engine: Engine, id: PersonaId, phone: string): Outbound {
  const { names, PRODUCT_NAME } = engine.d.config;
  return {
    persona: id,
    handle: `dm:${phone}`,
    text: "",
    card: {
      name: `${names[id]} ${PRODUCT_NAME}`,
      photo: `docs/avatars/${AVATAR[id]}.png`,
      // The number THIS person texts: Photon's shared pool gives each person their own (looked up at sign-up),
      // so one fixed number from .env showed the wrong one to everyone but its owner. Dedicated line only on Business.
      // With one Photon project per agent, each agent's own number for this person (poolLines).
      phone: (() => {
        const u = engine.d.store.user(phone);
        return u.poolLines?.[id] || u.poolLine || process.env[`${id.toUpperCase()}_PROJECT_ID`] && process.env[`${id.toUpperCase()}_LINE`] || undefined;
      })(),
      note: `${names[id]} handles ${ROLE[id]} in ${PRODUCT_NAME}.`,
    },
  };
}
