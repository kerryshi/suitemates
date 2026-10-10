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
| `POST /signup`, `/admin/signups`, `/admin/intro` | ❌ |
| Sign-up web page | ❌ |
| Public URL for the page (phones can't reach localhost) | ❌ e.g. `cloudflared tunnel --url http://localhost:3000` |
| Real Canvas | ❌ needs a token; `canvas.ts` planner call unverified. Mock works |

## Test it in 5 minutes (no new code)

1. Photon dashboard → Users → add your own phone.
2. `TRANSPORT=imessage npm run dev`
3. `curl "localhost:3000/demo/trigger?persona=academic&name=intro&phone=%2B1YOURNUMBER"`
4. Your phone gets "Dean: Hey, I'm Dean…". Reply "what's due?".

## Tasks

**Kerry (core, shared files)**
- [ ] `UserProfile`: add `interests?: string[]`, `signupStatus?: "pending" | "invited"`, and later `canvasToken?` (team-wide file)
- [ ] `core/http.ts`: `POST /signup` (validate E.164 phone, save profile as onboarded + pending), `GET /admin/signups`,
      `POST /admin/intro {phone}` (fires each persona's `intro`, marks invited). Protect `/admin/*` with `DEMO_TOKEN`
- [ ] Serve the static page at `GET /` (file in `web/`)
- [ ] Public URL: cloudflared/ngrok tunnel for the demo
- [ ] Gemini billing (or a per-person key) before the group-chat demo
- [ ] Penny `intro` trigger (`personas/financial/watch.ts`)

**Ismail (Academic + sign-up page)**
- [x] Dean `intro` trigger
- [ ] `web/index.html`: sign-up form (name, phone, budget, savings goal, interests, Canvas yes/no) → `POST /signup`;
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
