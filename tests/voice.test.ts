// The 1-emoji cap (core/voice.ts): every outbound text keeps at most its first emoji. "Emoji" means a whole
// grapheme cluster: a ZWJ sequence, a skin-toned hand, a flag or a keycap is one; digits, #, *, ©, ™ are none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capEmoji, countEmoji } from "../core/voice.ts";

const seen: string[] = []; // every input below, for the idempotence check
const cap = (s: string) => (seen.push(s), capEmoji(s));

test("no emoji: text is byte-identical (digits, $, #, *, urls and phone numbers are not emoji)", () => {
  for (const s of [
    "you have $496.00 left for the next 22 days",
    "text 919-555-0123 or +19195550001",
    "https://example.com/x?a=1#frag",
    "*sigh* a second coffee. on a tuesday.",
    "#1 pick, 2:30 pm",
    "",
  ]) {
    assert.equal(cap(s), s);
    assert.equal(countEmoji(s), 0, s);
  }
});

test("one emoji: unchanged wherever it sits", () => {
  for (const s of ["that's $45 of your $300 😭", "⏰ PS6 due at 5", "ok 🙄 fine"]) assert.equal(cap(s), s);
});

test("adjacent pair with a VS16 emoji: the first (🏖️, kept whole) stays, the second goes, the words stay apart", () => {
  const out = cap("beach trip should run about $45, which is only 9% of the $496 left in your budget this month 🏖️💸 want dean to check?");
  assert.equal(out, "beach trip should run about $45, which is only 9% of the $496 left in your budget this month 🏖️ want dean to check?");
  assert.ok(out.includes("\u{1F3D6}️"));
});

test("a second emoji at the end goes with its space (no trailing space)", () => {
  assert.equal(cap("hey kerry! 🌞 what's the move? 😂"), "hey kerry! 🌞 what's the move?");
});

test("a ZWJ sequence counts as one emoji: kept whole when first", () => {
  const out = cap("a second coffee 😮‍💨 on a tuesday 💀");
  assert.equal(out, "a second coffee 😮‍💨 on a tuesday");
  assert.ok(out.includes("\u{1F62E}‍\u{1F4A8}"));
});

test("a ZWJ sequence counts as one emoji: dropped whole when not first", () => {
  const out = cap("💀 a second coffee 😮‍💨");
  assert.equal(out, "💀 a second coffee");
  assert.ok(!out.includes("‍"));
  assert.ok(!out.includes("\u{1F4A8}"));
});

test("skin tones stay with their hand", () => {
  assert.equal(cap("👍🏽 nice 🙌🏽"), "👍🏽 nice");
  const out = cap("nice 🙌🏽 👍🏽");
  assert.equal(out, "nice 🙌🏽");
  assert.equal([...out.matchAll(/\u{1F3FD}/gu)].length, 1, "no stray modifier");
});

test("a flag is one emoji", () => {
  assert.equal(cap("🇺🇸 go heels 🏀"), "🇺🇸 go heels");
  const out = cap("go heels 🏀 🇺🇸");
  assert.equal(out, "go heels 🏀");
  assert.ok(!/\p{Regional_Indicator}/u.test(out));
});

test("keycaps are one emoji; a bare # or digit is none", () => {
  assert.equal(cap("you're #1️⃣ 🏆"), "you're #1️⃣");
  assert.equal(cap("#1 pick 🏆 😤"), "#1 pick 🏆");
  const out = cap("🏆 #️⃣");
  assert.equal(out, "🏆");
  assert.ok(!out.includes("⃣"));
  assert.equal(cap("🏆 1️⃣"), "🏆");
});

test("a VS16 heart is an emoji", () => {
  assert.equal(cap("love that ♥️ 💸"), "love that ♥️");
  assert.equal(cap("💸 ♥️."), "💸.");
});

test("punctuation and spacing are tidied only around what was removed", () => {
  assert.equal(cap("we move 💸 😭."), "we move 💸.");
  assert.equal(cap("ok 🙄 fine 😤 go"), "ok 🙄 fine go");
  assert.equal(cap("done 👀, anyway 💸"), "done 👀, anyway");
});

test("emoji glued to words: removed without gluing the words together", () => {
  assert.equal(cap("fun🎉stuff🙌"), "fun🎉stuff");
  assert.equal(cap("a 🌞 b🙌 c"), "a 🌞 b c");
});

test("three or more: only the first survives", () => {
  assert.equal(
    cap("hey kerry! i'm sunny 🌞 omar, priya, and sam are hitting hooker fields for pickup soccer sunday 4 pm—you down to join? ⚽"),
    "hey kerry! i'm sunny 🌞 omar, priya, and sam are hitting hooker fields for pickup soccer sunday 4 pm—you down to join?",
  );
  assert.equal(cap("a 🌞 b 🎉 c 😂 d"), "a 🌞 b c d");
  assert.equal(cap("a 🌞 🎉 😂 b"), "a 🌞 b");
});

test("idempotent: capping a capped text changes nothing", () => {
  assert.ok(seen.length > 20, "runs after the cases above");
  for (const s of seen) assert.equal(capEmoji(capEmoji(s)), capEmoji(s), s);
});

test("countEmoji counts grapheme clusters", () => {
  assert.equal(countEmoji("😮‍💨🇺🇸👍🏽1️⃣"), 4);
  assert.equal(countEmoji("#1 at 2:30"), 0);
  assert.equal(countEmoji("© ® ™ ★ → *sigh*"), 0, "©, ®, ™ and plain symbols render as text");
});

// iMessage on iOS draws a bare ❤ (U+2764, no VS16) as a colour emoji, so the hard cap counts it: any pictograph that
// is an emoji character counts with or without a variation selector. Only ©, ® and ™ are text.
test("bare pictographs without VS16 (❤ ☀ ✈ ⚠ ☺ ✌ ♥) count toward the cap", () => {
  assert.equal(countEmoji("love that ❤ 🔥"), 2);
  assert.equal(cap("love that ❤ 🔥"), "love that ❤");
  assert.equal(cap("🔥 love that ❤"), "🔥 love that");
  assert.equal(countEmoji("❤ ☀ ✈ ⚠ ☺ ✌ ♥"), 7);
  assert.equal(cap("beach ☀ then boba ✈"), "beach ☀ then boba");
  assert.equal(cap("⚽︎ 🌞"), "⚽︎", "a text-style selector (VS15) does not hide an emoji from the cap");
  assert.equal(cap("© 2026 ™ 🌞 ok"), "© 2026 ™ 🌞 ok");
});
