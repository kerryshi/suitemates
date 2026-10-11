# Watchdog: alerts instead of debugging

`scripts/watchdog.ts` watches the demo from outside the server every 30 s and pushes an alert to Kerry's phone
(ntfy app) when something breaks. Each alert says what broke and the command that fixes it. It never restarts or
kills anything (Kerry, 2026-10-11): a person runs the fix.

## Setup (once per laptop)

1. Phone: install **ntfy**, subscribe to the topic in `data/watchdog.json` on `ntfy.sh`.
2. healthchecks.io (dead-man's switch): check `suitemates-watchdog`, Period 2 min, Grace 2 min, Integration → ntfy
   (server `https://ntfy.sh`, same topic). Put its ping URL in `data/watchdog.json` as `hcUrl`.
3. `data/watchdog.json` (gitignored): `{"ntfyTopic": "suitemates-…", "hcUrl": "https://hc-ping.com/…", "name": ""}`.
   Teammates set `name` to `dean` / `sunny` so their alerts are labelled.
4. Start it: `WATCHDOG_ROOT=<checkout the server runs in> ops/watchdog.sh install` (launchd; survives logout, restarts
   itself). New code: `ops/watchdog.sh restart`. Stop: `ops/watchdog.sh uninstall`. State: `ops/watchdog.sh status`.
   Log: `data/logs/watchdog.log`. Alert state is saved in `data/watchdog-state.json`, so a restart doesn't re-send alerts.
   The launchd agent runs the code from the checkout you installed it from: after this branch is merged, run
   `ops/watchdog.sh install` again from `~/Projects/hacknc-agents`, then remove the worktree (not before).
5. Prove the channel: `npx tsx scripts/watchdog.ts test` → a "Watchdog test" push. `… once` prints every check.

During judging: `touch data/judging` turns on the "no texts in 20 min" nudge; `rm data/judging` after.
After printing QR codes: `cp data/public-url.txt data/printed-url.txt` so a tunnel address change alerts.

## Alerts

| Alert | Fires when | Fix (also in the alert) |
|---|---|---|
| Mac on battery (urgent < 30%) | `pmset -g batt` not on AC, first tick | Plug in; keep the lid open (lid closed = asleep = deaf) |
| Server :3000 down (urgent) | `/health` fails 2 ticks (60 s) | `TRANSPORT=imessage MOCK=0 caffeinate -dims npm run dev >> data/logs/server.log 2>&1 &` (EADDRINUSE → kill the old listener first) |
| A second server crashed | `EADDRINUSE` in the server log | Keep the :3000 listener, close the other terminal |
| Sign-up page unreachable (tunnel) | no `data/public-url.txt` or `<url>/health` fails, 2 ticks | `npm run tunnel`, reload the /join pages |
| Printed QR codes point at an old address | `data/printed-url.txt` ≠ `data/public-url.txt` | Show the live /join QR or reprint, then `cp` as above |
| iMessage connection flapping | ≥2 `connection lost` lines in 2 min | Photon outage (see next) → `npm run chat` (terminal, starts on Sunny); else Wi-Fi; persists → restart server |
| Server error while handling a text | `[imessage] handler error` | Read the server log; replies stopped → restart server |
| Photon API unreachable | `photon ping` fails twice (checked every 2 min) | Offline? fix Wi-Fi. Else Photon is down: tell judges, terminal demo |
| Photon CLI logged out | `photon whoami` fails (every 2 min) | `photon login` — until then every sign-up stays pending |
| Sign-up stuck pending | a pending sign-up in the last 15 min (state.json or `[signup] … (pending; photon: …)`); a NEW one alerts at once | /admin → the pending row → add the number under Users in the agent's Photon project → "send intro" |
| Mac offline (urgent) | `HEAD https://1.1.1.1` fails 2 ticks; shown on the Mac, phone hears via healthchecks | Venue Wi-Fi or phone hotspot; server and tunnel reconnect themselves |
| Server output not captured | the :3000 process writes to a terminal, not a file | Restart it with `>> data/logs/server.log 2>&1` |
| No texts in 20 min during judging | `data/judging` exists and no inbound line for 20 min | Text Penny "hey"; no reply in 15 s → restart server |
| Agent replies failing | ≥2 `[core] ERROR <agent> reply/proactive text failed` in 5 min (Gemini status, timeout, fetch) | 429 wait/slow down; 400/403 new key; timeouts = Gemini or Wi-Fi; last resort `FAKE_LLM=1` |
| Watchdog heartbeat missing (from healthchecks) | no ping for 2 + 2 min: Mac asleep, offline, or watchdog dead | Wake / plug in / Wi-Fi; `ops/watchdog.sh status`; `ops/watchdog.sh install` |

Error-burst alerts (flapping, handler errors, reply failures, second server) don't send "fine again" when they age
out; nothing was fixed. A sign-up that's still pending after 15 min stays red silently instead of a false "fine".
A tick that hangs 45 s exits and launchd starts a fresh watchdog (healthchecks sees the /fail).

Phones are masked to the last 4 digits in every alert (the ntfy topic is private only by its random name). No keys,
tokens or the healthchecks URL ever go into an alert.

No mute yet: a check you deliberately leave red (e.g. tunnel off on purpose) re-alerts every 10 min. Not covered (by
ruling or not tonight): a synthetic send probe (Kerry: no), Nessie, the 50-new-conversations quota,
Dean's and Sunny's laptops (same script with `name` set, once they install it).
