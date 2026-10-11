// Separate agents: each has its own QR sign-up, the backend keeps one shared profile, and on the shared Photon
// number a DM goes to the right one of *your* agents.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import { startHttp } from "../core/http.ts";
import type { LlmClient } from "../core/llm/client.ts";
import type { Inbound, Outbound } from "../core/types.ts";

const PHONE = "+19195550123";

async function setup() {
  const store = new Store(null);
  const llm: LlmClient = {
    name: "spy",
    chat: async ({ system }) => ({ text: `${/You are (\w+),/.exec(system)?.[1]} reply` }),
    json: async () => "{}",
  };
  const engine = new Engine({
    personas: loadPersonas(),
    store,
    llm,
    config: { names: { academic: "Dean", financial: "Penny", social: "Sunny" }, PRODUCT_NAME: "Suitemates", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 10 },
    routerPrompt: "",
    log: () => {},
  });
  const transport = { start: async () => {}, send: async (_o: Outbound) => {} };
  const http = startHttp({ engine, transport, port: 0, addUser: async () => ({ ok: true, line: "+16465550177" }) });
  await new Promise((r) => http.once("listening", r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const signup = async (body: Record<string, unknown>) =>
    (await fetch(base + "/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sam", phone: PHONE, ...body }) })).json() as Promise<Record<string, unknown>>;
  let n = 0;
  const dm = (text: string, extra: Partial<Inbound> = {}) =>
    engine.handle({ persona: "financial", kind: "dm", sender: PHONE, text, handle: "space-1", messageId: `m${++n}`, ...extra });
  return { store, base, signup, dm, close: () => http.close() };
}

test("landing and per-agent sign-up pages are served", async () => {
  const s = await setup();
  try {
    assert.match(await (await fetch(s.base + "/")).text(), /Pick your agent/);
    for (const id of ["academic", "financial", "social"]) assert.equal((await fetch(`${s.base}/join/${id}`)).status, 200);
    assert.equal((await fetch(`${s.base}/join/nobody`)).status, 404);
    assert.deepEqual(await s.signup({ agent: "nobody" }), { error: "Unknown agent." });
  } finally {
    s.close();
  }
});

test("sign up with Dean, later with Sunny: one shared profile, each greets once, only its own fields change", async () => {
  const s = await setup();
  try {
    const dean = await s.signup({ agent: "academic", canvas: true });
    assert.equal(dean.textTo, "+16465550177");
    assert.deepEqual(s.store.user(PHONE).agents, ["academic"]);

    const hey = await s.dm("hey Dean");
    assert.deepEqual(hey.map((o) => [o.persona, o.card ? "card" : "text"]), [["academic", "text"], ["academic", "card"]]);

    await s.signup({ agent: "social", interests: ["food"] });
    const u = s.store.user(PHONE);
    assert.deepEqual(u.agents, ["academic", "social"]);
    assert.deepEqual(u.interests, ["food"]);
    assert.equal(u.canvasLinked, true); // Dean's answer kept

    const heySunny = await s.dm("hey Sunny");
    assert.deepEqual(heySunny.map((o) => [o.persona, o.card ? "card" : "text"]), [["social", "text"], ["social", "card"]]);
    assert.deepEqual(s.store.user(PHONE).greeted, ["academic", "social"]);
  } finally {
    s.close();
  }
});

test("shared number: a DM goes to the agent named, else the one it's about, else the last one; replies say who", async () => {
  const s = await setup();
  try {
    await s.signup({ agent: "academic" });
    await s.signup({ agent: "social" });
    await s.dm("hey"); // intros for both
    assert.deepEqual((await s.dm("what assignments are due this week")).map((o) => [o.persona, o.text]), [["academic", "Dean: Dean reply"]]);
    assert.deepEqual((await s.dm("anyone down for pickup soccer saturday?")).map((o) => o.persona), ["social"]);
    assert.deepEqual((await s.dm("sunny, actually what's due")).map((o) => o.persona), ["social"]); // named wins
    assert.deepEqual((await s.dm("ok cool")).map((o) => o.persona), ["social"]); // last one
    // Penny isn't one of their agents, so money talk still goes to someone they signed up with.
    assert.notEqual((await s.dm("can I afford concert tickets"))[0].persona, "financial");
  } finally {
    s.close();
  }
});

test("a dedicated line always answers as itself; one agent → no name tag", async () => {
  const s = await setup();
  try {
    await s.signup({ agent: "academic" });
    await s.dm("hey");
    assert.deepEqual((await s.dm("anyone down for soccer")).map((o) => [o.persona, o.text]), [["academic", "Dean reply"]]);
    assert.deepEqual((await s.dm("can I afford it", { lineKnown: true })).map((o) => o.persona), ["financial"]);
  } finally {
    s.close();
  }
});

test("Dean's sign-up checks a Canvas token with Canvas before saving it; it's never listed; it turns on live Canvas", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes("instructure.com")) return realFetch(url, init);
    const auth = new Headers(init?.headers).get("authorization");
    return auth === "Bearer 1234~goodgoodgoodgoodgoodgood"
      ? new Response(JSON.stringify({ name: "Sam Lee", short_name: "Sam" }), { status: 200 })
      : new Response("unauthorized", { status: 401 });
  }) as typeof fetch;
  const s = await setup();
  try {
    assert.deepEqual(await s.signup({ agent: "academic", canvasToken: "nope" }), {
      error: "That doesn't look like a Canvas token. Copy it again from Canvas → Account → Settings.",
    });
    assert.match(String((await s.signup({ agent: "academic", canvasToken: "1234~badbadbadbadbadbadbad" })).error), /didn't accept that token/);
    assert.equal(s.store.user(PHONE).signedUpAt, undefined); // nothing saved on a failed check

    const ok = await s.signup({ agent: "academic", canvasToken: " 1234~goodgoodgoodgoodgoodgood " });
    assert.equal(ok.note, "Connected to Sam's Canvas.");
    assert.equal(s.store.user(PHONE).canvasToken, "1234~goodgoodgoodgoodgoodgood");
    assert.doesNotMatch(await (await fetch(s.base + "/admin/signups")).text(), /goodgood/);

    const { isLive } = await import("../personas/academic/canvas.ts");
    const ctx = { user: s.store.user(PHONE), mock: true, now: new Date(), kv: { get: () => undefined, set: () => {} }, log: () => {} };
    const live = process.env.CANVAS_LIVE;
    process.env.CANVAS_LIVE = "1";
    try {
      assert.equal(isLive(ctx), true); // their own token, no CANVAS_OWNER_PHONE needed
      assert.equal(isLive({ ...ctx, user: { ...ctx.user, canvasToken: undefined } }), false);
    } finally {
      if (live === undefined) delete process.env.CANVAS_LIVE;
      else process.env.CANVAS_LIVE = live;
    }
  } finally {
    globalThis.fetch = realFetch;
    s.close();
  }
});
