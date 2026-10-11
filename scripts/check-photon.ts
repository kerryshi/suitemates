// Before judging (and after any restart): does each agent's own Photon project answer with that agent's token?
//   npm run check-photon      → one line per agent; exit 1 if any FAIL
import { loadDotEnv } from "../core/env.ts";
import { checkPhoton } from "../core/photon-users.ts";

loadDotEnv();
const rows = await checkPhoton();
for (const r of rows) {
  const where = r.project ? ` (project …${r.project.slice(-6)})` : "";
  console.log(r.ok ? `${r.agent}: ok, ${r.users}/${r.cap} users${where}` : `${r.agent}: FAIL ${r.error}${where}`);
}
const full = rows.filter((r) => r.ok && r.users! >= r.cap);
for (const r of full) console.log(`${r.agent}: FULL: new people get ${r.agent}'s texts through another agent's thread (via)`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
