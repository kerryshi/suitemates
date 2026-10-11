// Penny for every sign-up: her own intro, a demo ledger per person, and the website's "try Penny" purchases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

// Before anything imports personas/financial/nessie.ts: a throwaway demo ledger, never the live one.
process.env.MOCK_PURCHASES_FILE = join(mkdtempSync(join(tmpdir(), "penny-")), "purchases.json");
const { Engine } = await import("../core/engine.ts");
const { Store } = await import("../core/store.ts");
const { loadPersonas } = await import("../core/personas.ts");
const { FakeLlm } = await import("../core/llm/fake.ts");
const { startHttp } = await import("../core/http.ts");

const SAM = "+19195550123";
const ALEX = "+19195550124";

async function setup() {
  const store = new Store(null);
  const engine = new Engine({
    personas: loadPersonas(),
    store,
    llm: new FakeLlm(),
    config: { names: { academic: "Dean", financial: "Penny", social: "Sunny" }, PRODUCT_NAME: "Suitemates", mock: true },
    log: () => {},
  });
  const http = startHttp({ engine, transport: { start: async () => {}, send: async () => {} }, port: 0, addUser: async () => ({ ok: true, line: "+16465550177" }) });
  await new Promise((r) => http.once("listening", r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, string> };
  };
  const hey = (phone: string) => engine.handle({ persona: "financial", sender: phone, text: "hey Penny", handle: `h${phone}`, messageId: `m${Math.random()}` });
  return { store, engine, post, hey, close: () => http.close() };
}

test("Penny's intro: hello, her card, then where the month stands", async () => {
  const s = await setup();
  try {
    await s.post("/signup", { agent: "financial", name: "Sam", phone: SAM, budget: "600", goal: "spring break, $400" });
    const out = await s.hey(SAM);
    assert.deepEqual(out.map((o) => (o.card ? "card" : "text")), ["text", "card", "text"]);
    assert.match(out[0].text, /i'm Penny 💸/);
    assert.match(out[2].text, /this month: \$600\.00 budget, \$[\d.]+ left, about \$[\d.]+ a day\. saving for: spring break, \$400\./);
  } finally {
    s.close();
  }
});

test("try Penny: only after her hello; a purchase lands in that person's ledger and she roasts it", async () => {
  const s = await setup();
  try {
    assert.equal((await s.post("/try/financial", { phone: SAM, action: "doordash" })).status, 403); // not signed up
    await s.post("/signup", { agent: "financial", name: "Sam", phone: SAM, budget: "600" });
    assert.match((await s.post("/try/financial", { phone: SAM, action: "doordash" })).body.error, /Say hey to Penny/);
    await s.hey(SAM);
    assert.equal((await s.post("/try/financial", { phone: SAM, action: "nope" })).status, 400);

    const ok = await s.post("/try/financial", { phone: SAM, action: "doordash" });
    assert.equal(ok.status, 200);
    assert.match(ok.body.note, /^Bought: \$23\.40 DoorDash at 3 AM\. Penny will text you/);
    const roast = await s.engine.trigger("financial", "watch");
    assert.equal(roast.length, 1);
    assert.equal(roast[0].handle, `dm:${SAM}`);
    assert.match(roast[0].text, /DoorDash \(Cosmic Cantina\)/);
  } finally {
    s.close();
  }
});

test("one person's demo purchases never show up for someone else", async () => {
  const s = await setup();
  try {
    for (const p of [SAM, ALEX]) {
      await s.post("/signup", { agent: "financial", name: "X", phone: p, budget: "600" });
      await s.hey(p);
    }
    await s.engine.trigger("financial", "watch"); // both baselined
    await s.post("/try/financial", { phone: ALEX, action: "concert" });
    const out = await s.engine.trigger("financial", "watch");
    assert.deepEqual(out.map((o) => o.handle), [`dm:${ALEX}`]); // Alex's concert, not Sam's
    assert.match(out[0].text, /Ticketmaster/);
  } finally {
    s.close();
  }
});

test("Penny tells the other agents how the month is going, never the balance", async () => {
  const s = await setup();
  try {
    await s.post("/signup", { agent: "financial", name: "Sam", phone: SAM, budget: "600" });
    const line = await s.engine.d.personas.get("financial")!.context!(s.engine.ctx("financial", s.store.user(SAM)));
    assert.match(line, /^(spending is on track|spending is a bit fast|money is tight|over budget) this month/);
    assert.doesNotMatch(line, /\$|\d/);
  } finally {
    s.close();
  }
});
