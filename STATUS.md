# STATUS: hacknc-agents (team build)

Last updated: 2026-10-10 17:31 EDT · Devpost due Sun 10:00 AM · repo github.com/kerryshi/hacknc-agents (private)
Plan of record: `docs/PLAN.md` (architect). Owners: Kerry = core + Financial, Ismail = Academic, Abdallah = Social.

## Where we are (main = 325bd69)
- All three personas are on main: Social PR #1 (59e47cb) and PR #2 (squash a924976: watch() match + hot-plan texts, review fixes),
  Academic (a00e502: check_plan_conflicts + tests), Financial (0de7113: Penny + Nessie), Penny wakes on "how much is…" (b60fc06).
- Names: Suitemates, Dean (academic), Penny (financial), Sunny (social); defaults in core/config.ts.
- Checks on main: `npm run typecheck` clean, `npm test` 73/73 (now includes `personas/*/*.test.ts`).
- Social watch() verified through the real scheduler, keyless (`WATCH=social WATCH_MS=1000`): one DM about 1 s after a join, no repeats.
- Branches: `academic/canvas` fully merged. `social/matching` has the same social code as main but 7 pre-squash commits:
  Abdallah, start from main before the next PR (`git fetch && git switch -C social/matching origin/main`). kerry/core and fin/nessie deleted.
- Photon (Abdallah, PR #2): the Pro plan is ONE shared number, invite-only, no dedicated lines; the SDK can't create group
  chats or say which number a message hit. 325bd69: with no `*_LINE` set, inbound DMs now go to `DEFAULT_PERSONA`
  (before: always academic); `tests/transport.test.ts`.
- NOT yet run for real: Gemini (Social join/match has only run keyless, where the fake LLM calls `join_activity({})` and can't join),
  Photon iMessage transport, Canvas, Nessie.

## Demo runbook
- `rm data/social.json` before each rehearsal (chat's `/reset` doesn't touch the sign-up board); `rm data/chat-state.json` to re-onboard.
- Social match texts: scheduler (`WATCH=financial,social`) OR the cue (`npm run trigger -- social match`), never both. The cue
  re-sends every match the user has (4 joiners = 4 texts, again on every cue).
- "the saturday one" / "sunday" ask which plan before joining (by design); "soccer today" matches.
- Join/match needs `GEMINI_API_KEY`; keyless only lists plans.

## Next (Kerry)
1. GEMINI_API_KEY → `npm run check-gemini` → a scripted social session (two phones join soccer/boba, find matches, leave).
2. `.env.example` lines 15-18 → `PRODUCT_NAME=Suitemates`, `ACADEMIC_NAME=Dean`, `FINANCIAL_NAME=Penny`, `SOCIAL_NAME=Sunny` (by hand: Claude is denied that file).
3. Photon: one shared number, so no `*_LINE` → fill `SPECTRUM_PROJECT_ID/SECRET` + `DEFAULT_PERSONA` → `TRANSPORT=imessage npm run dev`,
   DM "hi". Group chat: add the number by hand (SDK can't create one).
4. Nessie key + account (`npm run setup-nessie`), `NESSIE_OWNER_PHONE`.

## Open questions
- Social cue re-send (`personas/social/watch.ts` `triggers.match` returns every match): fix = newest match only, or keep the runbook rule.
- One shared number: proactive DMs from all three personas arrive from it with no name (`core/engine.ts:146`). Name-tag them
  like the group path does (`core/engine.ts:100`)? Product call.
- Someone who onboards after a plan already hit 3 gets Sunny's hot_plan text right with "you're all set" (onboarding runs
  watch() and delivers). Keep as a demo beat, or suppress?
- Proactive texts go to DMs only; Social broadcasting into the group needs a group-handle registry (not built).
- docs/PLAN.md and older evidence files still say Canopy/Oak/Clover/Breeze (historical; tests use them as fixtures).
