# Suitemates

Three AI texting agents that help UNC students balance school, money, and social life, with no app to download. Each agent texts from its own iMessage number, and all three share one brain about you: when your life overlaps (a beach trip that costs money and lands on a midterm weekend), the agent you're texting brings the others in, and they text you first. HackNC 2026.

| Persona | Folder | Data | Proactive |
|---|---|---|---|
| Academic (Dean) | `personas/academic/` | Canvas | morning "due today", 24h warnings |
| Financial (Penny) | `personas/financial/` | Capital One Nessie | reacts to purchases, weekly check-in |
| Social (Sunny) | `personas/social/` | our sign-up board + Heel Life (real UNC events) | "3 people want pickup soccer Sunday" |

Watch alerts (Dean's 24h warnings, Sunny's "N people want X") run only for personas listed in `WATCH` (default: `financial`); set `WATCH=academic,financial,social` to turn on all three.

## 60-second setup
Needs Node 20.18+ (`node -v`; 22 LTS recommended).
```bash
git clone https://github.com/kerryshi/suitemates && cd suitemates
npm install
npm test                       # all tests, incl. every persona folder checked against the contract
npm run chat -- financial      # talk to a persona in the terminal. No keys, no phone.
```
In the chat, say `hi` to onboard (or `/skip`), then try `show my recent purchases`. Type `/help` for commands.

**No keys needed.** Without `GEMINI_API_KEY` a deterministic fake LLM still calls the real tools and echoes their results, so the whole flow runs offline. To get real replies, `cp .env.example .env`, add `GEMINI_API_KEY`, and run `npm run check-gemini`.

## Talk to things
```bash
npm run chat                                    # starts on Sunny, the front door
npm run chat -- academic | financial | social   # 1:1 DM with one agent
# the hand-off (needs GEMINI_API_KEY): to Sunny, "I'm going on the beach trip Saturday" → she asks → "yes"
# → Penny prices it and Dean checks your deadlines, each replying under its own name (on iMessage, each from its own number)
npm run trigger -- academic morning_due         # fire a proactive text (prints it)
npm run trigger -- financial weekly_money
```

## Add a tool
1. Open `personas/<persona>/tools.ts` and copy a tool object (`personas/academic/tools.ts` is the annotated template).
2. Change `name` (snake_case), `description` (Gemini reads it to decide when to call), `parameters`, and `run(args, ctx)`.
3. Add it to the `tools` array at the bottom.
4. `npm test` then `npm run chat -- <persona>`.

`run` gets `ctx`: `ctx.user` (phone, budget, goal), `ctx.mock` (read `mock/` when true), `ctx.now`, `ctx.kv` (per-user storage that persists), `ctx.log`. Return a string, and Gemini turns it into a text in the persona's voice.

## The persona contract (`core/types.ts`)
Every `personas/<id>/index.ts` default-exports:
- `id`: the folder name (`academic` | `financial` | `social`); startup fails if it doesn't match
- `prompt`: the persona's voice and rules (`prompt.md`)
- `tools`: functions Gemini can call
- `watch(ctx)`: optional, polled every `WATCH_MS` (default 5 s) for each onboarded user, for the personas listed in `WATCH`; returns events like "new purchase"
- `triggers`: optional named proactive messages (`morning_due`, `weekly_money`), fired by the scheduler or `/demo/trigger`
- `routerLine`: one sentence on what the persona handles (picks who answers a DM on a shared number)

Optional extras: `context` (a line the other agents may see), `calendar` (items for the shared .ics feed), `signup` and `tryIt` (web sign-up and website demo hooks).

Events are just facts (`{ kind, userPhone, facts, dedupeKey }`). Core writes the actual text in the persona's voice. Scheduled runs never send the same `dedupeKey` twice; `npm run trigger`, `/demo/trigger` and the chat's `/trigger` force a re-send so a demo can replay an event.

