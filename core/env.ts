// Load .env into process.env (without overriding variables already set). Works on any Node version.
import { existsSync, readFileSync } from "node:fs";

export function loadDotEnv(file = ".env") {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const quoted = /^(['"])(.*)\1$/.exec(m[2]);
    const value = quoted ? quoted[2] : m[2].replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
