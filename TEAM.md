# Team rules

| Who | Owns | Branch | Commit prefix |
|---|---|---|---|
| Kerry | `core/` (shared layer) + `personas/financial/` | `kerry/core`, `fin/nessie` | `[core]`, `[financial]` |
| Ismail | `personas/academic/` | `academic/canvas` | `[academic]` |
| Abdallah | `personas/social/` + `personas/social/router-prompt.md` (the group router) | `social/matching` | `[social]` |

Your first hour is in your folder's `TODO.md`.

## Daily rules
- Work on your own branch. Pull `main` into it at least every hour: `git pull origin main`.
- Merge to `main` whenever a checkpoint item passes (about every 2 hours). No reviews, but post "merging" in the team chat first.
- **Only touch files in your own folder.** Need something in `core/` or `core/types.ts`? Ask Kerry, or make the change and tell Kerry before merging.
- Commit messages start with your area: `[financial] roast on new purchase`.
- `npm test` must pass before you merge (it checks every persona folder against the contract).
- Never commit API keys. New key names go in `.env.example`; real values go in the team chat.
- **Used an AI tool?** (ChatGPT, Copilot, Cursor, Claude, an image generator) Add it to README → *How we built it* before you merge. MLH requires us to disclose AI tools, and judges may ask who built what, so be ready to explain the code in your folder.
- Don't send real personal data through Gemini on a free-tier key (Google may train on it). Mock data is fine.

## Checkpoints (Sat → Sun)
- [ ] 5 PM: shared layer live; everyone's tools working on mock data
- [ ] 8 PM: each persona replies in its own voice over Photon
- [ ] 11 PM: Financial reacts to Nessie purchases; Academic answers from Canvas; Social matches two phones
- [ ] 2 AM: group chat router and one three-persona hand-off working
- [ ] 4 AM: feature freeze; everything merged to `main`; `git tag demo && git push origin demo`
- [ ] 6 AM: demo video recorded from the `demo` tag only
- [ ] 9 AM: Devpost + GitHub link + video submitted (repo made public first)

## Cut order if we're behind
Receipt photos → weekly check-in → Social. Keep Financial and the group chat.
