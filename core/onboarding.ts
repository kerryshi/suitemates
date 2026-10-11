// First-contact setup. Penny: "hi" → monthly budget → one savings goal → Canvas (pre-linked in the demo).
// Dean (academic): "hi" → one Canvas question → linked (any answer, mock data).
// Sunny (social): "hi" → first name → what they're into (saved as interests). No money questions.
// Pure: takes the profile, returns the reply and the updated profile. The engine saves it.
import type { PersonaId, UserProfile } from "./types.ts";
import { INTERESTS } from "./signup.ts";

const ROLE: Record<PersonaId, string> = { academic: "school", financial: "money", social: "plans" };

export interface OnboardNames {
  me: PersonaId; // the persona whose number they texted
  product: string;
  academic: string;
  financial: string;
  social: string;
}

const DEFAULT_BUDGET = 500;

// Each persona's setup numbers its steps its own way, so a user who switches persona mid-setup restarts with the
// new persona's setup (answers already saved stay). The persona that started is kept in onboardingWith.
export function onboard(user: UserProfile, text: string, n: OnboardNames): { reply: string; user: UserProfile } {
  const switched = user.onboardingStep !== 0 && user.onboardingStep !== "done" && user.onboardingWith && user.onboardingWith !== n.me;
  const start = switched ? { ...user, onboardingStep: 0 as const, onboardingRetries: 0 } : user;
  const r = onboardFor(start, text, n);
  if (start.onboardingStep === 0) r.user.onboardingWith = n.me;
  return r;
}

