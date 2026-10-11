// The shared calendar feed: each agent's items, private per-student link, valid iCalendar for Google Calendar.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import { FakeLlm } from "../core/llm/fake.ts";
import { startHttp } from "../core/http.ts";
import { calToken, calUrl, toIcs } from "../core/calendar.ts";
import type { PersonaId } from "../core/types.ts";

test("toIcs: CRLF lines, escaped text, folded at 75 octets, one VEVENT per item", () => {
  const ics = toIcs(
    [{ id: "academic:a1", title: "STOR 435 PS6, due; really", start: new Date(Date.UTC(2026, 9, 10, 20, 30)), note: "x".repeat(100) }],
    "Suitemates · Sam",
    new Date(Date.UTC(2026, 9, 10, 12)),
  );
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /\r\nSUMMARY:STOR 435 PS6\\, due\\; really\r\n/);
  assert.match(ics, /\r\nDTSTART:20261010T203000Z\r\nDTEND:20261010T210000Z\r\n/); // 30 min default
  assert.match(ics, /\r\nUID:academic:a1@suitemates\r\n/);
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "every line folded");
  assert.match(ics, /\r\nDESCRIPTION:x+\r\n x+/); // continuation line starts with a space
});

test("calendar link is per phone, stable, and not the phone itself", () => {
  assert.equal(calToken("+19195550123"), calToken("+19195550123"));
  assert.notEqual(calToken("+19195550123"), calToken("+19195550124"));
  assert.match(calUrl("+19195550123"), /\/cal\/[\w-]{24}\.ics$/);
  assert.doesNotMatch(calUrl("+19195550123"), /9195550123/);
});

async function setup(agents: PersonaId[]) {
  const store = new Store(null);
  store.saveUser({ phone: "+19195550123", name: "Sam", canvasLinked: true, onboardingStep: "done", agents });
  const engine = new Engine({
    personas: loadPersonas(),
    store,
    llm: new FakeLlm(),
    config: { names: { academic: "Dean", financial: "Penny", social: "Sunny" }, PRODUCT_NAME: "Suitemates", mock: true },
    log: () => {},
  });
  const http = startHttp({ engine, transport: { start: async () => {}, send: async () => {} }, port: 0, addUser: async () => ({ ok: false }) });
  await new Promise((r) => http.once("listening", r));
  return { engine, base: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, close: () => http.close() };
}

test("the feed has Dean's deadlines and exams for a Dean user; a bad token is 404", async () => {
  const s = await setup(["academic"]);
  try {
    const res = await fetch(`${s.base}/cal/${calToken("+19195550123")}.ics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/calendar/);
    const ics = await res.text();
    assert.match(ics, /X-WR-CALNAME:Suitemates · Sam/);
    assert.match(ics, /SUMMARY:COMP 421 Project 1: Buffer Pool Manager due/);
    assert.match(ics, /SUMMARY:STOR 435 Midterm 2\r\n/); // exams aren't "due"
    assert.equal((await fetch(`${s.base}/cal/${"x".repeat(24)}.ics`)).status, 404);
  } finally {
    s.close();
  }
});

test("someone who only signed up with Sunny gets no school items; Dean's calendar_link tool hands out the link", async () => {
  const s = await setup(["social"]);
  try {
    const ics = await (await fetch(`${s.base}/cal/${calToken("+19195550123")}.ics`)).text();
    assert.doesNotMatch(ics, /COMP 421/);
    const tool = s.engine.d.personas.get("academic")!.tools.find((t) => t.name === "calendar_link")!;
    const out = await tool.run({}, s.engine.ctx("academic", s.engine.d.store.user("+19195550123")));
    assert.match(out, new RegExp(`/cal/${calToken("+19195550123")}\\.ics`));
    assert.match(out, /From URL/);
  } finally {
    s.close();
  }
});
