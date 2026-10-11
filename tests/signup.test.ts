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
import { lineFor, safeName, type AddUser } from "../core/photon-users.ts";

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
    assert.deepEqual(await intro.json(), { sent: 8 });
    // Each persona says hi, then sends its contact card; Dean then names his first deadline. Dean first.
    assert.deepEqual(s.sent.map((o) => [o.persona, o.card ? "card" : "text"]), [
      ["academic", "text"], ["academic", "card"], ["academic", "text"], ["financial", "text"], ["financial", "card"], ["financial", "text"], ["social", "text"], ["social", "card"],
    ]);
    assert.ok(s.sent.every((o) => o.handle === "dm:+19195550123"));
    assert.match(s.sent[0].text, /Hey Sam, I'm Dean\./); // Dean's own intro trigger
    assert.match(s.sent[3].text, /hiii Sam, i'm Penny 💸.*DoorDash\.$/); // Penny's own intro, then her card, then the month
    assert.deepEqual(s.sent[1].card, {
      name: "Dean Suitemates", photo: "docs/avatars/dean.png", phone: undefined, note: "Dean handles school in Suitemates.",
    });
    assert.equal(s.sent[7].card?.photo, "docs/avatars/sunny.png");
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
      ["academic", "text"], ["academic", "card"], ["academic", "text"], ["financial", "text"], ["financial", "card"], ["financial", "text"], ["social", "text"], ["social", "card"],
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
