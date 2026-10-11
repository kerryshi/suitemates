// /admin* and /demo/trigger must never be public through the tunnel without DEMO_TOKEN.
// Before this, `authed = !opts.token || …` let anyone holding a QR code's URL list every sign-up.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import { FakeLlm } from "../core/llm/fake.ts";
import { startHttp } from "../core/http.ts";
import type { Outbound } from "../core/types.ts";

async function server(token?: string) {
  const engine = new Engine({
    personas: loadPersonas(),
    store: new Store(null),
    llm: new FakeLlm(),
    config: { names: { academic: "Dean", financial: "Penny", social: "Sunny" }, PRODUCT_NAME: "Suitemates", mock: true },
    log: () => {},
  });
  const transport = { start: async () => {}, send: async (_o: Outbound) => {} };
  const http = startHttp({ engine, transport, port: 0, token, addUser: async () => ({ ok: false, error: "off in tests" }) });
  await new Promise((r) => http.once("listening", r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return { base, close: () => http.close() };
}

// What a request through the Cloudflare tunnel carries.
const TUNNEL = { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7" };
const trigger = (base: string, headers: Record<string, string> = {}, token?: string) =>
  fetch(`${base}/demo/trigger${token ? `?token=${token}` : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ persona: "academic", name: "morning_due", phone: "+19195550001" }),
  });

test("no DEMO_TOKEN: admin and the demo trigger refuse tunneled requests but still work locally", async () => {
  const s = await server();
  try {
    assert.equal((await fetch(s.base + "/admin/signups", { headers: TUNNEL })).status, 403);
    assert.equal((await trigger(s.base, TUNNEL)).status, 403);
    assert.equal((await fetch(s.base + "/admin/signups")).status, 200);
    assert.equal((await trigger(s.base)).status, 200);
    assert.equal((await fetch(s.base + "/health", { headers: TUNNEL })).status, 200);
  } finally {
    s.close();
  }
});

test("with DEMO_TOKEN: the right token works through the tunnel, a wrong or missing one doesn't", async () => {
  const s = await server("s3cret");
  try {
    assert.equal((await fetch(s.base + "/admin/signups?token=s3cret", { headers: TUNNEL })).status, 200);
    assert.equal((await trigger(s.base, TUNNEL, "s3cret")).status, 200);
    assert.equal((await fetch(s.base + "/admin/signups?token=nope", { headers: TUNNEL })).status, 403);
    assert.equal((await fetch(s.base + "/admin/signups")).status, 403);
  } finally {
    s.close();
  }
});

test("npm run tunnel refuses to start without DEMO_TOKEN", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const r = spawnSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), "scripts/tunnel.ts"], {
    cwd: root,
    env: { ...process.env, DEMO_TOKEN: "" },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /DEMO_TOKEN/);
  assert.doesNotMatch(r.stdout, /starting cloudflared/);
});
