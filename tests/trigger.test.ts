import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the real script. SERVER_URL="" is defined, so loadDotEnv won't fill it from a real .env: the local path.
const trigger = (...args: string[]) =>
  spawnSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), "scripts/trigger.ts", ...args], {
    env: {
      ...process.env,
      SERVER_URL: "",
      FAKE_LLM: "1",
      TRANSPORT: "terminal",
      CHAT_STATE: join(mkdtempSync(join(tmpdir(), "trigger-")), "chat-state.json"),
    },
    encoding: "utf8",
  });

test("a cue with a real phone but no SERVER_URL says on stderr that it only printed", () => {
  const r = trigger("academic", "morning_due", "+19195550199");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\+19195550199/);
  assert.match(r.stderr, /not sent/);
  assert.match(r.stderr, /SERVER_URL/);
});
