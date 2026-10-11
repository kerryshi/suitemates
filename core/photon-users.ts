// Add a signed-up phone to the Photon project's Users allowlist (the SDK can't; the Photon CLI can:
// `photon spectrum users add`), then find the pool number they text. Needs the CLI installed and signed in
// (`npm i -g @photon-ai/cli`, then `photon login`), and PHOTON_AUTO_ADD=1. Off or failing → the sign-up stays
// pending and someone adds them in the dashboard (/admin shows them).
import { spawn } from "node:child_process";

export interface AddResult {
  ok: boolean;
  line?: string; // the number they text (their pool number), when we can tell
  error?: string;
}
export type AddUser = (phone: string, firstName: string) => Promise<AddResult>;

// Names go to a CLI argument: letters, spaces, - ' . only, so nothing can reach a shell.
export function safeName(name: string): string {
  const n = name.trim().slice(0, 40);
  return /^[\p{L}][\p{L} .'-]*$/u.test(n) ? n : "Friend";
}

function run(args: string[], timeoutMs = 20_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    // Windows needs the .cmd shim, which needs a shell; every argument is validated (E.164 phone, safeName).
    const win = process.platform === "win32";
    const child = spawn(win ? "photon.cmd" : "photon", win ? args.map((a) => `"${a}"`) : args, { shell: win, timeout: timeoutMs });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ code: -1, out, err: e.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, out, err }));
  });
}

// Any +1XXXXXXXXXX in the users list entry for this phone that isn't the phone itself: their pool line.
export function lineFor(listJson: string, phone: string): string | undefined {
  let data: unknown;
  try {
    data = JSON.parse(listJson);
  } catch {
    return undefined;
  }
  const users = Array.isArray(data) ? data : ((data as { data?: unknown; users?: unknown })?.data ?? (data as { users?: unknown })?.users);
  if (!Array.isArray(users)) return undefined;
  const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
  const mine = users.find((u) => JSON.stringify(u).replace(/\D/g, "").includes(digits(phone)));
  if (!mine) return undefined;
  const numbers = JSON.stringify(mine).match(/\+1\d{10}/g) ?? [];
  return numbers.find((n) => digits(n) !== digits(phone));
}

export const photonCliAddUser: AddUser = async (phone, firstName) => {
  if (process.env.PHOTON_AUTO_ADD !== "1") return { ok: false, error: "PHOTON_AUTO_ADD is off" };
  if (!/^\+1\d{10}$/.test(phone)) return { ok: false, error: "bad phone" };
  const project = process.env.SPECTRUM_PROJECT_ID;
  if (!project || !/^[\w-]+$/.test(project)) return { ok: false, error: "SPECTRUM_PROJECT_ID missing" };
  const auth = process.env.PHOTON_API_TOKEN && /^[\w.~-]+$/.test(process.env.PHOTON_API_TOKEN) ? ["-t", process.env.PHOTON_API_TOKEN] : [];
  const add = await run(["spectrum", "users", "add", "--phone", phone, "--first-name", safeName(firstName), "-p", project, "--json", ...auth]);
  // Already on the list is fine: we still want their line.
  if (add.code !== 0 && !/already|exists|409/i.test(add.out + add.err)) {
    return { ok: false, error: (add.err || add.out || `photon exited ${add.code}`).trim().slice(0, 300) };
  }
  const list = await run(["spectrum", "users", "list", "-p", project, "--json", ...auth]);
  return { ok: true, line: (list.code === 0 ? lineFor(list.out, phone) : undefined) ?? (process.env.POOL_NUMBER || undefined) };
};
