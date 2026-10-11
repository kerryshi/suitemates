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
    },
  );
  assert.deepEqual(parseSignup({ phone: "9195550123", name: "" }, blank), { error: "Tell us your first name." });
});

async function server(token?: string) {
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
  const http = startHttp({ engine, transport, port: 0, token });
  await new Promise((r) => http.once("listening", r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { store, sent, base, post, close: () => http.close() };
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
    assert.deepEqual(await res.json(), { ok: true, name: "Sam", status: "pending" });
    assert.equal(s.sent.length, 0); // nobody is texted until we add them in Photon
    const list = (await (await fetch(s.base + "/admin/signups")).json()) as { users: { phone: string; signupStatus: string }[] };
    assert.deepEqual(list.users.map((u) => [u.phone, u.signupStatus]), [["+19195550123", "pending"]]);

    const intro = await s.post("/admin/intro", { phone: "+19195550123" });
    assert.deepEqual(await intro.json(), { sent: 6 });
    // Each persona says hi, then sends its contact card. Dean first.
    assert.deepEqual(s.sent.map((o) => [o.persona, o.card ? "card" : "text"]), [
      ["academic", "text"], ["academic", "card"], ["financial", "text"], ["financial", "card"], ["social", "text"], ["social", "card"],
    ]);
    assert.ok(s.sent.every((o) => o.handle === "dm:+19195550123"));
    assert.match(s.sent[0].text, /Hey Sam, I'm Dean\./); // Dean's own intro trigger
    assert.match(s.sent[2].text, /^hey, I'm Penny\./); // default until Penny writes one
    assert.deepEqual(s.sent[1].card, {
      name: "Dean Suitemates", photo: "docs/avatars/dean.png", phone: undefined, note: "Dean handles school in Suitemates.",
    });
    assert.equal(s.sent[5].card?.photo, "docs/avatars/sunny.png");
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
