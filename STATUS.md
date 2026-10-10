# STATUS: hacknc-agents (team build)

Last updated: 2026-10-10 17:47 EDT · Devpost due Sun 10:00 AM · repo github.com/kerryshi/hacknc-agents (private)
Plan of record: `docs/PLAN.md` (architect). Owners: Kerry = core + Financial, Ismail = Academic, Abdallah = Social.

## Where we are (main = 17da735 + kerry/review-fixes merge)
- All three personas are on main: Social PR #1 (59e47cb) and PR #2 (squash a924976: watch() match + hot-plan texts, review fixes),
  Academic (a00e502: check_plan_conflicts + tests), Financial (0de7113: Penny + Nessie), Penny wakes on "how much is…" (b60fc06).
- Names: Suitemates, Dean (academic), Penny (financial), Sunny (social); defaults in core/config.ts and `.env.example`.
- Avatar provenance for Devpost: `docs/avatars/generation/` (gen_avatars.py + prompts.json), linked from `docs/avatars/README.md`.
- Checks on main: `npm run typecheck` clean, `npm test` 76/76 (now includes `personas/*/*.test.ts`).
- Social watch() verified through the real scheduler, keyless (`WATCH=social WATCH_MS=1000`): one DM about 1 s after a join, no repeats.
- Branches: `academic/canvas` fully merged. `social/matching` has the same social code as main but 7 pre-squash commits:
  Abdallah, start from main before the next PR (`git fetch && git switch -C social/matching origin/main`). kerry/core and fin/nessie deleted.
- Photon (Abdallah, PR #2): the Pro plan is a SHARED POOL, not one number. Each person you add under Users (the allowlist;
  anyone else gets `Target not allowed`) is routed through a pool number that can differ per person (photon-docs:2425, 4823).
  The SDK reports every pooled line as `shared`, so it can't tell personas apart by number and can't create group chats.
  325bd69: with no `*_LINE` set, inbound DMs go to `DEFAULT_PERSONA` (before: always academic); `tests/transport.test.ts`.
- Proactive DMs on the shared pool carry the persona's name (`core/transport.ts` `send`: `Penny: …`; off for a persona with its
  own `*_LINE`/project; inbound DM replies untagged on purpose), `tests/transport.test.ts`, 7227497. On the shared pool leave every
  `*_LINE` empty: a set line both drops that persona's tag and routes all inbound to it.
- Ruling (Kerry, 17:55): the pool doesn't block the demo. Pitch: per-persona numbers + agent-made group chats are a plan-tier
  upgrade (Business = dedicated lines), not a rewrite. Core already routes by line (`core/transport.ts:62`, `:128`): set
  `*_LINE` and it works. Never run on dedicated lines, so say "designed for", not "tested on".
- NOT yet run for real: Gemini (Social join/match has only run keyless, where the fake LLM calls `join_activity({})` and can't join),
  Photon iMessage transport, Canvas, Nessie.

## Demo runbook
- `rm data/social.json` before each rehearsal (chat's `/reset` doesn't touch the sign-up board); `rm data/chat-state.json` to re-onboard.
- Social match texts: scheduler (`WATCH=financial,social`) OR the cue (`npm run trigger -- social match +1<real phone>`), never both.
  The cue sends only the newest match (PR #4, 17da735). Over iMessage, append the real phone: the trigger defaults to the fake demo user.
- Anyone who copied `.env` before 16:26: delete its `*_NAME=` lines (they override the defaults). Check before the Photon demo:
  `grep -nE '^(PRODUCT|ACADEMIC|FINANCIAL|SOCIAL)_NAME=' .env` → nothing or the new names.
- "the saturday one" / "sunday" ask which plan before joining (by design); "soccer today" matches.
- Join/match needs `GEMINI_API_KEY`; keyless only lists plans.

## Next (Kerry)
1. GEMINI_API_KEY → `npm run check-gemini` → a scripted social session (two phones join soccer/boba, find matches, leave).
2. `.env.example` (names done in the kerry/review-fixes merge; Claude's Read is denied `.env.*`): add `NESSIE_OWNER_PHONE=` (unset = every onboarded phone gets
   Penny's purchase and weekly texts, `personas/financial/watch.ts:18`) and `NESSIE_MERCHANT_ID=` (printed by `npm run setup-nessie`).
3. Photon: one shared number, so no `*_LINE` → fill `SPECTRUM_PROJECT_ID/SECRET` + `DEFAULT_PERSONA` → `TRANSPORT=imessage npm run dev`,
   DM "hi". Group chat: add the number by hand (SDK can't create one).
4. Nessie key + account (`npm run setup-nessie`), and set `NESSIE_OWNER_PHONE` in `.env` to your phone before the demo.

## Open questions
- PR #3 closed in favor of PR #4 (same cue fix); Abdallah is porting its join-order test in PR #5 (open).
- Someone who onboards after a plan already hit 3 gets Sunny's hot_plan text right with "you're all set" (onboarding runs
  watch() and delivers). Keep as a demo beat, or suppress?
- Proactive texts go to DMs only; Social broadcasting into the group needs a group-handle registry (not built).
- docs/PLAN.md and older evidence files still say Canopy/Oak/Clover/Breeze (historical; tests use them as fixtures).
