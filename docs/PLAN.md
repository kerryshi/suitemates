> Historical. The group chat (and the per-agent QR as the front door) were superseded on Sun Oct 11 by agents recruiting each other: see core/recruit.ts and #24 (e8bdad8).

# PLAN — hacknc-agents scaffold (first commit)

Author: `architect` (fable), 2026-10-10 15:33 EDT. Rulings folded in (Kerry, 15:31): TypeScript everywhere; repo local only for now.

Ambiguity resolved: the doc puts "router runner" in core/ but says C owns the router. Core owns the dedupe+LLM machinery (`core/router.ts`), C owns the prompt (`personas/social/router-prompt.md`), every persona supplies `routerLine`.

## Goal
A new repo at `/Users/kerryshi/Projects/hacknc-agents` where, with zero API keys, B and C can run `MOCK=1 npm run chat -- financial` and talk to a persona built by copying one example tool; where the group router, onboarding, and proactive trigger run end-to-end in the terminal; and where flipping `TRANSPORT=imessage` with real keys puts the same engine on 3 Photon lines. Kerry's 5 PM checkpoint = this commit + `npm test` green + three chat commands working.

## File tree (W = working, S = stub for owner)
```
package.json            W  type module; deps spectrum-ts ^12.10.1, zod; dev: tsx, typescript, @types/node
tsconfig.json           W  strict, NodeNext, allowImportingTsExtensions, noEmit
.env.example            W  key names only; .gitignore ignores .env, data/, node_modules
README.md               W  what it is · setup · run keyless · add a tool · iMessage · triggers · team rules link
TEAM.md                 W  branches, merge ritual, commit prefix, only-your-folder, never commit .env, 4 AM tag demo
core/types.ts           W  the contract — the only file personas import
core/config.ts          W  zod-parse env; display names + lines per persona; MOCK/TRANSPORT flags
core/personas.ts        W  loads personas/*/index.ts; validates contract; owner-readable errors
core/llm/client.ts      W  LlmClient interface
core/llm/gemini.ts      W  port of hacknc-tab gemini.ts + function calling
core/llm/fake.ts        W  keyless deterministic LLM (router = routerLine keyword match, FAKE_ROUTE override)
core/agent.ts           W  respond(persona, user, history, text) — tool loop max 3 rounds
core/router.ts          W  dedupe window + route(text) → PersonaId[]
core/onboarding.ts      W  3-step state machine (budget, goal, Canvas pre-linked)
core/deliver.ts         W  WatchEvent → one text in the persona's voice → DM via the persona's line
core/scheduler.ts       W  watch() every WATCH_MS; named triggers at MORNING_AT / WEEKLY_AT
core/store.ts           W  JSON file data/state.json: users, history, seen event keys
core/engine.ts          W  handleInbound(Inbound) → Outbound[]; transport-agnostic
core/transport.ts       W  Spectrum lines → Inbound; sendDm; 700 ms pacing
core/http.ts            W  POST /demo/trigger {persona,name,phone}; GET /health
core/main.ts            W  boot
personas/academic/      S  Kerry; one working example tool get_due_assignments over mock/canvas.json — the template
personas/financial/     S  B; one tool get_recent_purchases over mock; watch() returns []
personas/social/        S  C; one tool list_signups over mock; router-prompt.md v0 with {{ROUTER_LINES}}
mock/canvas.json mock/nessie-purchases.json mock/students.json   W
scripts/chat.ts         W  REPL: persona id | group; "as +1555…: text" impersonation; no Spectrum import
scripts/trigger.ts      W  prints the text (MOCK) or POSTs /demo/trigger if SERVER_URL set
scripts/check-gemini.ts W  one call with one tool declaration — proves function calling
tests/router-dedupe.test.ts tests/persona-loader.test.ts tests/onboarding.test.ts   W
```

