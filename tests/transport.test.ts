import { test } from "node:test";
import assert from "node:assert/strict";
import { SpectrumTransport } from "../core/transport.ts";
import { loadConfig } from "../core/config.ts";

// personaForLine is private; reached into here because on a shared-number Photon plan the SDK can't
// say which line got a message, so it's called with no line at all.
const personaFor = (env: Record<string, string>, line?: string) =>
  (new SpectrumTransport(loadConfig(env)) as unknown as { personaForLine(l?: string): string }).personaForLine(line);

test("one shared number with no *_LINE set routes inbound to DEFAULT_PERSONA, not whichever persona is first", () => {
  assert.equal(personaFor({ DEFAULT_PERSONA: "social" }), "social");
  assert.equal(personaFor({ DEFAULT_PERSONA: "social" }, "+19195550123"), "social");
});

test("a dedicated line still routes to its persona; an unknown or missing line falls back to DEFAULT_PERSONA", () => {
  const env = { DEFAULT_PERSONA: "social", FINANCIAL_LINE: "+1 (919) 555-0142" };
  assert.equal(personaFor(env, "+19195550142"), "financial");
  assert.equal(personaFor(env, "+19195550999"), "social");
  assert.equal(personaFor(env), "social");
});
