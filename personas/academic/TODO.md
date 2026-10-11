# Academic: Ismail

Branch: `academic/canvas` · commit prefix `[academic]` · only edit `personas/academic/`
Done when: "what's due?" works in Academic's voice over Photon, and the morning "due today" text fires on cue.

Already working (keyless): `MOCK=1 npm run chat -- academic` then type `what's due?`

- [x] `get_due_assignments` over mock/canvas.json (this is THE template tool everyone copies)
- [x] `morning_due` trigger: `npm run trigger -- academic morning_due`
- [x] `watch()` 24h warnings (only polled if WATCH includes `academic`)
- [x] UNC Canvas token generated (expires Oct 12); lives only in Ismail's `.env`
- [x] Live Canvas verified on a UNC account: 5 classes, 108 assignments, 21 announcements (`canvas.ts` now reads courses/assignments/announcements, not the planner)
- [x] Write the voice in `prompt.md` (calm, organized older student). Checked against real Gemini (gemini-3.6-flash) on mock data
- [x] Tune `routerLine` in `index.ts` so Academic speaks up in the group chat when a plan collides with a deadline (plans with a day attached now wake Academic in keyless mode too)
- [x] Academic avatar (Frutiger Aero look): Kerry's `docs/avatars/dean.png` (contact photo) and `dean-icon.png`

## Next (added Sat evening)
- [x] `check_plan_conflicts` tool (`conflicts.ts`): what's due on a plan's day or the day after, plus an exam right after. Feeds the 2 AM three-persona hand-off.
- [x] Academic tests (`academic.test.ts`, run by `npm test`): tools, plan windows, morning_due, watch, keyword routing
- [x] With a Gemini key: "beach trip saturday, bad idea?" → Dean calls `check_plan_conflicts({"day":"saturday"})` and flags the ENGL post + COMP 421. Free tier is 5 requests/min, so space demo messages out.

## Sign-up flow (see docs/SIGNUP-PLAN.md)
- [x] `intro` trigger: Dean texts first after sign-up (`/demo/trigger?persona=academic&name=intro&phone=…`)
- [x] `web/index.html` sign-up page + `web/admin.html` (send intro) → `POST /signup`, `/admin/intro`
- [x] Per-person Canvas: token on Dean's sign-up form, checked with Canvas, saved server-side (`UserProfile.canvasToken`) → env token for the owner → mock

## Fake Canvas + school-only setup (Sat night)
- [x] `mock-canvas.json`: 4 classes with grades, graded assignments/quizzes/exams, this week's assignments + quizzes, exams soon
- [x] `get_grades` tool; `get_due_assignments` takes `kind` (assignment | quiz | exam)
- [x] Dean's first-text setup asks only for Canvas (any answer links the mock) — change in `core/onboarding.ts`, tell Kerry
- [ ] Side item, NOT now: syllabus parser (paste/upload a syllabus → exam dates, grading weights)

## Live Canvas (see docs/SIGNUP-PLAN.md)
- [x] Live snapshot: courses + grades + weights + syllabus, all assignments + scores, announcements; owner-only; cached
- [x] Tools: get_announcements, get_syllabus, grade_impact
- [x] Proactive: morning_due adds tomorrow, weekly_plan (Sun 19:00), exam week notice, new announcements
- [x] `CANVAS_LIVE=1` on the paid Gemini key (owner only)
- [x] Shared context (`Persona.context`) + shared calendar feed (`calendar.ts`); group chat dropped for separate agents
- [ ] LAST: cross-person scheduling (a friend's Sunny proposes → both Deans find a time → Dean asks me with the impact on my day)
