# hacknc-agents

Three AI texting agents that help UNC students balance school, money, and social life, with no app to download. Each agent has its own iMessage number, and all three share one group chat. HackNC 2026.

| Persona | Folder | Data | Proactive |
|---|---|---|---|
| Academic (Dean) | `personas/academic/` | Canvas | morning "due today", 24h warnings |
| Financial (Penny) | `personas/financial/` | Capital One Nessie | reacts to purchases, weekly check-in |
| Social (Sunny) | `personas/social/` | our sign-up list | "3 people want pickup soccer Sunday" |

Names default to Suitemates (product), Dean, Penny and Sunny. Change them in `.env` (`PRODUCT_NAME`, `ACADEMIC_NAME`, …).

## 60-second setup
Needs Node 18.19+ (`node -v`).
```bash
git clone https://github.com/kerryshi/hacknc-agents && cd hacknc-agents
npm install
npm test                       # 14 tests, checks every persona folder against the contract
npm run chat -- financial      # talk to a persona in the terminal. No keys, no phone.
```
In the chat, say `hi` to onboard (or `/skip`), then try `show my recent purchases`. Type `/help` for commands.

**No keys needed.** Without `GEMINI_API_KEY` a deterministic fake LLM calls your tools and echoes the results, so you can build tools before anything else is live. To get real replies, `cp .env.example .env`, add `GEMINI_API_KEY`, and run `npm run check-gemini`.

## Talk to things
```bash
npm run chat -- academic | financial | social   # 1:1 DM with one persona
npm run chat -- group                           # the group chat: router picks who answers
FAKE_ROUTE=social,financial,academic npm run chat -- group   # force the 3-persona hand-off
npm run trigger -- academic morning_due         # fire a proactive text (prints it)
npm run trigger -- financial weekly_money
```

## Add a tool (the thing you'll do most)
1. Open your `personas/<you>/tools.ts`. Copy the example tool object (the template is `personas/academic/tools.ts`).
2. Change `name` (snake_case), `description` (Gemini reads it to decide when to call), `parameters`, and `run(args, ctx)`.
3. Add it to the `tools` array at the bottom.
4. `npm test` then `npm run chat -- <you>`.

`run` gets `ctx`: `ctx.user` (phone, budget, goal), `ctx.mock` (read `mock/` when true), `ctx.now`, `ctx.kv` (per-user storage that persists), `ctx.log`. Return a string, and Gemini turns it into a text in your voice.

## The persona contract (`core/types.ts`)
Every `personas/<id>/index.ts` default-exports:
- `prompt`: your voice and rules (`prompt.md`)
- `tools`: functions Gemini can call
- `watch(ctx)`: optional, polled every 10 s (personas listed in `WATCH`); returns events like "new purchase"
- `triggers`: optional named proactive messages (`morning_due`, `weekly_money`), fired by the scheduler or `/demo/trigger`
- `routerLine`: one sentence telling the group router when you should speak

Events are just facts (`{ kind, userPhone, facts, dedupeKey }`). Core writes the actual text in your voice and never sends the same `dedupeKey` twice.

## How it fits together
```
iMessage (Photon) ─┐                       ┌─ personas/academic   (prompt, tools, watch)
terminal chat ─────┼─> core/engine ─ agent ┼─ personas/financial
/demo/trigger ─────┤      │ group: dedupe  └─ personas/social     (+ router-prompt.md)
scheduler ─────────┘      └ router (Gemini JSON, keyword fallback)
```
- **DM:** onboarding (budget → goal → Canvas) until done, then the persona answers with its tools.
- **Group chat:** each persona's number receives its own copy of every message. Core treats the copies as one message, runs the router once, and each chosen persona replies from its own number.
- **Proactive:** `watch()` / `triggers` → events → core composes → DM from that persona's number.

## Run the real thing (Kerry)
```bash
npm run dev                          # terminal group chat + :3000/demo/trigger + scheduler
TRANSPORT=imessage npm run dev       # the three Photon lines (needs SPECTRUM_* + *_LINE in .env)
curl -X POST localhost:3000/demo/trigger -H 'content-type: application/json' \
  -d '{"persona":"academic","name":"morning_due","phone":"+1919..."}'
```

## How we built it
Built at HackNC 2026 by Kerry Shi (@kerryshi), Ismail (@ismail-gasmi) and Abdallah (@abhassan1).

**AI tools we used**, disclosed under MLH's AI policy:
- **Claude Code** (Anthropic's AI coding agent) generated the initial scaffold on Sat Oct 10 from our team's project doc. That scaffold was `core/` (engine, group router, onboarding, Gemini client, Photon transport, scheduler, demo trigger), the starter tool in each persona folder, the mock data, the tests, and this README. The design plan in `docs/PLAN.md` was also drafted with Claude. We made the product, scope, and ownership decisions and reviewed and ran everything. Claude Code also helped with code and debugging during the event.
- **Gemini API** (Flash) is the runtime model. It powers every persona's replies, the group-chat router, and receipt-photo reading.
- The Photon transport and Gemini client in `core/` were adapted from Kerry's solo prototype (`hacknc-tab`, first commit Sat Oct 10, 12:40 PM, after hacking began at 11:30 AM).
- **Financial persona** (`personas/financial/`): Kerry made the design calls (voice, what gets roasted, no money transfers); Claude Code wrote the code: the purchase watcher, money math, tools, prompt, demo scripts and tests. Claude subagents also planned and reviewed it.
- **Academic persona** (`personas/academic/`): Ismail directed the work and reviewed it: voice, when Dean speaks up, the look. Claude Code wrote the prompt voice (`prompt.md`), the group-chat `routerLine` and tool description tuning, the `check_plan_conflicts` tool and the Academic tests, and drew the avatar (`avatar.svg`, hand-written SVG, not an image model).
- **Everyone:** list any other AI tool you use here before merging (ChatGPT, Copilot, Cursor, an image generator for the avatars).
- **Avatars** (`docs/avatars/`): AI-generated at the event with Z-Image-Turbo (open-weights, Apache-2.0) running locally on Kerry's GPU. Claude Code wrote the prompts from the persona descriptions, and Kerry picked the final images. Exact prompts and settings are in `docs/avatars/README.md`.

**Who owns what** (update with what each person actually built before submitting):
- Kerry: shared layer (`core/`) and the Financial persona (Nessie)
- Ismail: the Academic persona (Canvas)
- Abdallah: the Social persona and the group-chat router prompt

## Data, privacy and Gemini's terms
- **Demo data is fake.** Canvas courses, Nessie purchases and students come from `mock/` or Capital One's mock bank. No real student or bank data is needed to run or demo this.
- **Gemini free tier:** Google may use free-tier prompts and responses to improve its products, and humans may review them. Don't send real personal data (a real Canvas account's assignments, real receipts) through a free-tier key; use mock data or a paid/credit-backed key.
- **Users must be 18+** under the Gemini API terms.
- **Not financial advice.** Penny is a spending mentor: `can_i_afford` verdicts are computed in code from the student's own budget, it never gives investment advice, and it never moves money or makes decisions for anyone.

## Layout
```
core/        Kerry: engine, router runner, agent loop, Gemini, Photon transport, scheduler, /demo/trigger, store
personas/    one folder per persona, owned by one person (see TEAM.md)
mock/        fake Canvas courses, Nessie purchases, students + sign-ups (dates are relative to today)
scripts/     chat, trigger, check-gemini
tests/       contract loader, group dedupe + router, onboarding
docs/        PLAN.md (design), evidence/
```

Team rules, branches and checkpoints: [TEAM.md](TEAM.md).
