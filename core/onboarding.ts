// First-contact setup. Penny/Sunny: "hi" → monthly budget → one savings goal → Canvas (pre-linked in the demo).
// Dean (academic): "hi" → one Canvas question → linked (any answer, mock data).
// Pure: takes the profile, returns the reply and the updated profile. The engine saves it.
import type { PersonaId, UserProfile } from "./types.ts";

const ROLE: Record<PersonaId, string> = { academic: "school", financial: "money", social: "plans" };

export interface OnboardNames {
  me: PersonaId; // the persona whose number they texted
  product: string;
  academic: string;
  financial: string;
  social: string;
}

const DEFAULT_BUDGET = 500;

export function onboard(user: UserProfile, text: string, n: OnboardNames): { reply: string; user: UserProfile } {
  if (n.me === "academic") return onboardAcademic(user, n);
  const u = { ...user };
  switch (u.onboardingStep) {
    case 0:
      u.onboardingStep = 1;
      return {
        user: u,
        reply:
          `hey! i'm ${n[n.me]} from ${n.product} 👋 i've got ${ROLE[n.me]}, ` +
          (["academic", "financial", "social"] as const).filter((p) => p !== n.me).map((p) => `${n[p]} has ${ROLE[p]}`).join(", ") +
          `. quick setup: what's your monthly budget? (just a number, like 600)`,
      };
    case 1: {
      const budget = parseBudget(text);
      if (budget === undefined && (u.onboardingRetries ?? 0) < 1) {
        u.onboardingRetries = (u.onboardingRetries ?? 0) + 1;
        return { user: u, reply: "just the number is perfect — like 600" };
      }
      u.budgetMonthly = budget ?? DEFAULT_BUDGET;
      u.onboardingStep = 2;
      const note = budget === undefined ? `i'll start you at $${DEFAULT_BUDGET}/month, change it anytime. ` : "";
      return { user: u, reply: `${note}got it. what's one thing you're saving for? (e.g. "spring break, $400")` };
    }
    case 2:
      u.savingsGoal = text.trim().slice(0, 120) || "an emergency fund";
      u.canvasLinked = true; // demo: pre-linked account
      u.onboardingStep = "done";
      return {
        user: u,
        reply: `saving for: ${u.savingsGoal}. your Canvas is linked ✅ you're all set — ask "what's due this week?" anytime.`,
      };
    default:
      return { user: u, reply: "" };
  }
}

// Academic asks only about school: one Canvas question, any answer links the demo Canvas (mock data).
function onboardAcademic(user: UserProfile, n: OnboardNames): { reply: string; user: UserProfile } {
  const u = { ...user };
  if (u.onboardingStep === 0) {
    u.onboardingStep = 1;
    return {
      user: u,
      reply:
        `hey! i'm ${n.academic} from ${n.product} 👋 i keep track of your classes, deadlines and grades. ` +
        `to get set up, what's your UNC email or Canvas login? (for the demo, anything works)`,
    };
  }
  u.canvasLinked = true; // demo: whatever they send links the mock Canvas
  u.onboardingStep = "done";
  return {
    user: u,
    reply: `got it, your Canvas is linked ✅ try "what's due this week?" or "how are my grades?"`,
  };
}

export function parseBudget(text: string): number | undefined {
  const m = /\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}
