# Financial: Kerry

Branch: `fin/nessie` · commit prefix `[financial]` · only edit `personas/financial/`
Done when: a fake purchase posted to Nessie gets a roast within 10 seconds.

Try it keyless: terminal A `npm run dev` then `/skip`; terminal B `npm run buy -- Sheetz 4.29` → Penny roasts it in A within ~5 s.
Demo: set `NESSIE_OWNER_PHONE=<demo phone>` in .env so only the account owner gets purchase roasts (otherwise every onboarded user does).

- [x] `watch()`: first poll baselines (no roast storm), then one roast per new purchase, max 3 per poll; low-balance warning once a day
- [x] `money.ts`: categories, late-night flag, budget left + per-day pace, afford verdict, plan cost match, roast facts (all computed, never by the LLM)
- [x] Tools: `get_recent_purchases` (+ category breakdown), `can_i_afford`, `estimate_plan_cost` (beach trip $45 for the hand-off)
- [x] `weekly_money` trigger with category breakdown
- [x] `npm run buy` (mock queue or real Nessie POST), `npm run setup-nessie` (customer → account → merchant)
- [x] Voice in `prompt.md`: doc voice + Penny's drama; plain + kind on hardship; no investment advice; receipt photos
- [x] Nessie key (nessieisreal.com, GitHub sign-in) → `NESSIE_API_KEY` in .env → `npm run setup-nessie` (verified live, PR #9)
- [x] `MOCK=0 npm run buy -- Sheetz 4` → roast (verified live, PR #9; needed PR #8's `status`). Whole dollars only: Nessie drops cents (ruling 2026-10-10)
- [x] Review fixes: 5 s poll default, baseline at onboarding (a buy right after "hi" is roasted), plain-facts fallback if Gemini fails, no fake times/late-night on date-only Nessie rows, owner-only roasts, 404 empty account
- [ ] **The 10 s goal**: proven with real Nessie + stand-in model (one roast 2 s after the buy, PR #9). Still to do with a GEMINI key → docs/evidence/
- [ ] Receipt photo over iMessage (needs Photon + Gemini)
- [ ] Financial avatar

## Sign-up flow (see docs/SIGNUP-PLAN.md), added by Ismail
- [ ] Core: `POST /signup`, `GET /admin/signups`, `POST /admin/intro`, serve `web/`; `UserProfile.interests` + `signupStatus`
- [ ] Public URL (cloudflared/ngrok) and Gemini billing before the group demo
- [ ] Penny `intro` trigger
