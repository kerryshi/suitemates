# STATUS: hacknc-agents (team build)

Last updated: 2026-10-10 16:10 EDT · Devpost due Sun 10:00 AM · repo github.com/kerryshi/hacknc-agents (private)
Plan of record: `docs/PLAN.md` (architect). Owners: Kerry = core + Financial, Ismail = Academic, Abdallah = Social.

## Where we are
- Scaffold pushed (dea81a3) to main + branches kerry/core, fin/nessie, academic/canvas, social/matching.
- Keyless everything works: `npm run chat -- <persona|group>`, `npm run trigger`, `npm run dev` (/demo/trigger + scheduler).
  Evidence: docs/evidence/chat-keyless-transcript.txt, dev-server-smoke.txt, tests-red-guards-disabled.txt → tests-green.txt (14/14).
- NOT yet run for real: Gemini (needs key → `npm run check-gemini`), Photon iMessage transport, Canvas, Nessie.

## Next (Kerry)
1. Add Ismail + Abdallah as collaborators (repo is private).
2. GEMINI_API_KEY → `npm run check-gemini` (confirms model name + function calling).
3. Photon booth: 3 lines? group chat creation? → fill SPECTRUM_* and *_LINE → `TRANSPORT=imessage npm run dev`, DM "hi".
4. Financial: Nessie key + account, turn on watch() (sketch in personas/financial/watch.ts).

## Open questions
- Names decided 2026-10-10: Suitemates (product), Dean (academic), Penny (financial), Sunny (social); defaults in core/config.ts. `.env.example` still lists the old placeholders (Claude is denied that file) — fix by hand.
- Proactive texts go to DMs only; Social broadcasting into the group needs a group-handle registry (not built).
