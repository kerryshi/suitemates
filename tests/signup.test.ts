// Web sign-up → pending → /admin/intro texts first. Real HTTP server on a free port, fake transport and LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import { FakeLlm } from "../core/llm/fake.ts";
import { startHttp } from "../core/http.ts";
import { normalizePhone, parseSignup } from "../core/signup.ts";
import type { Outbound } from "../core/types.ts";
import { lineFor, photonCliAddUser, photonProjectFor, safeName, type AddUser } from "../core/photon-users.ts";
import { introTexts } from "../core/signup.ts";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("normalizePhone accepts US formats only", () => {
  assert.equal(normalizePhone("919-555-0177"), "+19195550177");
  assert.equal(normalizePhone("(919) 555 0177"), "+19195550177");
  assert.equal(normalizePhone("+1 919 555 0177"), "+19195550177");
  assert.equal(normalizePhone("555-0177"), undefined);
  assert.equal(normalizePhone("+44 20 7946 0958"), undefined);
});

test("parseSignup fills the profile, skips text onboarding, and needs a name", () => {
  const blank = { phone: "+19195550123", canvasLinked: false, onboardingStep: 0 as const };
  const r = parseSignup({ phone: "919-555-0123", name: " Sam ", budget: "$700", goal: "", interests: ["Gym", "food"] }, blank, new Date(0));
  assert.ok("user" in r);
  assert.deepEqual(
    { ...r.user },
    {
      phone: "+19195550123", name: "Sam", budgetMonthly: 700, savingsGoal: "an emergency fund", interests: ["gym", "food"],
      canvasLinked: true, onboardingStep: "done", signupStatus: "pending", signedUpAt: "1970-01-01T00:00:00.000Z",
      agents: ["academic", "financial", "social"],
    },
  );
  assert.deepEqual(parseSignup({ phone: "9195550123", name: "" }, blank), { error: "Tell us your first name." });
});

