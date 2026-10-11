# Social: Abdullah

Branch: `social/matching` · commit prefix `[social]` · only edit `personas/social/`
Done when: two phones get matched and introduced in a group chat, and the router picks the right persona(s).

Already working (keyless): `MOCK=1 npm run chat -- social` then type `anyone down for soccer`
Sign-ups persist in `data/social.json` (shared by chat + dev). Reset between rehearsals: `rm data/social.json`.

- [x] `list_signups` over mock/students.json
- [x] `router-prompt.md` v0 — you own it. Core fills `{{ROUTER_LINES}}` with each persona's `routerLine`.
- [x] Try the router: `npm run chat -- group`, type `I'm going on the beach trip Saturday`
      (keyless = keyword routing; with GEMINI_API_KEY = the real router using your prompt)
- [x] Tools: `join_activity` (add the user to a plan), matching people with the same interest
- [x] `watch()`: "Jordan joined soccer after you" when a match forms, and "3 people want Boba run" when a live join makes a plan hot. Turn on with `WATCH=financial,social` OR fire on cue (newest match only), not both. The cue texts the phone only through the running server: with `TRANSPORT=imessage npm run dev` up, run `SERVER_URL=http://localhost:3000 npm run trigger -- social match +1<the user's real phone>` (plus `DEMO_TOKEN` if set). Without `SERVER_URL` it only prints in the terminal, and without a phone it targets the fake demo user. Seeded beach/soccer start at 3 so they never go hot: demo the hot text with boba (1 seeded + 2 live joins) or a new plan.
- [ ] Group chat creation + intros (needs a Photon dedicated line; fallback: DM each match the others' names)
- [ ] Voice in `prompt.md`: hype friend who knows everyone. Activities and outings only.
- [x] Social avatar: Kerry's `docs/avatars/sunny.png` (contact photo) and `sunny-icon.png`

## Sign-up flow (see docs/SIGNUP-PLAN.md), added by Ismail
- [x] Sunny `intro` trigger (`watch.ts`): hello + the open plan that best fits their sign-up interests, with who's in; no fit → the most popular plan. Fired by /admin "send intro"; on cue: `npm run trigger -- social intro +1<phone>`
- [x] Use `user.interests` from sign-up (`interests.ts`): categories map to plans by name; `list_signups` and `find_matches` put fits first and say so; `find_matches` takes a category ("outdoors")
- [ ] Create the group chat by hand in iMessage; write the steps in STATUS
