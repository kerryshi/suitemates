# Social: Abdallah

Branch: `social/matching` · commit prefix `[social]` · only edit `personas/social/`
Done when: two phones get matched and introduced in a group chat, and the router picks the right persona(s).

Already working (keyless): `MOCK=1 npm run chat -- social` then type `anyone down for soccer`
Sign-ups persist in `data/social.json` (shared by chat + dev). Reset between rehearsals: `rm data/social.json`.

- [x] `list_signups` over mock/students.json
- [x] `router-prompt.md` v0 — you own it. Core fills `{{ROUTER_LINES}}` with each persona's `routerLine`.
- [x] Try the router: `npm run chat -- group`, type `I'm going on the beach trip Saturday`
      (keyless = keyword routing; with GEMINI_API_KEY = the real router using your prompt)
- [x] Tools: `join_activity` (add the user to a plan), matching people with the same interest
- [x] `watch()`: "3 people want pickup soccer Sunday" when a match forms (turn on with `WATCH=financial,social`; on cue: `npm run trigger -- social match`)
- [ ] Group chat creation + intros (needs a Photon dedicated line; fallback: DM each match the others' names)
- [ ] Voice in `prompt.md`: hype friend who knows everyone. Activities and outings only.
- [ ] Social avatar
