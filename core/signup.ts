// Web sign-up: the form on GET / posts here. A sign-up skips text onboarding (the form already asked) and waits as
// "pending" until someone adds the phone under Photon Users (no API for that) and sends the intro texts from /admin.
import type { Engine } from "./engine.ts";
import type { Outbound, PersonaId, UserProfile } from "./types.ts";
import { parseBudget } from "./onboarding.ts";

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
  return {
    user: {
      ...existing,
      phone,
      name,
      budgetMonthly: budget ?? existing.budgetMonthly ?? 500,
      savingsGoal: goal || existing.savingsGoal || "an emergency fund",
      interests,
      canvasLinked: body.canvas !== false, // demo: mock Canvas unless they opt out
      onboardingStep: "done",
      signupStatus: existing.signupStatus === "invited" ? "invited" : "pending",
      signedUpAt: existing.signedUpAt ?? now.toISOString(),
    },
  };
}

// Every persona's `intro` trigger, in this order (a persona without one is skipped). The caller sends them, then
// marks the user invited (a Photon refusal must leave them pending).
export async function introTexts(engine: Engine, phone: string, order: PersonaId[] = ["academic", "financial", "social"]): Promise<Outbound[]> {
  const out: Outbound[] = [];
  for (const id of order) {
    if (!engine.d.personas.get(id)?.triggers?.intro) continue;
    out.push(...(await engine.trigger(id, "intro", { phone, force: true })));
  }
  return out;
}
