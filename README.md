# hacknc-agents

Three AI texting agents that help UNC students balance school, money, and social life, with no app to download. Each agent has its own iMessage number, and all three share one group chat. HackNC 2026.

| Persona | Folder | Data | Proactive |
|---|---|---|---|
| Academic (Oak) | `personas/academic/` | Canvas | morning "due today", 24h warnings |
| Financial (Clover) | `personas/financial/` | Capital One Nessie | reacts to purchases, weekly check-in |
| Social (Breeze) | `personas/social/` | our sign-up list | "3 people want pickup soccer Sunday" |

Names are placeholders. Change them in `.env` (`PRODUCT_NAME`, `ACADEMIC_NAME`, …).

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
