// Social tools over an in-memory board. Run: npx tsx --test personas/social/*.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../core/types.ts";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keywordRoute } from "../../core/router.ts";
import { loadPersonas } from "../../core/personas.ts";
import { findActivities, loadBoard, saveBoard, useBoardFile } from "./board.ts";
import { tools } from "./tools.ts";

const ME = "+19195550001"; // Kerry in mock/students.json; not signed up for anything
const NEW = "+19195550999"; // not in the mock at all

const ctx = (phone = ME, name?: string): Ctx => {
  const kv: Record<string, unknown> = {};
  return {
    user: { phone, name, canvasLinked: false, onboardingStep: "done" },
    mock: true,
    now: new Date(),
    kv: { get: <T>(k: string) => kv[k] as T | undefined, set: (k, v) => void (kv[k] = v) },
    log: () => {},
  };
};
const run = (name: string, args: Record<string, unknown>, c = ctx()) => tools.find((t) => t.name === name)!.run(args, c);
const signups = (id: string) => loadBoard().activities.find((a) => a.id === id)?.signups ?? [];

beforeEach(() => useBoardFile(null));

test("join_activity adds the user and names who they matched with", async () => {
  const out = await run("join_activity", { activity: "beach trip" });
  assert.match(out, /^Joined\. Beach trip to Wrightsville/);
  assert.match(out, /Matched with: Ismail, Abdallah, Priya/);
  assert.ok(signups("beach").includes(ME));
});

test("joining twice says already in and doesn't duplicate", async () => {
  await run("join_activity", { activity: "soccer" });
  const out = await run("join_activity", { activity: "Soccer" });
  assert.match(out, /^Already in\./);
  assert.equal(signups("soccer").filter((p) => p === ME).length, 1);
});

test("join_activity with no or unknown activity lists the plans instead of guessing", async () => {
  assert.match(await run("join_activity", {}), /Which plan\?[\s\S]*Boba run/);
  assert.match(await run("join_activity", { activity: "skydiving" }), /No plan matches "skydiving"[\s\S]*start_activity/);
  assert.equal(signups("beach").includes(ME), false);
});

test("leave_activity removes the user", async () => {
  await run("join_activity", { activity: "boba" });
  assert.match(await run("leave_activity", { activity: "boba" }), /^Left\./);
  assert.equal(signups("boba").includes(ME), false);
  assert.match(await run("leave_activity", { activity: "boba" }), /wasn't signed up/);
});

test("start_activity creates a new plan but refuses a duplicate", async () => {
  assert.match(await run("start_activity", { name: "Pickup soccer", when: "Sunday" }), /Similar plan already exists: Pickup soccer at Hooker Fields/);
  const out = await run("start_activity", { name: "Tennis at Cobb courts", when: "Sunday 2 PM", cost: 0 });
  assert.match(out, /^Started\. Tennis at Cobb courts, Sunday 2 PM: 1 in \(you\)/);
  assert.deepEqual(signups("tennis-cobb-courts"), [ME]);
  assert.match(await run("start_activity", { name: "Tennis" }), /Need a plan name and a day/);
});

test("find_matches ranks the crew by plans in common and suggests their other plans", async () => {
  await run("join_activity", { activity: "beach" });
  await run("join_activity", { activity: "soccer" });
  const out = await run("find_matches", {});
  const lines = out.split("\n");
  assert.match(lines[0], /^Abdallah: 2 plans in common/);
  assert.match(lines[1], /^Priya: 2 plans in common/);
  assert.match(out, /Plans their crew is in that they aren't:\nBoba run on Franklin St, Friday 8 PM: Sam/);
});

test("find_matches by interest, and with no plans yet", async () => {
  assert.match(await run("find_matches", { interest: "soccer" }), /Pickup soccer.*Abdallah, Priya, Sam \(user not in yet\)/);
  assert.match(await run("find_matches", {}), /isn't in any plans yet\. Most popular:\nBeach trip/);
});

test("two new phones joining the same plan are matched with each other by name", async () => {
  await run("start_activity", { name: "Frisbee on the quad", when: "Friday 5 PM" }, ctx(ME, "Kerry"));
  const out = await run("join_activity", { activity: "frisbee" }, ctx(NEW, "Jordan"));
  assert.match(out, /Matched with: Kerry\./);
  assert.match(await run("find_matches", {}, ctx(ME, "Kerry")), /^Jordan: 1 plan in common \(Frisbee on the quad\)/);
});

test("someone with no name shows as 'someone new' (no phone digits) and the model is told to ask", async () => {
  const out = await run("join_activity", { activity: "boba" }, ctx(NEW));
  assert.match(out, /Ask for their first name and pass it as my_name/);
  assert.match(await run("list_signups", { activity: "boba" }), /\(Sam, someone new\)/);
  assert.doesNotMatch(await run("list_signups", { activity: "boba" }), /0999/);
});

test("my_name names a new phone for everyone else", async () => {
  const out = await run("join_activity", { activity: "boba", my_name: "Jordan" }, ctx(NEW));
  assert.doesNotMatch(out, /my_name/);
  assert.match(await run("list_signups", { activity: "boba" }), /\(Sam, Jordan\)/);
});

test("start_activity only blocks real duplicates, and new_plan overrides", async () => {
  for (const name of ["Sunday brunch", "Pickup basketball", "Friday movie night", "Saturday hike", "Beach volleyball"]) {
    assert.match(await run("start_activity", { name, when: "Sunday 2 PM" }), /^Started\./, name);
  }
  assert.match(await run("start_activity", { name: "Boba run", when: "Friday" }), /Similar plan already exists: Boba run/);
  assert.match(await run("start_activity", { name: "Boba run", when: "Monday", new_plan: true }), /^Started\. Boba run, Monday/);
});

test("findActivities: day words must agree, trip/run still count, no double counting", () => {
  const b = loadBoard();
  const ids = (q: string) => findActivities(b, q).map((a) => a.id);
  assert.deepEqual(ids("soccer saturday"), []);
  assert.deepEqual(ids("soccer sunday"), ["soccer"]);
  assert.deepEqual(ids("the food run"), ["boba"]);
  assert.deepEqual(ids("the trip"), ["beach"]);
  assert.deepEqual(ids("the saturday one"), ["beach"]);
  assert.deepEqual(ids("saturday hike"), []);
});

test("a corrupt board file is set aside and reseeded; SOCIAL_FILE is read lazily", () => {
  const dir = mkdtempSync(join(tmpdir(), "social-"));
  const file = join(dir, "social.json");
  useBoardFile(); // back to SOCIAL_FILE / default
  const prev = process.env.SOCIAL_FILE;
  process.env.SOCIAL_FILE = file;
  try {
    writeFileSync(file, '{"students": [');
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(loadBoard().activities.length, 3);
    } finally {
      console.warn = warn;
    }
    assert.ok(readdirSync(dir).includes("social.json.bad"));
    const b = loadBoard();
    b.activities[0].signups.push(ME);
    saveBoard(b);
    assert.ok(loadBoard().activities[0].signups.includes(ME));
    assert.deepEqual(readdirSync(dir).sort(), ["social.json", "social.json.bad"]);
  } finally {
    if (prev === undefined) delete process.env.SOCIAL_FILE;
    else process.env.SOCIAL_FILE = prev;
  }
});

test("keyword routing wakes Social for dropping out and boba, still nobody for small talk", () => {
  const personas = loadPersonas();
  assert.ok(keywordRoute("I'm out for boba", personas).includes("social"));
  assert.ok(keywordRoute("can't make it to soccer", personas).includes("social"));
  assert.deepEqual(keywordRoute("lol ok", personas), []);
});
