# Sign-up → we text you first

Goal: a student enters their phone number (and a few answers) on a web page, and Dean / Penny / Sunny text them first.
No "text this number to start". Drafted Sat Oct 10 evening by Ismail with Claude Code; owners below.

## How the project fits together today

```
                       ┌──────────────────────── core/ (Kerry) ─────────────────────────┐
 iMessage (Photon) ───>│ transport.ts ─> engine.ts ─┬─ onboarding.ts (budget → goal → done) │
 terminal chat ───────>│                            ├─ router.ts (group: who answers)       │
 GET/POST /demo/trigger│ http.ts ──────> engine.trigger(persona, name, phone)              │
 scheduler (08:00 etc.)│ scheduler.ts ─> watch() / triggers                                │
                       │ store.ts  data/state.json: users, history, kv, dedupe keys       │
                       │ llm/gemini.ts (or fake.ts with no key)                            │
                       └───────────┬──────────────────────┬──────────────────┬────────────┘
                     personas/academic (Ismail)  personas/financial (Kerry)  personas/social (Abdallah)
                     Dean: canvas.ts, tools,     Penny: nessie.ts, money,     Sunny: board.ts, tools,
                     conflicts.ts, watch/intro   watch, weekly_money          watch, match
```

`UserProfile` (`core/types.ts`) is the user record: phone (the id), name, budgetMonthly, savingsGoal, canvasLinked, onboardingStep.
`store.ts` saves it to `data/state.json`. That is our "backend database" for the demo; a handful of users fits in one JSON file.

## Photon facts that shape this (from STATUS.md)

- Our plan (Pro) is a **shared pool with an allowlist**. A phone that isn't added under **Users** in the Photon dashboard gets
  `Target not allowed`. Each added person gets a pool number (it can differ per person). There is no API to add users,
  so adding them is a manual dashboard step.
- The SDK **can** text a person first: `engine.trigger(..., { phone })` → `transport.send({ handle: "dm:<phone>" })`.
  That already works through `/demo/trigger`.
- Proactive texts on the pool are name-tagged (`Dean: …`) because all three personas share one number.

## The flow

1. Student opens the sign-up page (phone browser) → enters name, phone, budget, savings goal, interests, Canvas yes/no.
2. `POST /signup` saves a `UserProfile` with `onboardingStep: "done"` (the form replaces the text onboarding) and marks them
   `pending` (not yet on the Photon allowlist).
3. We see pending sign-ups on `GET /admin/signups` and add each phone under Users in the Photon dashboard.
4. We click "send intro" (`POST /admin/intro {phone}`) → Dean's `intro`, then Penny's and Sunny's, text them first.
5. From then on it's the normal product: they reply, the router and personas take over.

## Ready vs not

