import { test } from "node:test";
import assert from "node:assert/strict";
import { SpectrumTransport } from "../core/transport.ts";
import { loadConfig } from "../core/config.ts";
import type { Outbound } from "../core/types.ts";

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

// send() with a fake space dropped into the private cache, so no Spectrum app is needed. Fresh transport per call.
const sendVia = async (env: Record<string, string>, o: Outbound) => {
  const t = new SpectrumTransport(loadConfig(env)) as unknown as { spaces: Map<string, { id: string; send(t: string): Promise<unknown> }>; send(o: Outbound): Promise<void> };
  const sent: string[] = [];
  t.spaces.set(`${o.persona}|${o.handle}`, { id: "s", send: async (text) => void sent.push(text) });
  await t.send(o);
  return sent;
};
const SHARED = { DEFAULT_PERSONA: "social" };
const dm = (persona: Outbound["persona"], text = "roast"): Outbound => ({ persona, handle: "dm:+19195550001", text });

test("on one shared number a proactive DM says which persona sent it", async () => {
  assert.deepEqual(await sendVia(SHARED, dm("financial")), ["Penny: roast"]);
  assert.deepEqual(await sendVia(SHARED, dm("social", "Jordan joined")), ["Sunny: Jordan joined"]);
  assert.deepEqual(await sendVia({ ...SHARED, FINANCIAL_NAME: "Pen" }, dm("financial")), ["Pen: roast"]);
});

test("no tag when that persona has its own line or project, and never twice", async () => {
  assert.deepEqual(await sendVia({ ...SHARED, FINANCIAL_LINE: "+1 (919) 555-0142" }, dm("financial")), ["roast"]);
  assert.deepEqual(await sendVia({ ...SHARED, FINANCIAL_PROJECT_ID: "p", FINANCIAL_PROJECT_SECRET: "s" }, dm("financial")), ["roast"]);
  assert.deepEqual(await sendVia(SHARED, dm("financial", "Penny: roast")), ["Penny: roast"]);
  assert.deepEqual(await sendVia(SHARED, dm("financial", "penny: roast")), ["penny: roast"]);
});

test("replies in the user's own DM or the group are left as they are (proactive only)", async () => {
  assert.deepEqual(await sendVia(SHARED, { persona: "financial", handle: "space-abc", text: "hey" }), ["hey"]);
});
