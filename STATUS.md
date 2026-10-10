# STATUS: hacknc-agents (team build)

Last updated: 2026-10-10 18:45 EDT · Devpost due Sun 10:00 AM · repo github.com/kerryshi/hacknc-agents (private)
Plan of record: `docs/PLAN.md` (architect). Owners: Kerry = core + Financial, Ismail = Academic, Abdullah = Social.

## Where we are (main = a599349)
- All three personas are on main: Social PR #1 (59e47cb) and PR #2 (squash a924976: watch() match + hot-plan texts, review fixes),
  Academic (a00e502: check_plan_conflicts + tests), Financial (0de7113: Penny + Nessie), Penny wakes on "how much is…" (b60fc06).
- Names: Suitemates, Dean (academic), Penny (financial), Sunny (social); defaults in core/config.ts and `.env.example`.
- Avatar provenance for Devpost: `docs/avatars/generation/` (gen_avatars.py + prompts.json), linked from `docs/avatars/README.md`.
- Checks on main: `npm run typecheck` clean, `npm test` 87/87 (now includes `personas/*/*.test.ts`).
- Social watch() verified through the real scheduler, keyless (`WATCH=social WATCH_MS=1000`): one DM about 1 s after a join, no repeats.
- PR #5 squash-merged (80d78eb: cue runbook, join-order test, leave and name-cut wording). `academic/canvas` fully merged.
  `social/matching` has the same social code as main but 6 pre-squash commits:
  Abdullah, start from main before the next PR (`git fetch && git switch -C social/matching origin/main`). kerry/core and fin/nessie deleted.
- Photon (Abdullah, PR #2): the Pro plan is a SHARED POOL, not one number. Each person you add under Users (the allowlist;
  anyone else gets `Target not allowed`) is routed through a pool number that can differ per person (photon-docs:2425, 4823).
  The SDK reports every pooled line as `shared`, so it can't tell personas apart by number and can't create group chats.
  325bd69: with no `*_LINE` set, inbound DMs go to `DEFAULT_PERSONA` (before: always academic); `tests/transport.test.ts`.
- Proactive DMs on the shared pool carry the persona's name (`core/transport.ts` `send`: `Penny: …`; off for a persona with its
  own `*_LINE`/project; inbound DM replies untagged on purpose), `tests/transport.test.ts`, 7227497. On the shared pool leave every
  `*_LINE` empty: a set line both drops that persona's tag and routes all inbound to it.
- Ruling (Kerry, 17:55): the pool doesn't block the demo. Pitch: per-persona numbers + agent-made group chats are a plan-tier
  upgrade (Business = dedicated lines), not a rewrite. Core already routes by line (`core/transport.ts:62`, `:128`): set
  `*_LINE` and it works. Never run on dedicated lines, so say "designed for", not "tested on".
- Ruling 2026-10-10 (Kerry): DMs → Penny (DEFAULT_PERSONA=financial); Dean and Sunny answer in the iMessage group via the router.
- iMessage works one-to-one on the Pro pool (17:36–17:39, `docs/evidence/imessage-roundtrip.txt`): Kerry's texts reached the
  server, went to Penny, and onboarding completed; Kerry confirmed Penny's first reply arrived. The fix was adding the phone
  under Photon Users (otherwise `Target not allowed`). That run was LLM=fake/MOCK=1, and the roast after onboarding was not
  confirmed on the phone. Group chat over iMessage is untested.
- Nessie verified live 18:36 (PR #9, `docs/evidence/nessie-live-run.txt`): `npm run buy` → GET 200 → one Penny event 2 s later,
  console transport, FAKE_LLM=1. Needed PR #8: a purchase POSTed without `status` made every later GET 400, and Nessie has no
  DELETE route, so the first sandbox account is abandoned (`data/nessie.json.poisoned`). Nessie drops cents (open question).
- Gemini: Kerry's key is valid (first call returned a correct functionCall) but every call after that gets 429 quota exceeded on
  gemini-3.6-flash and 3.5-flash, even after 65 s idle. A key- or project-level limit; Kerry is getting a better key. No Gemini calls until then.
- NOT yet run for real: Gemini (Social join/match has only run keyless, where the fake LLM calls `join_activity({})` and can't join),
  iMessage group chat, Canvas.

## Demo runbook
- `rm data/social.json` before each rehearsal (chat's `/reset` doesn't touch the sign-up board); `rm data/chat-state.json` to re-onboard.
- Social match texts: scheduler (`WATCH=financial,social`) OR the cue, never both. Cue, with `npm run dev` up:
  `SERVER_URL=http://localhost:3000 npm run trigger -- social match +1<real phone>`. Without `SERVER_URL` the trigger runs in-process
  against `data/chat-state.json` and only prints (it says so on stderr when you pass a phone). The cue sends only the newest match (PR #4, 17da735);
  append the real phone, or it goes to the fake demo user.
- Anyone who copied `.env` before 16:26: delete its `*_NAME=` lines (they override the defaults). Check before the Photon demo:
  `grep -nE '^(PRODUCT|ACADEMIC|FINANCIAL|SOCIAL)_NAME=' .env` → nothing or the new names.
- "the saturday one" / "sunday" ask which plan before joining (by design); "soccer today" matches.
- Join/match needs `GEMINI_API_KEY`; keyless only lists plans.

## Next (Kerry)
1. A Gemini key with quota (the current one 429s) → `npm run check-gemini` → a scripted social session (two phones join soccer/boba, find matches, leave).
2. `.env.example` (names done in the kerry/review-fixes merge; Claude's Read is denied `.env.*`): add `NESSIE_OWNER_PHONE=` (unset = every onboarded phone gets
   Penny's purchase and weekly texts, `personas/financial/watch.ts:18`) and `NESSIE_MERCHANT_ID=` (printed by `npm run setup-nessie`).
3. Photon one-to-one works (see "Where we are"). For every tester, add their phone under Photon Users first. `.env`:
   `SPECTRUM_PROJECT_ID/SECRET`, `DEFAULT_PERSONA=financial`, no `*_LINE` → `TRANSPORT=imessage npm run dev`.
4. Nessie: key and sandbox account are set up (`data/nessie.json`). Still to do: set `NESSIE_OWNER_PHONE` in `.env` to your phone before the demo.
5. iMessage group: create it by hand (your phone, the pool number, and teammates already on the Users allowlist), send
   "I'm going on the beach trip Saturday", expect replies from Sunny plus Dean and/or Penny. Untested on the Pro pool; open risk:
   whether a group thread reaches us when members are routed through different pool numbers (Photon bullet above).

## Open questions
- Nessie drops cents: `buy -- Sheetz 4.29` is stored as $4 and the $412.55 seed balance reads back as $412.00, so Penny says
  "Sheetz $4.00". Demo with whole-dollar buys (`npm run buy -- Sheetz 4`), or change how amounts are posted? Product call.
- `getPurchases` tolerates only 404 (`personas/financial/nessie.ts:58-61`): any other Nessie error logs on every poll. Follow-up.
- Someone who onboards after a plan already hit 3 gets Sunny's hot_plan text right with "you're all set" (onboarding runs
  watch() and delivers). Keep as a demo beat, or suppress?
- Proactive texts go to DMs only; Social broadcasting into the group needs a group-handle registry (not built).
- docs/PLAN.md and older evidence files still say Canopy/Oak/Clover/Breeze (historical; tests use them as fixtures).