| Piece | Status |
|---|---|
| Photon connects with our key; replies over iMessage | ✅ server starts and connects (`TRANSPORT=imessage npm run dev`); no phone test yet |
| Texting a phone first | ✅ `/demo/trigger?persona=academic&name=intro&phone=+1…` (needs the phone on the allowlist) |
| Dean `intro` trigger | ✅ `personas/academic/watch.ts`, tested |
| Penny / Sunny `intro` triggers | ❌ |
| Gemini replies | ✅ key works, but free tier = 5 requests/min (one group message can use ~7). Needs billing for the demo |
| User store | ✅ `data/state.json` via `core/store.ts` |
| `POST /signup`, `/admin/signups`, `/admin/intro` | ✅ `core/http.ts` + `core/signup.ts`, `tests/signup.test.ts` |
| Sign-up web page | ✅ `web/index.html` at `GET /`; admin at `GET /admin` (`?token=` if DEMO_TOKEN) |
| Public URL for the page (phones can't reach localhost) | ❌ e.g. `cloudflared tunnel --url http://localhost:3000` |
| Real Canvas | ❌ needs a token; `canvas.ts` planner call unverified. Mock works |

## Test it in 5 minutes (no new code)

1. Photon dashboard → Users → add your own phone.
2. `TRANSPORT=imessage npm run dev`
3. `curl "localhost:3000/demo/trigger?persona=academic&name=intro&phone=%2B1YOURNUMBER"`
4. Your phone gets "Dean: Hey, I'm Dean…". Reply "what's due?".

## Tasks

**Kerry (core, shared files)**
- [x] `UserProfile`: `interests`, `signupStatus`, `signedUpAt` (done by Ismail + Claude); later `canvasToken?`
- [x] `core/http.ts`: `POST /signup` (validate E.164 phone, save profile as onboarded + pending), `GET /admin/signups`,
      `POST /admin/intro {phone}` (fires each persona's `intro`, marks invited). Protect `/admin/*` with `DEMO_TOKEN`
- [x] Serve the static page at `GET /` (file in `web/`)
- [ ] Public URL: cloudflared/ngrok tunnel for the demo
- [ ] Gemini billing (or a per-person key) before the group-chat demo
- [ ] Penny `intro` trigger (`personas/financial/watch.ts`)

**Ismail (Academic + sign-up page)**
- [x] Dean `intro` trigger
- [x] `web/index.html`: sign-up form (name, phone, budget, savings goal, interests, Canvas yes/no) → `POST /signup`;
      Frutiger Aero look with the avatars from `docs/avatars/`. Plain HTML/JS, no build step
- [ ] Canvas layer prep: `canvas.ts` reads a per-user token (`ctx.user.canvasToken`) when it exists, else env, else mock
- [ ] Canvas token → verify the planner call with `MOCK=0` (without sending real data through free-tier Gemini)

**Abdallah (Social)**
- [ ] Sunny `intro` trigger (`personas/social/watch.ts`): introduce + mention the plan that matches their interests
- [ ] Use `user.interests` from sign-up to suggest/auto-join plans on the board
- [ ] Group chat: create it by hand in iMessage (the SDK can't) and note the steps in STATUS

## Open questions
- Do all three personas intro, or only Dean (three texts from one number in a row)? Suggest: Dean intro now, Penny + Sunny
  when they first have something real to say.
- Switch the runtime model from Gemini to Claude? It needs a `core/llm/claude.ts` client (same `LlmClient` interface) and a key
  someone creates at console.anthropic.com. Faster path for tonight: put billing on the Gemini key.

## Live Canvas (built Sat night, Ismail + Claude Code)

- `personas/academic/canvas.ts` reads one **snapshot per student**: courses (current grade, assignment-group weights,
  syllabus text), every assignment (due date, score, submitted), and the last 14 days of announcements. Live from the Canvas
  API, cached 10 min, saved to `data/canvas/<phone>.json` (gitignored). That file is the per-student dataset.
- Live only for `CANVAS_OWNER_PHONE` (the token's owner) and only with `MOCK=0` or `CANVAS_LIVE=1`. Everyone else gets
  `mock-canvas.json`. Real grades go through Gemini, so `CANVAS_LIVE=1` waits for a paid key (README privacy note).
- Verified against Ismail's UNC account: 5 classes, 108 assignments, 12 announcements in ~6 s.
- Dean's tools: `get_due_assignments` (kind: quiz/exam), `get_grades`, `get_announcements`, `get_syllabus`,
  `grade_impact` (skip / half / ace → estimated class grade), `check_plan_conflicts`.
- Proactive: `morning_due` daily (today + tomorrow), `weekly_plan` Sundays 19:00 (`WEEKLY_PLAN_AT`), and `watch()`:
  24h warnings, a week's notice per exam, new announcements. Needs `academic` in `WATCH`.
- Not now: a "knowledge vector" (embeddings) per student. The snapshot is small and structured, so tools answer exactly;
  embeddings only pay off for long text (syllabi, announcement history) and would send real data to an embedding API.
  Side item with the syllabus parser.

## Next: personas that work together (ideas → tasks)

1. **Shared student context (Kerry, core).** One read-only summary every persona's prompt gets: Dean's next 7 days
   (deadlines, exams), Penny's budget left, Sunny's joined plans. Lets Sunny say "Dean says you have a midterm Monday".
   Shape: `Persona.context?(ctx) → string`, engine adds the others' to each prompt. Academic: return the week's work.
2. **Negotiate in the group chat (Abdullah router + Ismail Dean).** Sunny proposes a plan → router also wakes Dean →
   Dean calls `check_plan_conflicts` + `grade_impact` and offers 2 options with numbers ("go Saturday and finish Project 1
   Friday night: grade stays ~91%" vs "skip it: ~64%"). The student picks; Dean replies with the plan. Mostly prompt +
   router work; the tools exist.
3. **Friends' personas talk to each other (stretch, Kerry).** "Ask Sam's Sunny when he's free this weekend": needs both
   users signed up, a consent flag per user, and an agent-to-agent call that returns only free/busy blocks (never grades
   or money). Demo-able with two mock students.

## QR → add your number → say hey (built Sat night)

1. `GET /` lists the three agents; `GET /join/<agent>` shows that agent's QR (laptop/poster) and its own short form (phone).
2. The form posts `/signup`; `core/photon-users.ts` runs `photon spectrum users add --phone … --first-name …` to put them on the
   Photon Users allowlist, then `users list --json` to find the pool number they text (fallback `POOL_NUMBER`).
3. The page opens Messages with "hey" typed to that number (`sms:<n>&body=hey`).
4. Their first text → `core/engine.ts` sends every persona's intro + contact card in that conversation (status `invited`).
- Needs: `npm i -g @photon-ai/cli`, `photon login` (or `PHOTON_API_TOKEN`), `PHOTON_AUTO_ADD=1`, and a public URL.
  Without the CLI the sign-up stays `pending` and `/admin` → "Send intro" still works after a manual dashboard add.

## Separate agents, shared backend (plan change, Sat night)

- No group chat: each agent has its own QR sign-up (`/join/academic|financial|social`). One profile per phone
  (`UserProfile.agents`, `greeted`, `lastAgent`); each agent greets once, with its contact card.
- Shared Photon number: `Engine.pickPersona` picks among *your* agents: the one you name ("dean, …") → your only one →
  the one with the most keyword hits (`keywordScores`) → the last one you talked to. Replies are name-tagged when you
  have more than one. A dedicated line (`Inbound.lineKnown`) always answers as itself.
- Sharing data: `Persona.context` (prompts) today; next, a shared calendar (see below).

## Shared calendar → Google Calendar (built)
- `Persona.calendar?(ctx) → CalendarItem[]`; `core/calendar.ts` merges the student's agents into one iCalendar feed at
  `/cal/<token>.ics` (token = HMAC of the phone). Google Calendar → Other calendars → From URL subscribes, no OAuth.
- Dean: next 3 weeks of deadlines (30-min block ending at the due time) and exams (75 min). Tool `calendar_link`.
- Next: Sunny's joined plans (Abdullah), Penny's bills/paydays (Kerry). Two-way (reading their own Google Calendar's
  free/busy so agents avoid real conflicts) needs Google OAuth: a stretch goal.
- Needs `PUBLIC_URL` (the tunnel) so the link works off this laptop.
