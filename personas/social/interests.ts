// Sign-up interests → which board plans fit them (owner: Abdullah). The web form's categories live in
// core/signup.ts (INTERESTS); plans are free-text names, so each category has keywords matched against a
// plan's id + name. An interest that isn't a category (free text, e.g. "soccer") matches as plain words.
import type { Activity } from "./board.ts";

// Keywords are matched as whole words after plural/hyphen folding ("board-games" = "board game"). Multi-word
// keywords match as a run of words and claim those words first, so "food bank" is volunteering, not food.
// Keep single words unambiguous: "lift", "service", "final", "mario" alone mis-filed real plan names.
const KEYWORDS: Record<string, string[]> = {
  "pickup sports": ["pickup", "soccer", "basketball", "hoops", "frisbee", "ultimate", "volleyball", "tennis", "football", "spikeball", "pickleball", "softball", "baseball", "badminton"],
  gym: ["gym", "lifting", "workout", "climbing", "bouldering", "yoga", "crossfit", "spin class"],
  food: ["boba", "food", "dinner", "lunch", "brunch", "breakfast", "pizza", "coffee", "taco", "sushi", "ramen", "bbq", "dessert", "ice cream"],
  "study groups": ["study", "studying", "homework", "review session", "midterm", "finals week", "final exam", "library", "tutoring"],
  concerts: ["concert", "gig", "festival", "music", "band", "dj"],
  parties: ["party", "parties", "darty", "mixer", "kickback", "tailgate", "formal"],
  outdoors: ["beach", "hike", "hiking", "trail", "park", "camping", "lake", "kayak", "picnic", "outdoor", "outdoors", "biking"],
  gaming: ["gaming", "game night", "video game", "board game", "videogame", "smash", "valorant", "mario kart", "minecraft", "lan party", "chess"],
  art: ["art", "museum", "gallery", "painting", "pottery", "crafts", "sketch", "photography"],
  volunteering: ["volunteer", "volunteering", "cleanup", "food bank", "habitat", "community service"],
};
// Watching a game isn't playing one: these words keep a plan out of "pickup sports" unless it says pickup/play.
const SPECTATOR = ["watch", "vs", "versus", "tickets"];

export const INTEREST_CATEGORIES = Object.keys(KEYWORDS);

const norm = (s: string) => s.trim().toLowerCase();
// Lowercase words with a trailing "s" dropped ("tacos" → "taco", "games" → "game"); hyphens and
// apostrophes split words ("board-game", "mario's" → "mario", "s").
const tokens = (s: string) => (s.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
const keyTokens = new Map(INTEREST_CATEGORIES.flatMap((c) => KEYWORDS[c].map((k): [string, string[]] => [k, tokens(k)])));

export function isCategory(interest: string): boolean {
  return norm(interest) in KEYWORDS;
}

// The sign-up categories a plan belongs to, e.g. the seeded beach trip → ["outdoors"].
export function categoriesOf(a: Activity): string[] {
  const words = tokens(`${a.id} ${a.name}`);
  const claimed = new Set<number>();
  const found = new Set<string>();
  // Phrases first, longest first, each claiming its words.
  const phrases = INTEREST_CATEGORIES.flatMap((c) => KEYWORDS[c].filter((k) => keyTokens.get(k)!.length > 1).map((k) => ({ c, t: keyTokens.get(k)! })));
  phrases.sort((x, y) => y.t.length - x.t.length);
  for (const { c, t } of phrases) {
    for (let i = 0; i + t.length <= words.length; i++) {
      if (t.every((w, j) => words[i + j] === w && !claimed.has(i + j))) {
        t.forEach((_, j) => claimed.add(i + j));
        found.add(c);
      }
    }
  }
  const free = new Set(words.filter((_, i) => !claimed.has(i)));
  for (const c of INTEREST_CATEGORIES) {
    if (KEYWORDS[c].some((k) => keyTokens.get(k)!.length === 1 && free.has(keyTokens.get(k)![0]))) found.add(c);
  }
  if (found.has("pickup sports") && SPECTATOR.some((w) => words.includes(w)) && !words.includes("pickup") && !words.includes("play")) {
    found.delete("pickup sports");
  }
  return INTEREST_CATEGORIES.filter((c) => found.has(c));
}

// Which of the user's interests this plan fits (empty when none, or when the user gave none).
export function fits(a: Activity, interests: string[] | undefined): string[] {
  if (!interests?.length) return [];
  const cats = new Set(categoriesOf(a));
  const words = new Set(tokens(`${a.id} ${a.name}`));
  return [...new Set(interests.map(norm).filter(Boolean))].filter((i) => {
    if (isCategory(i)) return cats.has(i);
    const want = tokens(i);
    return want.length > 0 && want.every((w) => words.has(w));
  });
}

// Best fit first (more matching interests); ties keep the order the caller passed in.
export function rankByFit<T extends { a: Activity }>(items: T[], interests: string[] | undefined): (T & { fit: string[] })[] {
  return items
    .map((x, i) => ({ x, fit: fits(x.a, interests), i }))
    .sort((p, q) => q.fit.length - p.fit.length || p.i - q.i)
    .map(({ x, fit }) => ({ ...x, fit }));
}

export const fitNote = (fit: string[]) => (fit.length ? ` · fits their interests: ${fit.join(", ")}` : "");