## How it fits together
```
iMessage (Photon) ─┐                       ┌─ personas/academic   (prompt, tools, watch)
terminal chat ─────┼─> core/engine ─ agent ┼─ personas/financial
/demo/trigger ─────┤      │                └─ personas/social
scheduler ─────────┘      └ recruit: bring_in → consent → add to Photon → that agent texts first
```
- **DM:** on the first text each agent runs its own short setup (Penny: budget → savings goal; Dean: Canvas; Sunny: first name → interests) and sends its contact card, then answers with its tools.
- **Agents recruit each other** (`core/recruit.ts`): every agent gets a core `bring_in` tool. When a message needs another
  agent's area, it asks once ("want penny + dean to check the cost and your deadlines?"). On "yes", core adds the student to
  that agent's own Photon project and the agent texts first from its own number with its hello, contact card and an answer.
  Naming an agent ("ask penny…") is consent; an agent they already have answers in its own thread. If an agent can't be
  added (project full, token expired, `PHOTON_AUTO_ADD` off), it answers through the thread they're already in, name-tagged. There is no group
  chat: a text in an iMessage group is ignored.
- **Proactive:** `watch()` / `triggers` → events → core composes → DM from that persona's number.
- **Shared memory:** every agent gets a core `remember` tool for durable facts the user mentions ("vegetarian, no car").
  All three agents see the user's newest 15 notes in every prompt, so reading them costs no Gemini call; saving rides along
  with the agent's other tool calls. No exact balances or grades. Notes live in the state file (`data/state.json` for the server,
  `data/chat-state.json` for `npm run chat`); in the terminal chat `/notes` lists them and `/reset` clears them (`core/memory.ts`). Personas need no changes; just don't name a tool `remember`.

**Numbers and plan tiers.** Each agent is its own Photon project (`<AGENT>_PROJECT_ID/SECRET`, plus `<AGENT>_PHOTON_API_TOKEN`
for adding people), so each one reaches a student from its own pool number. A Pro project allows 100 people, a Free one 10 (set `<AGENT>_PHOTON_CAP=10` for a Free project; the code assumes 100).
Sunny is the front door. `npm run check-photon` checks all three before a demo. Adding people uses the Photon CLI (`npm i -g @photon-ai/cli`, `photon login`)
and needs `PHOTON_AUTO_ADD=1`; with it off, a brought-in agent answers name-tagged in the thread the student is already in. With only one shared project configured,
everything still works: the agents share that number and say who's talking. Dedicated lines (Business) are configuration
(`*_LINE`), not code, and haven't been run.

## Run it live on iMessage
```bash
npm run dev                          # terminal chat with Sunny + :3000/demo/trigger + scheduler
npm run check-photon                 # each agent's Photon project + token answers (run before the demo)
TRANSPORT=imessage npm run dev       # Photon: <AGENT>_PROJECT_ID/SECRET per agent, or one shared SPECTRUM_PROJECT_ID/SECRET
curl -X POST localhost:3000/demo/trigger -H 'content-type: application/json' \
  -d '{"persona":"academic","name":"morning_due","phone":"+1919..."}'
# with DEMO_TOKEN set, add "token":"..." to the JSON; without it only local requests are accepted
SERVER_URL=http://localhost:3000 npm run trigger -- social match +1919...   # sends through the server like the curl; without SERVER_URL it only prints
```

## How we built it
Built at HackNC 2026 by Kerry Shi (@kerryshi), Ismail (@ismail-gasmi) and Abdullah (@abhassan1).