function onboardFor(user: UserProfile, text: string, n: OnboardNames): { reply: string; user: UserProfile } {
  if (n.me === "academic") return onboardAcademic(user, n);
  if (n.me === "social") return onboardSocial(user, text, n);
  const u = { ...user };
  switch (u.onboardingStep) {
    case 0:
      u.onboardingStep = 1;
      return {
        user: u,
        reply:
          `hey, i'm ${n[n.me]} from ${n.product}. i've got ${ROLE[n.me]}, ` +
          (["academic", "financial", "social"] as const).filter((p) => p !== n.me).map((p) => `${n[p]} has ${ROLE[p]}`).join(", ") +
          `. quick setup: what's your monthly budget? (just a number, like 600)`,
      };
    case 1: {
      const budget = parseBudget(text);
      if (budget === undefined && (u.onboardingRetries ?? 0) < 1) {
        u.onboardingRetries = (u.onboardingRetries ?? 0) + 1;
        return { user: u, reply: "let's finish setup first: what's your monthly budget? just the number is perfect, like 600" };
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
        reply: `saving for: ${u.savingsGoal}. your Canvas is linked, you're all set. ask "what's due this week?" anytime.`,
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
        `hey, i'm ${n.academic} from ${n.product}. i keep track of your classes, deadlines and grades. ` +
        `to get set up, what's your UNC email or Canvas login? (for the demo, anything works)`,
    };
  }
  u.canvasLinked = true; // demo: whatever they send links the mock Canvas
  u.onboardingStep = "done";
  return {
    user: u,
    reply: `got it, your Canvas is linked. try "what's due this week?" or "how are my grades?"`,
  };
}

// Social asks only about plans: first name, then what they're into. Interests are saved as the user's own
// words ("soccer, boba"); personas/social maps them onto plans.
function onboardSocial(user: UserProfile, text: string, n: OnboardNames): { reply: string; user: UserProfile } {
  const u = { ...user };
  switch (u.onboardingStep) {
    case 0:
      u.onboardingStep = 1;
      return {
        user: u,
        reply: `hey, i'm ${n.social} from ${n.product}. i'm the plans person: i find people who want to do the same stuff you do. what's your first name?`,
      };
    case 1: {
      const name = parseFirstName(text, [n.academic, n.financial, n.social]);
      if (!name && (u.onboardingRetries ?? 0) < 1) {
        u.onboardingRetries = (u.onboardingRetries ?? 0) + 1;
        return { user: u, reply: "what should i call you? just your first name is perfect" };
      }
      if (name) u.name = name;
      u.onboardingStep = 2;
      return {
        user: u,
        reply: `nice to meet you${name ? `, ${name}` : ""}! what are you into? (sports, food, outdoors, gaming, concerts, parties…)`,
      };
    }
    case 2:
      u.interests = parseInterests(text);
      u.onboardingStep = "done";
      return { user: u, reply: `love it. text me "what's happening this weekend?" and i'll find your people.` };
    default:
      return { user: u, reply: "" };
  }
}

// Words people send instead of a name ("hi", "im good", "lol"): never a name, so the one re-ask can fire.
const NOT_NAMES = new Set(
  ("hi hey hello hiya yo sup ok okay k lol lmao no nah nope yes yeah yep ya sure idk good fine great cool nice down " +
    "here me sorry what what's whats who why how up thanks thank ty hm hmm um uh bro dude wait just").split(" "),
);
const NAME_PREFIX = /^(?:(?:hi|hey|hello|yo)[,!. ]+)?(?:my name is|my name's|name's|it's|its|i'm|im|i am|call me|this is)\s+/i;

// "kerry", "I'm Kerry!", "hey kerry here", "my name is kerry lee", "José" → the first name. A question, a greeting
// or filler ("hi", "im good"), one of our personas' names, a list ("soccer and boba") or a sentence isn't one.
export function parseFirstName(text: string, notNames: string[] = []): string | undefined {
  const t = text.trim();
  if (!t || t.includes("?")) return undefined;
  const explicit = NAME_PREFIX.test(t);
  if (!explicit && (/,|&|\band\b/i.test(t) || t.split(/\s+/).length > 3)) return undefined;
  const skip = new Set([...NOT_NAMES, ...notNames.map((s) => s.toLowerCase())]);
  for (const w of t.replace(NAME_PREFIX, "").split(/[\s,!.]+/)) {
    const word = /^\p{L}[\p{L}\p{M}'-]{0,29}/u.exec(w)?.[0];
    if (!word) continue; // emoji or punctuation
    if (skip.has(word.toLowerCase())) {
      if (explicit) return undefined; // "im good", "i'm down"
      continue; // "hey kerry"
    }
    return word.toLowerCase().replace(/(^|[-'])\p{Ll}/gu, (c) => c.toUpperCase());
  }
  return undefined;
}

// "soccer, boba and hiking" → ["soccer", "boba", "hiking"]: lowercase, ≤10 items of ≤30 chars, one line each.
// "all of the above"/"everything" → every sign-up category; "idk"/"nothing" → none (ranked by popularity instead).
export function parseInterests(text: string): string[] {
  const whole = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (/^(?:all(?: of (?:the above|them|those|it))?|everything|anything|a bit of everything|all the above)$/.test(whole)) return [...INTERESTS];
  if (/^(?:idk|i don'?t know|nothing|not much|nah|no|none|n\/a|not sure|dunno)$/.test(whole)) return [];
  const t = text
    .toLowerCase()
    .replace(/^(?:i'm into|im into|i am into|i like|i love|into|mostly|probably)\s+/, "");
  return [...new Set(t.split(/,|\band\b|&|\/|\+|\n|;/).map((s) => s.replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30).trim()))]
    .filter(Boolean)
    .slice(0, 10);
}

// Only a plain amount counts ("600", "$1,200", "about 1.5k a month"), so a question like
// "can i afford a $60 hoodie?" is never read as the budget.
export function parseBudget(text: string): number | undefined {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!?\s]+$/, "")
    .replace(/^(?:(?:my budget is|budget is|it's|its|like|about|around|maybe|roughly|~)\s*)+/, "")
    .replace(/\s*(?:a month|per month|\/\s*month|\/\s*mo|a mo|monthly)$/, "");
  const m = /^\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?$/.exec(t);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}
