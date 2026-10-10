# Academic: Ismail

Branch: `academic/canvas` · commit prefix `[academic]` · only edit `personas/academic/`
Done when: "what's due?" works in Academic's voice over Photon, and the morning "due today" text fires on cue.

Already working (keyless): `MOCK=1 npm run chat -- academic` then type `what's due?`

- [x] `get_due_assignments` over mock/canvas.json (this is THE template tool everyone copies)
- [x] `morning_due` trigger: `npm run trigger -- academic morning_due`
- [x] `watch()` 24h warnings (only polled if WATCH includes `academic`)
- [ ] Generate a UNC Canvas token (Canvas → Account → Settings → New Access Token). If UNC blocks it, stay on mock. (Ismail: still to do by hand; on mock for now)
- [ ] With a token: `MOCK=0 CANVAS_TOKEN=... npm run chat -- academic` and confirm `canvas.ts` (UNVERIFIED planner call)
- [x] Write the voice in `prompt.md` (calm, organized older student). Drafted on the fake LLM; re-check tone once a GEMINI_API_KEY is in `.env`
- [x] Tune `routerLine` in `index.ts` so Academic speaks up in the group chat when a plan collides with a deadline (plans with a day attached now wake Academic in keyless mode too)
- [x] Academic avatar (Frutiger Aero look): draft `avatar.svg`, export a PNG if Photon needs one