## Contract (`core/types.ts`)
```ts
export type PersonaId = "academic" | "financial" | "social";
export interface UserProfile { phone: string; name?: string; budgetMonthly?: number; savingsGoal?: string; canvasLinked: boolean; onboardingStep: 0 | 1 | 2 | "done" }
export interface Ctx { user: UserProfile; mock: boolean; now: Date; kv: { get<T>(k: string): T | undefined; set(k: string, v: unknown): void }; log: (msg: string) => void }
export interface ToolParam { type: "string" | "number" | "boolean"; description: string; enum?: string[] }
export interface Tool { name: string; description: string; parameters: { properties: Record<string, ToolParam>; required?: string[] }; run(args: Record<string, unknown>, ctx: Ctx): Promise<string> }
export interface WatchEvent { kind: string; userPhone: string; facts: string; dedupeKey: string }
export interface Persona { id: PersonaId; prompt: string; routerLine: string; tools: Tool[]; watch?(ctx: Ctx): Promise<WatchEvent[]>; triggers?: Record<string, (ctx: Ctx) => Promise<WatchEvent[]>> }
export interface Inbound { persona: PersonaId; kind: "dm" | "group"; sender: string; text?: string; image?: { bytes: Uint8Array; mimeType: string }; handle: string; messageId: string }
export interface Outbound { persona: PersonaId; handle: string; text: string }
```
Proactive = `watch()` and `triggers` both return `WatchEvent[]`; `core/deliver.ts` turns events into texts. One path for scheduled, polled, and demo-fired.

## Data flow (`core/engine.ts`)
- **DM**: transport resolves persona from the line (`space.phone`) or per-persona instance → store.user(sender) → onboarding until done, else agent.respond() → reply on the same handle.
- **Group**: every line delivers the same message. Key = sender + normalized text, 15 s TTL; first arrival opens a batch, each arrival records persona → handle; after GROUP_SETTLE_MS=1500 (or all 3 seen) run the router ONCE → each chosen persona replies via its own handle. If a chosen persona's line never got a copy → send via any handle with a "Name: " prefix and log WARN. Log all messageIds.
- **Proactive**: scheduler or /demo/trigger → persona.triggers[name](ctx) → deliver() → DM via the persona's own line; watch events skip if dedupeKey already seen.
- **Onboarding**: step 0 any text → budget ask; 1 → number (re-ask once, then default 500) → goal ask; 2 → save, "Canvas linked (demo)" → done.

## Transport / env
One project with 3 dedicated lines (route by `space.phone`, `*_LINE`) OR per-persona projects (`<PERSONA>_PROJECT_ID/SECRET`, one `Spectrum()` per persona). Same loop. Terminal never touches Spectrum. Store = JSON file (node:sqlite needs Node ≥22.5; teammates' Node unknown).

## Validation
1. `npm i && npm test` → 3 files pass; fail-first: duplicate tool names → loader throws; 3 group copies → router called once, replies on the chosen persona's handle; same text after the TTL → routed again; onboarding "hi","800","spring break" → budget 800, done; "hi","lots" → re-ask.
2. `MOCK=1 npm run chat -- academic` → "what's due?" → tool ran against mock.
3. `MOCK=1 npm run chat -- group` → "I'm going on the beach trip Saturday" → router line + replies; FAKE_ROUTE=academic,financial,social → three replies.
4. `MOCK=1 npm run trigger -- academic morning_due +15550001` → one printed text.
5. Real key: `npx tsx scripts/check-gemini.ts` shows a functionCall. Photon creds: `npm run dev` logs 3 lines; DM "hi" → budget question on the phone.

## Escalation / open
- Display names default Canopy/Oak/Clover/Breeze (doc's first set), env-configurable. Superseded 2026-10-10: Suitemates (product), Dean, Penny, Sunny.
- Proactive events target DMs only; Social's broadcast to the group needs a group-handle registry — not in v0.

## Risks
1. Whether messageIds match across lines and whether pool lines receive group messages — booth answer; check with `npm run dev` + the three log lines.
2. Gemini function-calling port untested — check-gemini first; FakeLlm keeps everyone moving.
3. Teammate environments (Node <18, Windows) — ask Node versions now.

Cut order if 5 PM slips: types + loader + fake LLM + scripts/chat → tests → Gemini → transport → http trigger → scheduler.
