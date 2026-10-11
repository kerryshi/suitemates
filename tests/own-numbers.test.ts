// Own number per agent: each persona is its own Photon project (Pro: 100 users), on its own account. Sign-up adds the
// phone to THAT agent's project with THAT account's token, saves the number they text per agent, and the agent texts
// first. Anything that can't land on its own project still gets through (recruit.test.ts, transport via).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import { FakeLlm } from "../core/llm/fake.ts";
import { startHttp } from "../core/http.ts";
import { SpectrumTransport } from "../core/transport.ts";
import { loadConfig } from "../core/config.ts";
import { cliAddUser, type AddUser } from "../core/photon-users.ts";
import type { Outbound, Persona, PersonaId } from "../core/types.ts";

const PHONE = "+19195550123";
const NAMES = { academic: "Dean", financial: "Penny", social: "Sunny" };
const PROJECT: Record<PersonaId, string> = { social: "p-s", financial: "p-f", academic: "p-a" };
for (const id of ["social", "financial", "academic"] as const) {
  process.env[`${id.toUpperCase()}_PROJECT_ID`] = PROJECT[id];
  process.env[`${id.toUpperCase()}_PROJECT_SECRET`] = "x";
}const LINES: Record<PersonaId, string> = { social: "+16465550001", financial: "+16465550002", academic: "+16465550003" };

const users = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ phoneNumber: `+1919555${String(9000 + i)}`, assignedPhoneNumber: "+16465550000" })));

test("Photon add uses that agent's project and token; a full project says so without trying to add", async () => {
  const calls: string[][] = [];
  let listed = users(3);
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[2] === "list") return { code: 0, out: listed, err: "" };
    return { code: 0, out: JSON.stringify({ phoneNumber: PHONE, assignedPhoneNumber: LINES.academic }), err: "" };
  };
  const env = { PHOTON_AUTO_ADD: "1", SPECTRUM_PROJECT_ID: "p-default", ACADEMIC_PROJECT_ID: "p-a", ACADEMIC_PROJECT_SECRET: "x", ACADEMIC_PHOTON_API_TOKEN: "tok.ismail", ACADEMIC_PHOTON_CAP: "10" };
  const add = cliAddUser(run, env);

  assert.deepEqual(await add(PHONE, "Sam", "academic"), { ok: true, line: LINES.academic });
  assert.deepEqual(calls[0], ["spectrum", "users", "list", "-p", "p-a", "--json", "-t", "tok.ismail"]);
  assert.equal(calls[1][2], "add");
  assert.ok(calls[1].includes("p-a") && calls[1].includes("tok.ismail"));

  calls.length = 0;
  listed = users(10);
  const full = await add(PHONE, "Sam", "academic");
  assert.deepEqual([full.ok, full.full], [false, true]);
  assert.match(full.error ?? "", /full \(10\/10/);
  assert.equal(calls.length, 1, "no add spawned for a full project");

  // No per-persona project or token: the default project and the Mac's stored login (no -t). Pro default cap is 100.
  calls.length = 0;
  listed = users(10);
  assert.equal((await add(PHONE, "Sam", "financial")).ok, true);
  assert.deepEqual(calls[0], ["spectrum", "users", "list", "-p", "p-default", "--json"]);
});

async function server(o: { addUser?: AddUser; failSend?: boolean; addCap?: number } = {}) {
  const store = new Store(null);
  const sent: Outbound[] = [];
  const adds: [string, PersonaId | undefined][] = [];
  const engine = new Engine({
    personas: loadPersonas(),
    store,
    llm: new FakeLlm(),
    config: { names: NAMES, PRODUCT_NAME: "Suitemates", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 10 },
    routerPrompt: "",
    log: () => {},
  });
  const transport = {
    start: async () => {},
    send: async (out: Outbound) => {
      if (o.failSend) throw new Error("Target not allowed for this project");
      sent.push(out);
    },
  };
  const addUser: AddUser = o.addUser ?? (async (phone, _n, persona) => (adds.push([phone, persona]), { ok: true, line: LINES[persona!] }));
  const http = startHttp({ engine, transport, port: 0, addUser, addCap: o.addCap });
  await new Promise((r) => http.once("listening", r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const signup = async (body: Record<string, unknown>) =>
    (await fetch(base + "/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sam", phone: PHONE, ...body }) })).json() as Promise<Record<string, unknown>>;
  return { store, sent, adds, engine, signup, close: () => http.close() };
}

