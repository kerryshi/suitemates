import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../core/env.ts";
import { loadConfig } from "../core/config.ts";

// Loads into a fresh object, never process.env, so the tests can't leak keys into each other.
const load = (text: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
  writeFileSync(file, text);
  const env: Record<string, string | undefined> = {};
  loadDotEnv(file, env);
  return env;
};

test("a comment after an empty value is not the value (the .env.example shape)", () => {
  const env = load(
    "SERVER_URL=                 # for `npm run trigger` against a running server\n" +
      "DEMO_TOKEN=\t# if set, /demo/trigger needs ?token=\n" +
      "WATCH=   # e.g. financial,social\n",
  );
  assert.equal(env.SERVER_URL, "");
  assert.equal(env.DEMO_TOKEN, "");
  assert.equal(env.WATCH, "");
});

test("comments, quotes and # inside values", () => {
  const env = load(
    ["A=abc # note", "B=abc#def", 'C="a # b"', "D='x # y'", "E=#fff", "F=", "G=  spaced  "].join("\n"),
  );
  assert.equal(env.A, "abc");
  assert.equal(env.B, "abc#def"); // no space before #: part of the value
  assert.equal(env.C, "a # b");
  assert.equal(env.D, "x # y");
  assert.equal(env.E, ""); // unquoted leading # is a comment; quote it to keep it
  assert.equal(env.F, "");
  assert.equal(env.G, "spaced");
});

test("a straight copy of .env.example loads every blank key as blank", () => {
  const env: Record<string, string | undefined> = {};
  loadDotEnv(fileURLToPath(new URL("../.env.example", import.meta.url)), env);
  for (const k of ["SERVER_URL", "DEMO_TOKEN", "NESSIE_API_KEY", "CANVAS_TOKEN", "ACADEMIC_LINE", "GEMINI_API_KEY"]) {
    assert.equal(env[k], "", k);
  }
  // Shape, not values: teammates add keys to the template, so no value may start with a comment.
  for (const [k, v] of Object.entries(env)) assert.ok(!v?.startsWith("#"), k);
  // The symptom was a comment read as a value (it once forced every message to Penny); same check on a line key.
  const config = loadConfig(env);
  assert.equal(config.lines.academic, undefined);
  assert.equal(config.DEMO_TOKEN, undefined);
});