**AI tools we used**, disclosed under MLH's AI policy:
- **Claude Code** (Anthropic's AI coding agent) generated the initial scaffold on Sat Oct 10 from our team's project doc. That scaffold was `core/` (engine, group router, onboarding, Gemini client, Photon transport, scheduler, demo trigger), the starter tool in each persona folder, the mock data, the tests, and this README. The design plan in `docs/PLAN.md` was also drafted with Claude. We made the product, scope, and ownership decisions and reviewed and ran everything. Claude Code also helped with code and debugging during the event.
- **Gemini API** (Flash) is the runtime model. It powers every agent's replies, the hand-offs between agents, and receipt-photo reading.
- The Photon transport and Gemini client in `core/` were adapted from Kerry's solo prototype (`hacknc-tab`, first commit Sat Oct 10, 12:40 PM, after hacking began at 11:30 AM).
- **Financial persona** (`personas/financial/`): Kerry made the design calls (voice, what gets roasted, no money transfers); Claude Code wrote the code: the purchase watcher, money math, tools, prompt, demo scripts and tests. Claude subagents also planned and reviewed it.
- **Academic persona** (`personas/academic/`): Ismail directed the work and reviewed it: voice and when Dean speaks up. Claude Code wrote the prompt voice (`prompt.md`), the group-chat `routerLine` and tool description tuning, the `check_plan_conflicts` tool and the Academic tests, the live Canvas layer (`canvas.ts`: grades, announcements, syllabus, `grade_impact`, weekly plan and exam alerts) and the mock Canvas data. Dean's avatar is Kerry's (see `docs/avatars/`).
- **Sign-up flow** (`web/`, `core/signup.ts`, `core/http.ts` routes): Ismail decided the flow (sign up on the web, we add them in Photon, Dean texts first); Claude Code wrote the pages, endpoints, the QR page, the Photon CLI auto-add (`core/photon-users.ts`), the persona contact cards, the per-agent landing/join pages, the shared calendar feed (`core/calendar.ts`, `personas/academic/calendar.ts`) and the sign-up/agents/calendar tests.
- **Personalities and Penny's habits** (all three `prompt.md` voices, `personas/financial/demo.ts`, `history.ts`, `patterns.ts`, `insights.ts`): Ismail decided the personalities and the habit-tracking idea (spot repeat spending, ask what it is, show the cheaper swap and the savings); Claude Code wrote the prompts, the fake six-week spending history, the pattern and trend math, the tools, the proactive texts and their tests. Ismail's first website was later replaced by the current Frutiger Aero landing (`web/`), which Kerry redesigned with Claude Code.
- **Social persona** (`personas/social/`): Abdullah directed the work and made the calls: what counts as a match, when Sunny texts first, and how we set up Photon. Claude Code wrote the code: the shared sign-up board, the join/leave/start/match tools, the `watch()` match texts, the tool rules in `prompt.md`, the `routerLine` tuning and the tests. Claude subagents reviewed it, and Kerry reviewed it before merging.
- **Agents recruit each other** (`core/recruit.ts`, per-agent Photon projects, `npm run check-photon`): Kerry made the product calls (separate numbers, one shared brain, consent before an agent texts, Sunny as the front door, no group chat); Claude Code planned it (a Fable architect subagent), wrote the code and tests, and a separate Claude reviewer checked it before merging. Abdullah's PR #22 (per-agent sign-up) is its base.
- **Avatars** (`docs/avatars/`): AI-generated during HackNC (Sat Oct 10) with Z-Image-Turbo (open-weights, Apache-2.0) running locally on Kerry's GPU. Claude Code wrote the prompts from the persona descriptions, and Kerry picked the final images. Exact prompts and settings are in `docs/avatars/README.md`.

## Data, privacy and Gemini's terms
- **Demo data is fake by default.** Mock Canvas courses (`personas/academic/mock-canvas.json`), Nessie purchases (`mock/` or Capital One's Nessie sandbox) and students are made up; no real student or bank data is needed to run or demo this. Two parts can be real: a student can connect their own Canvas with a personal access token (kept server-side), and Sunny lists real public UNC events from Heel Life.
- **Gemini free tier:** Google may use free-tier prompts and responses to improve its products, and humans may review them. Don't send real personal data (a real Canvas account's assignments, real receipts) through a free-tier key; use mock data or a paid/credit-backed key.
- **Users must be 18+** under the Gemini API terms.
- **Not financial advice.** Penny is a spending mentor: `can_i_afford` verdicts are computed in code from the student's own budget, it never gives investment advice, and it never moves money or makes decisions for anyone.

## Layout
```
core/        engine, recruit (agent hand-offs), agent loop, Gemini, Photon transport, sign-up, scheduler, /demo/trigger, store, memory
personas/    one folder per persona: prompt.md, tools, watch(), tests
mock/        fake Nessie purchases, students + sign-ups (dates are relative to today); Dean's fake Canvas is personas/academic/mock-canvas.json
scripts/     chat, trigger, check-gemini, check-photon, tunnel, watchdog
tests/       contract loader, onboarding, sign-up, recruiting, own numbers
web/         landing page, per-agent join pages, admin
deploy/      Vercel static deploy of web/
ops/         watchdog for the live demo server
docs/        PLAN.md (original scaffold plan, historical), SIGNUP-PLAN.md, evidence/, avatars/ (persona images + prompts)
```
