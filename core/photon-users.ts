// Add a signed-up phone to the Photon project's Users allowlist (the SDK can't; the Photon CLI can:
// `photon spectrum users add`), then find the pool number they text. Needs the CLI installed and signed in
// (`npm i -g @photon-ai/cli`, then `photon login`), and PHOTON_AUTO_ADD=1. Off or failing → the sign-up stays
// pending and someone adds them in the dashboard (/admin shows them).
import { spawn } from "node:child_process";
import type { PersonaId } from "./types.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface AddResult {
  ok: boolean;
  line?: string; // the number they text (their pool number), when we can tell
  error?: string;
}
export type AddUser = (phone: string, firstName: string, agent?: PersonaId) => Promise<AddResult>;

// The Photon project an agent lives on, and the CLI token for that project's account. With one project per agent
// (<AGENT>_PROJECT_ID, each teammate's own plan) a sign-up for Penny must land on Penny's allowlist, not on the
// shared SPECTRUM_PROJECT_ID's (which is someone else's plan): that's why only one agent's QR worked. Each plan
// is a different Photon account, so each needs its own token (<AGENT>_PHOTON_API_TOKEN) unless one login sees all.
export function photonProjectFor(agent?: PersonaId): { project?: string; token?: string; own: boolean } {
  const A = agent?.toUpperCase();
  const ownProject = A ? process.env[`${A}_PROJECT_ID`] : undefined;
  return {
    project: ownProject || process.env.SPECTRUM_PROJECT_ID,
    token: (A && process.env[`${A}_PHOTON_API_TOKEN`]) || process.env.PHOTON_API_TOKEN,
    own: Boolean(ownProject),
  };
}

// Names go to a CLI argument: letters, spaces, - ' . only, so nothing can reach a shell.
export function safeName(name: string): string {
  const n = name.trim().slice(0, 40);
  return /^[\p{L}][\p{L} .'-]*$/u.test(n) ? n : "Friend";
}

function run(args: string[], timeoutMs = 20_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    // No shell anywhere: on Windows run the CLI's script with this Node (the photon.cmd shim would need one).
    const script = join(process.env.APPDATA ?? "", "npm", "node_modules", "@photon-ai", "cli", "dist", "photon.js");
    const [cmd, argv] = process.platform === "win32" && existsSync(script) ? [process.execPath, [script, ...args]] : ["photon", args];
    const child = spawn(cmd, argv, { timeout: timeoutMs });
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
  // `users list --json` is an array; `users add --json` is one user; tolerate { data } / { users } wrappers too.
  const wrapped = (data as { data?: unknown; users?: unknown }) ?? {};
  const inner = Array.isArray(data) ? data : (wrapped.data ?? wrapped.users ?? data);
  const users = Array.isArray(inner) ? inner : [inner];
  const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
  const mine = users.find((u) => u && JSON.stringify(u).replace(/\D/g, "").includes(digits(phone))) as { assignedPhoneNumber?: string } | undefined;
  if (!mine) return undefined;
  // Photon's field (seen live): { phoneNumber, assignedPhoneNumber }. Else any other +1 number in the entry.
  if (typeof mine.assignedPhoneNumber === "string" && /^\+1\d{10}$/.test(mine.assignedPhoneNumber)) return mine.assignedPhoneNumber;
  const numbers = JSON.stringify(mine).match(/\+1\d{10}/g) ?? [];
  return numbers.find((n) => digits(n) !== digits(phone));
}

// Is this phone already a user in a `users list --json` dump?
export function onList(listJson: string, phone: string): boolean {
  try {
    const data = JSON.parse(listJson);
    const users = Array.isArray(data) ? data : (data?.data ?? data?.users ?? []);
    const d = phone.replace(/\D/g, "").slice(-10);
    return Array.isArray(users) && users.some((u) => String(u?.phoneNumber ?? "").replace(/\D/g, "").slice(-10) === d);
  } catch {
    return false;
  }
}

export const photonCliAddUser: AddUser = async (phone, firstName, agent) => {
  if (process.env.PHOTON_AUTO_ADD !== "1") return { ok: false, error: "PHOTON_AUTO_ADD is off" };
  if (!/^\+1\d{10}$/.test(phone)) return { ok: false, error: "bad phone" };
  const { project, token } = photonProjectFor(agent);
  const which = agent ? `${agent.toUpperCase()}_PROJECT_ID or SPECTRUM_PROJECT_ID` : "SPECTRUM_PROJECT_ID";
  if (!project || !/^[\w-]+$/.test(project)) return { ok: false, error: `${which} missing` };
  const auth = token && /^[\w.~-]+$/.test(token) ? ["-t", token] : [];
  // Already on the list → just read their line. `users add` on an existing number UPDATES that person (it overwrote
  // a real name and email with our placeholders once), so never call it for someone who's already there.
  const list = await run(["spectrum", "users", "list", "-p", project, "--json", ...auth]);
  if (list.code !== 0) return { ok: false, error: (list.err || list.out || `photon exited ${list.code}`).trim().slice(0, 300) };
  if (onList(list.out, phone)) return { ok: true, line: lineFor(list.out, phone) };
  // Non-interactive add needs a last name and an email; we collect neither. Placeholders, and no --invite (no email).
  const placeholder = ["--last-name", "Suitemates", "--email", `sms-${phone.slice(1)}@example.com`];
  const add = await run(["spectrum", "users", "add", "--phone", phone, "--first-name", safeName(firstName), ...placeholder, "-p", project, "--json", ...auth]);
  if (add.code !== 0) return { ok: false, error: (add.err || add.out || `photon exited ${add.code}`).trim().slice(0, 300) };
  return { ok: true, line: lineFor(add.out, phone) ?? lineFor((await run(["spectrum", "users", "list", "-p", project, "--json", ...auth])).out, phone) };
};