test("sign up with Sunny: added to Sunny's project, Sunny texts first from her own number, page shows that number", async () => {
  const s = await server();
  try {
    const out = await s.signup({ agent: "social" });
    assert.deepEqual(s.adds, [[PHONE, "social"]]);
    assert.equal(out.textTo, LINES.social);
    assert.equal(out.status, "invited");
    assert.deepEqual(s.sent.map((o) => [o.persona, o.handle, o.card ? "card" : "text"]), [["social", `dm:${PHONE}`, "text"], ["social", `dm:${PHONE}`, "card"]]);
    assert.equal(s.sent[1].card?.phone, LINES.social);
    const u = s.store.user(PHONE);
    assert.deepEqual([u.greeted, u.poolLines], [["social"], { [PROJECT.social]: LINES.social }]);
    // Their "hey" afterwards is a normal message to Sunny, not a second hello.
    const hey = await s.engine.handle({ persona: "social", lineKnown: true, kind: "dm", sender: PHONE, text: "hey", handle: "sunny-space", messageId: "m1" });
    assert.equal(hey.length, 1);
    assert.ok(!hey[0].card);
  } finally {
    s.close();
  }
});

test("if the first text can't go out yet, the sign-up stays 'added' and their own 'hey' gets the hello", async () => {
  const s = await server({ failSend: true });
  try {
    const out = await s.signup({ agent: "social" });
    assert.equal(out.status, "added");
    assert.deepEqual(s.store.user(PHONE).greeted ?? [], []);
    const hey = await s.engine.handle({ persona: "social", lineKnown: true, kind: "dm", sender: PHONE, text: "hey", handle: "sunny-space", messageId: "m1" });
    assert.ok(hey.some((o) => o.card));
    assert.deepEqual(s.store.user(PHONE).greeted, ["social"]);
  } finally {
    s.close();
  }
});

test("PHOTON_ADD_CAP: past the cap, sign-ups are saved as pending instead of added to Photon", async () => {
  const s = await server({ addCap: 0 });
  try {
    const out = await s.signup({ agent: "social" });
    assert.equal(out.status, "pending");
    assert.deepEqual(s.adds, []);
    assert.equal(s.sent.length, 0);
  } finally {
    s.close();
  }
});

test("own numbers: texting one agent's number greets only that agent, in that thread", async () => {
  const s = await server();
  try {
    s.store.saveUser({ phone: PHONE, name: "Sam", canvasLinked: false, onboardingStep: "done", signupStatus: "added", agents: ["academic", "financial", "social"], greeted: [] });
    const out = await s.engine.handle({ persona: "financial", lineKnown: true, kind: "dm", sender: PHONE, text: "hey", handle: "penny-space", messageId: "m1" });
    assert.ok(out.length >= 2);
    assert.ok(out.every((o) => o.persona === "financial" && o.handle === "penny-space"));
    assert.deepEqual(s.store.user(PHONE).greeted, ["financial"]);
  } finally {
    s.close();
  }
});

test("an agent's own intro failing (live Canvas down) still sends a hello, and the greeting isn't lost", async () => {
  const personas = loadPersonas();
  const dean = personas.get("academic")!;
  personas.set("academic", { ...dean, triggers: { ...dean.triggers, intro: async () => { throw new Error("canvas 503"); } } } as Persona);
  const store = new Store(null);
  const engine = new Engine({ personas, store, llm: new FakeLlm(), config: { names: NAMES, PRODUCT_NAME: "Suitemates", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 10 }, routerPrompt: "", log: () => {} });
  store.saveUser({ phone: PHONE, name: "Sam", canvasLinked: true, onboardingStep: "done", signupStatus: "added", agents: ["academic"], greeted: [] });
  const out = await engine.handle({ persona: "academic", kind: "dm", sender: PHONE, text: "hey", handle: "space-1", messageId: "m1" });
  assert.match(out[0].text, /i'm Dean/);
  assert.ok(out.some((o) => o.card));
  assert.deepEqual(store.user(PHONE).greeted, ["academic"]);
});

test("transport: an Outbound with via goes out on that agent's conversation, tagged with who's really talking", async () => {
  const env = {
    SOCIAL_PROJECT_ID: "p-s", SOCIAL_PROJECT_SECRET: "x", FINANCIAL_PROJECT_ID: "p-f", FINANCIAL_PROJECT_SECRET: "x", ACADEMIC_PROJECT_ID: "p-a", ACADEMIC_PROJECT_SECRET: "x",
  };
  const t = new SpectrumTransport(loadConfig(env)) as unknown as { spaces: Map<string, { id: string; send(t: unknown): Promise<unknown> }>; send(o: Outbound): Promise<void> };
  const sent: Record<string, unknown[]> = { social: [], financial: [] };
  for (const p of ["social", "financial"]) t.spaces.set(`${p}|dm:${PHONE}`, { id: p, send: async (x) => void sent[p].push(x) });
  await t.send({ persona: "financial", via: "social", handle: `dm:${PHONE}`, text: "that's $45 of your $300 😭" });
  assert.deepEqual(sent, { social: ["Penny: that's $45 of your $300 😭"], financial: [] });
  await t.send({ persona: "financial", handle: `dm:${PHONE}`, text: "roast" });
  assert.deepEqual(sent.financial, ["roast"], "on her own project Penny is untagged");
});