async function server(token?: string, addUser: AddUser = async () => ({ ok: false, error: "off in tests" })) {
  const store = new Store(null);
  const sent: Outbound[] = [];
  const engine = new Engine({
    personas: loadPersonas(),
    store,
    llm: new FakeLlm(),
    config: { names: { academic: "Dean", financial: "Penny", social: "Sunny" }, PRODUCT_NAME: "Suitemates", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 10 },
    routerPrompt: "",
    log: () => {},
  });
  const transport = { start: async () => {}, send: async (o: Outbound) => void sent.push(o) };
  const http = startHttp({ engine, transport, port: 0, token, addUser });
  await new Promise((r) => http.once("listening", r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { store, sent, base, post, engine, close: () => http.close() };
}

test("sign up → pending → admin sends Dean's intro first → invited", async () => {
  const s = await server();
  try {
    const page = await fetch(s.base + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Suitemates<\/title>/);
    assert.equal((await fetch(s.base + "/avatars/dean.png")).headers.get("content-type"), "image/png");
    assert.equal((await fetch(s.base + "/avatars/..%2F..%2F.env.png")).status, 404);

    const res = await s.post("/signup", { name: "Sam", phone: "919-555-0123", budget: "600", interests: ["gym"] });
    const out = (await res.json()) as Record<string, unknown>;
    assert.deepEqual({ ...out, calendar: undefined }, { ok: true, name: "Sam", status: "pending", agents: ["academic", "financial", "social"], calendar: undefined });
    assert.match(String(out.calendar), /\/cal\/[\w-]{24}\.ics$/);
    assert.equal(s.sent.length, 0); // nobody is texted until we add them in Photon
    const list = (await (await fetch(s.base + "/admin/signups")).json()) as { users: { phone: string; signupStatus: string }[] };
    assert.deepEqual(list.users.map((u) => [u.phone, u.signupStatus]), [["+19195550123", "pending"]]);

    const intro = await s.post("/admin/intro", { phone: "+19195550123" });
    assert.deepEqual(await intro.json(), { sent: 7 });
    // Each persona says hi, then sends its contact card; Dean then names his first deadline. Dean first.
    assert.deepEqual(s.sent.map((o) => [o.persona, o.card ? "card" : "text"]), [
      ["academic", "text"], ["academic", "card"], ["academic", "text"], ["financial", "text"], ["financial", "card"], ["social", "text"], ["social", "card"],
    ]);
    assert.ok(s.sent.every((o) => o.handle === "dm:+19195550123"));
    assert.match(s.sent[0].text, /Hey Sam, I'm Dean\./); // Dean's own intro trigger
    assert.match(s.sent[3].text, /^hey, I'm Penny\./); // default until Penny writes one
    assert.deepEqual(s.sent[1].card, {
      name: "Dean Suitemates", photo: "docs/avatars/dean.png", phone: undefined, note: "Dean handles school in Suitemates.",
    });
    assert.equal(s.sent[6].card?.photo, "docs/avatars/sunny.png");
    assert.equal(s.store.user("+19195550123").signupStatus, "invited");
    assert.equal(s.store.user("+19195550123").onboardingStep, "done"); // their first reply goes straight to the persona
  } finally {
    s.close();
  }
});

test("bad sign-ups are rejected; admin needs DEMO_TOKEN when set; intro only for signed-up phones", async () => {
  const s = await server("secret");
  try {
    assert.equal((await s.post("/signup", { name: "Sam", phone: "12345" })).status, 400);
    assert.equal((await fetch(s.base + "/signup")).status, 405);
    assert.equal((await fetch(s.base + "/admin/signups")).status, 403);
    assert.equal((await fetch(s.base + "/admin/signups?token=secret")).status, 200);
    assert.equal((await s.post("/admin/intro", { phone: "9195550199", token: "secret" })).status, 404);
    assert.equal(s.sent.length, 0);
  } finally {
    s.close();
  }
});

test("a Photon refusal leaves the sign-up pending", async () => {
  const s = await server();
  const engineSend = s.sent.push;
  try {
    await s.post("/signup", { name: "Sam", phone: "9195550123" });
    s.sent.push = () => {
      throw new Error("[spectrum-imessage] Target not allowed for this project");
    };
    const res = await s.post("/admin/intro", { phone: "9195550123" });
    assert.equal(res.status, 500);
    assert.match(((await res.json()) as { error: string }).error, /Target not allowed/);
    assert.equal(s.store.user("+19195550123").signupStatus, "pending");
  } finally {
    s.sent.push = engineSend;
    s.close();
  }
});

test("focus and 'a win' are saved (unknown focus dropped) and reach every persona's prompt", async () => {
  const blank = { phone: "+19195550123", canvasLinked: false, onboardingStep: 0 as const };
  const r = parseSignup({ phone: "9195550123", name: "Sam", focus: "social", win: " 3.5 GPA and a beach trip " }, blank);
  assert.ok("user" in r);
  assert.equal(r.user.focus, "social");
  assert.equal(r.user.win, "3.5 GPA and a beach trip");
  const junk = parseSignup({ phone: "9195550123", name: "Sam", focus: "chaos" }, blank);
  assert.ok("user" in junk && junk.user.focus === undefined);

  const { respond } = await import("../core/agent.ts");
  let system = "";
  await respond({
    persona: loadPersonas().get("academic")!,
    ctx: { user: r.user, mock: true, now: new Date(), kv: { get: () => undefined, set: () => {} }, log: () => {} },
    llm: { name: "spy", chat: async (req) => ((system = req.system), { text: "ok" }), json: async () => "{}" },
    history: [],
    text: "hi",
    setting: "dm",
    product: "Suitemates",
    names: { academic: "Dean", financial: "Penny", social: "Sunny" },
  });
  assert.match(system, /mostly trying to: meet people; a win would be: "3\.5 GPA and a beach trip"\./);
});

test("QR flow: sign up → added to Photon → page gets the number → their 'hey' gets every intro + card", async () => {
  const calls: [string, string][] = [];
  const s = await server(undefined, async (phone, name) => (calls.push([phone, name]), { ok: true, line: "+16465550177" }));
  try {
    assert.equal((await fetch(s.base + "/qr")).status, 200); // old poster URL → landing
    const res = await s.post("/signup", { name: "Sam", phone: "(919) 555-0123" });
    const out = (await res.json()) as Record<string, unknown>;
    assert.deepEqual([out.status, out.textTo], ["added", "+16465550177"]);
    assert.deepEqual(calls, [["+19195550123", "Sam"]]);
    assert.equal(s.sent.length, 0); // we wait for their "hey"

    const hey = await s.engine.handle({ persona: "academic", kind: "dm", sender: "+19195550123", text: "hey", handle: "space-1", messageId: "m1" });
    assert.deepEqual(hey.map((o) => [o.persona, o.card ? "card" : "text"]), [
      ["academic", "text"], ["academic", "card"], ["academic", "text"], ["financial", "text"], ["financial", "card"], ["social", "text"], ["social", "card"],
    ]);
    assert.ok(hey.every((o) => o.handle === "space-1")); // answered in the conversation they started
    assert.equal(s.store.user("+19195550123").signupStatus, "invited");

    const next = await s.engine.handle({ persona: "academic", kind: "dm", sender: "+19195550123", text: "what's due?", handle: "space-1", messageId: "m2" });
    assert.equal(next.length, 1); // after the intros, a normal reply
    assert.equal((await s.post("/signup", { name: "Sam", phone: "9195550123" }).then((r) => r.json())).status, "invited");
    assert.equal(calls.length, 1); // signing up again doesn't re-add
  } finally {
    s.close();
  }
});

test("if Photon can't add them, the sign-up stays pending for /admin", async () => {
  const s = await server(undefined, async () => ({ ok: false, error: "photon: not logged in" }));
  try {
    const out = (await (await s.post("/signup", { name: "Sam", phone: "9195550123" })).json()) as { status: string };
    assert.equal(out.status, "pending");
    assert.equal(s.store.user("+19195550123").signupStatus, "pending");
  } finally {
    s.close();
  }
});

test("Photon helpers: pool line from the users list, CLI-safe names", () => {
  const list = JSON.stringify({ data: [
    { id: "u1", phone: "+19195550000", line: { phone: "+16465550000" } },
    { id: "u2", firstName: "Sam", phoneNumber: "+19195550123", textsOn: "+16465550177" },
  ] });
  assert.equal(lineFor(list, "+19195550123"), "+16465550177");
  assert.equal(lineFor(list, "+19195559999"), undefined);
  assert.equal(lineFor("not json", "+19195550123"), undefined);
  assert.equal(safeName("Sam"), "Sam");
  assert.equal(safeName("Zoë O'Neil"), "Zoë O'Neil");
  assert.equal(safeName('Sam"; rm -rf /'), "Friend");
});

test("lineFor reads Photon's real shape: users list array and a single user from add", () => {
  const user = { id: "u", type: "shared", phoneNumber: "+19195550123", assignedPhoneNumber: "+16465550177", meta: { opt_in: true } };
  assert.equal(lineFor(JSON.stringify([{ phoneNumber: "+19195550000", assignedPhoneNumber: "+16465550000" }, user]), "+19195550123"), "+16465550177");
  assert.equal(lineFor(JSON.stringify(user), "+19195550123"), "+16465550177");
});

test("onList: someone already in Photon is recognised (so we never re-add and overwrite them)", async () => {
  const { onList } = await import("../core/photon-users.ts");
  const list = JSON.stringify([{ phoneNumber: "+19195550123", assignedPhoneNumber: "+16465550177" }]);
  assert.equal(onList(list, "+19195550123"), true);
  assert.equal(onList(list, "+19195550999"), false);
  assert.equal(onList("nope", "+19195550123"), false);
});

const PER_AGENT = {
  ACADEMIC_PROJECT_ID: "proj-dean", ACADEMIC_PROJECT_SECRET: "s1",
  FINANCIAL_PROJECT_ID: "proj-penny", FINANCIAL_PROJECT_SECRET: "s2",
  SOCIAL_PROJECT_ID: "proj-sunny", SOCIAL_PROJECT_SECRET: "s3",
};

// Temporarily set env vars for one test (restored after, so other tests see the single-project setup).
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test("one Photon project per agent: each agent's QR adds them to that agent's project and texts that agent's number", async () => {
  await withEnv(PER_AGENT, async () => {
    const calls: [string, string | undefined][] = [];
    const lines = { academic: "+16465550001", financial: "+16465550002", social: "+16465550003" } as const;
    const s = await server(undefined, async (phone, _name, agent) => (calls.push([phone, agent]), { ok: true, line: lines[agent!] }));
    try {
      const dean = (await (await s.post("/signup", { agent: "academic", name: "Sam", phone: "9195550123" })).json()) as Record<string, unknown>;
      assert.deepEqual([dean.status, dean.textTo], ["added", "+16465550001"]);
      // Later, Penny's QR: already "added", but Penny's project doesn't know them yet → added there too.
      const penny = (await (await s.post("/signup", { agent: "financial", name: "Sam", phone: "9195550123", budget: "600" })).json()) as Record<string, unknown>;
      assert.equal(penny.textTo, "+16465550002");
      const sunny = (await (await s.post("/signup", { agent: "social", name: "Sam", phone: "9195550123", interests: ["food"] })).json()) as Record<string, unknown>;
      assert.equal(sunny.textTo, "+16465550003");
      assert.deepEqual(calls, [["+19195550123", "academic"], ["+19195550123", "financial"], ["+19195550123", "social"]]);
      assert.deepEqual(s.store.user("+19195550123").poolLines, { "proj-dean": lines.academic, "proj-penny": lines.financial, "proj-sunny": lines.social });
      // Signing up with Penny again doesn't call Photon again.
      await s.post("/signup", { agent: "financial", name: "Sam", phone: "9195550123", budget: "700" });
      assert.equal(calls.length, 3);
      // Each agent's contact card shows that agent's own number for this person.
      const cards = (await introTexts(s.engine, "+19195550123")).filter((o) => o.card).map((o) => [o.persona, o.card!.phone]);
      assert.deepEqual(cards, [["academic", "+16465550001"], ["financial", "+16465550002"], ["social", "+16465550003"]]);
    } finally {
      s.close();
    }
  });
});

test("one shared project (no <AGENT>_PROJECT_ID): unchanged, one add and one number for every agent", async () => {
  await withEnv({ ACADEMIC_PROJECT_ID: undefined, FINANCIAL_PROJECT_ID: undefined, SOCIAL_PROJECT_ID: undefined }, async () => {
    const calls: (string | undefined)[] = [];
    const s = await server(undefined, async (_p, _n, agent) => (calls.push(agent), { ok: true, line: "+16465550177" }));
    try {
      await s.post("/signup", { agent: "academic", name: "Sam", phone: "9195550123" });
      const sunny = (await (await s.post("/signup", { agent: "social", name: "Sam", phone: "9195550123" })).json()) as Record<string, unknown>;
      assert.equal(sunny.textTo, "+16465550177");
      assert.equal(calls.length, 1); // the shared project already has them
      assert.equal(s.store.user("+19195550123").poolLines, undefined);
    } finally {
      s.close();
    }
  });
});

test("photonProjectFor: an agent's own project and token, else the shared ones", async () => {
  await withEnv({ SPECTRUM_PROJECT_ID: "shared", PHOTON_API_TOKEN: "shared-token", FINANCIAL_PROJECT_ID: "penny", FINANCIAL_PROJECT_SECRET: "x", FINANCIAL_PHOTON_API_TOKEN: "penny-token", SOCIAL_PROJECT_ID: "half", SOCIAL_PROJECT_SECRET: undefined, SOCIAL_PHOTON_API_TOKEN: undefined }, async () => {
    assert.deepEqual(photonProjectFor("financial"), { project: "penny", token: "penny-token", own: true });
    // Only an ID, no secret: the transport serves Sunny on the shared app, so sign-ups go there too.
    assert.deepEqual(photonProjectFor("social"), { project: "shared", token: "shared-token", own: false });
    assert.deepEqual(photonProjectFor(), { project: "shared", token: "shared-token", own: false });
  });
});

test("the real CLI call goes to the chosen agent's project with that agent's token", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "photon-"));
  const log = join(dir, "calls.txt");
  // A stand-in `photon` CLI: records its arguments; `users list` → nobody yet; `users add` → their assigned number.
  writeFileSync(
    join(dir, "photon"),
    `#!/bin/sh\necho "$@" >> "${log}"\ncase "$*" in *" list "*) echo '[]';; *) echo '{"phoneNumber":"+19195550123","assignedPhoneNumber":"+16465550002"}';; esac\n`,
  );
  chmodSync(join(dir, "photon"), 0o755);
  await withEnv({ PATH: `${dir}:${process.env.PATH}`, PHOTON_AUTO_ADD: "1", SPECTRUM_PROJECT_ID: "shared", PHOTON_API_TOKEN: "shared-token", FINANCIAL_PROJECT_ID: "penny-proj", FINANCIAL_PROJECT_SECRET: "x", FINANCIAL_PHOTON_API_TOKEN: "penny-token" }, async () => {
    const out = await photonCliAddUser("+19195550123", "Sam", "financial");
    assert.deepEqual(out, { ok: true, line: "+16465550002" });
    const calls = readFileSync(log, "utf8").trim().split("\n");
    assert.match(calls[0], /^spectrum users list -p penny-proj --json -t penny-token$/);
    assert.match(calls[1], /^spectrum users add --phone \+19195550123 --first-name Sam .* -p penny-proj --json -t penny-token$/);
  });
});

test("review: if an agent's add fails, its sign-up is pending and never points at another project's number", async () => {
  await withEnv({ ...PER_AGENT, POOL_NUMBER: "+16460000000" }, async () => {
    const s = await server(undefined, async (_p, _n, agent) => (agent === "financial" ? { ok: false, error: "401" } : { ok: true, line: "+16465550001" }));
    try {
      await s.post("/signup", { agent: "academic", name: "Sam", phone: "9195550123" });
      const penny = (await (await s.post("/signup", { agent: "financial", name: "Sam", phone: "9195550123" })).json()) as Record<string, unknown>;
      assert.deepEqual([penny.status, penny.textTo], ["pending", undefined]); // the page shows "we'll add you", no dead number
    } finally {
      s.close();
    }
  });
});

test("review: a contact card never shows the old shared-project number for an agent on its own project", async () => {
  await withEnv(PER_AGENT, async () => {
    const s = await server(undefined, async (_p, _n, agent) => (agent === "academic" ? { ok: true, line: "+16465550001" } : { ok: false }));
    try {
      s.store.saveUser({ ...s.store.user("+19195550123"), poolLine: "+16469999999" }); // signed up before this fix
      await s.post("/signup", { agent: "academic", name: "Sam", phone: "9195550123" });
      const cards = (await introTexts(s.engine, "+19195550123")).filter((o) => o.card).map((o) => [o.persona, o.card!.phone]);
      assert.deepEqual(cards, [["academic", "+16465550001"], ["financial", undefined], ["social", undefined]]);
    } finally {
      s.close();
    }
  });
});

test("review: a changed project id means not added there yet, so the next sign-up adds them again", async () => {
  const calls: string[] = [];
  const s = await server(undefined, async (_p, _n, agent) => (calls.push(process.env.FINANCIAL_PROJECT_ID!), { ok: true, line: agent === "financial" ? `+1646555${calls.length}000` : "+16465550001" }));
  try {
    await withEnv(PER_AGENT, async () => void (await s.post("/signup", { agent: "financial", name: "Sam", phone: "9195550123" })));
    await withEnv({ ...PER_AGENT, FINANCIAL_PROJECT_ID: "proj-penny-2" }, async () => {
      const out = (await (await s.post("/signup", { agent: "financial", name: "Sam", phone: "9195550123" })).json()) as Record<string, unknown>;
      assert.deepEqual(calls, ["proj-penny", "proj-penny-2"]);
      assert.equal(out.textTo, "+16465552000");
    });
  } finally {
    s.close();
  }
});
