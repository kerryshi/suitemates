# Academic: Ismail

Branch: `academic/canvas` · commit prefix `[academic]` · only edit `personas/academic/`
Done when: "what's due?" works in Academic's voice over Photon, and the morning "due today" text fires on cue.

Already working (keyless): `MOCK=1 npm run chat -- academic` then type `what's due?`

- [x] `get_due_assignments` over mock/canvas.json (this is THE template tool everyone copies)
- [x] `morning_due` trigger: `npm run trigger -- academic morning_due`
- [x] `watch()` 24h warnings (only polled if WATCH includes `academic`)
- [ ] Generate a UNC Canvas token (Canvas → Account → Settings → New Access Token). If UNC blocks it, stay on mock.
- [ ] With a token: `MOCK=0 CANVAS_TOKEN=... npm run chat -- academic` and confirm `canvas.ts` (UNVERIFIED planner call)
- [ ] Write the voice in `prompt.md` against real Gemini (calm, organized older student)
- [ ] Tune `routerLine` in `index.ts` so Academic speaks up in the group chat when a plan collides with a deadline
- [ ] Academic avatar (Frutiger Aero look)
