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
  assert.deepEqual(await sendVia({ ...SHARED, FINANCIAL_LINE: "+1 (919) 555-0142" }, dm("social", "hi")), ["Sunny: hi"]); // per persona
  assert.deepEqual(await sendVia(SHARED, dm("financial", "Penny: roast")), ["Penny: roast"]);
  assert.deepEqual(await sendVia(SHARED, dm("financial", "penny: roast")), ["penny: roast"]);
});

test("replies in the user's own DM or the group are left as they are (proactive only)", async () => {
  assert.deepEqual(await sendVia(SHARED, { persona: "financial", handle: "space-abc", text: "hey" }), ["hey"]);
});

test("a dropped Photon connection reconnects instead of going deaf", async () => {
  const t = new SpectrumTransport(loadConfig({ DEFAULT_PERSONA: "academic" })) as unknown as {
    apps: Map<string, unknown>;
    keepAlive(key: string, make: () => Promise<unknown>, personaOf: () => string, onInbound: () => Promise<void>): Promise<void>;
  };
  let made = 0;
  const forever = { messages: { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) } };
  const drops = { messages: { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("getaddrinfo ENOTFOUND spectrum.photon.codes")) }) } };
  const make = async () => {
    made++;
    if (made === 1) throw new Error("fetch failed"); // can't connect at all
    return made === 2 ? drops : forever; // connects, then the stream drops; then a healthy one
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    void t.keepAlive("shared", make, () => "academic", async () => {});
    const until = Date.now() + 8000;
    while (made < 3 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  } finally {
    console.warn = warn;
  }
  assert.equal(made, 3);
  assert.equal(t.apps.get("shared"), forever);
});
