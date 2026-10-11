// The 1-emoji cap: a text that leaves the process (either transport's send) or enters history (agent.ts respond)
// keeps at most its first emoji. Prompts ask for few emoji; this is the guarantee.
// An emoji is a whole grapheme cluster: a ZWJ sequence (😮‍💨), a skin-toned hand (👍🏽), a flag (🇺🇸) or a keycap
// (1️⃣) is one. Never \p{Emoji} alone: it matches digits and # and would eat "$496.00".

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const CLOSERS = new Set([".", ",", "!", "?", ";", ":", ")"]);

const isEmoji = (g: string): boolean =>
  /\p{Emoji_Presentation}/u.test(g) || (/\p{Extended_Pictographic}/u.test(g) && g.includes("️")) || /^[0-9#*]️?⃣$/.test(g);
const isSpace = (g: string | undefined) => g === " " || g === "\t";
const isBreak = (g: string | undefined) => g !== undefined && /^[\r\n]+$/.test(g);

export function countEmoji(text: string): number {
  let n = 0;
  for (const { segment } of graphemes.segment(text)) if (isEmoji(segment)) n++;
  return n;
}

// Keeps the first emoji and deletes every later one. Only the space next to a deleted emoji is touched: no trim,
// no case change. "x 💸 😭." → "x 💸.", "ok 🙄 fine 😤 go" → "ok 🙄 fine go", "fun🎉stuff🙌" → "fun🎉stuff".
export function capEmoji(text: string): string {
  const g = Array.from(graphemes.segment(text), (s) => s.segment);
  const out: string[] = [];
  let kept = false;
  for (let i = 0; i < g.length; i++) {
    if (!isEmoji(g[i])) {
      out.push(g[i]);
      continue;
    }
    if (!kept) {
      kept = true;
      out.push(g[i]);
      continue;
    }
    // A run of emoji to delete ("🎉😂") is one deletion site.
    let end = i;
    while (end + 1 < g.length && isEmoji(g[end + 1])) end++;
    const prev = out.at(-1);
    const next = g[end + 1];
    if (isSpace(prev) && (next === undefined || isSpace(next) || isBreak(next) || CLOSERS.has(next))) out.pop();
    else if ((prev === undefined || isBreak(prev)) && isSpace(next)) end++;
    i = end;
  }
  return out.join("");
}
