// Shared memory: any agent saves a short durable fact with the core `remember` tool; every agent reads all of a
// user's notes in its prompt (no extra call to read).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../core/engine.ts";
import { Store } from "../core/store.ts";
import { loadPersonas } from "../core/personas.ts";
import { FakeLlm } from "../core/llm/fake.ts";
import type { LlmClient, LlmMessage } from "../core/llm/client.ts";
import type { Inbound, PersonaId } from "../core/types.ts";

const names = { academic: "Dean", financial: "Penny", social: "Sunny" };

function setup(llm?: LlmClient) {
  const calls: { who: string; system: string; tools: string[] }[] = [];
  const spy: LlmClient = {
    name: "spy",
    async chat({ system, messages, tools }) {
      const who = /You are (\w+),/.exec(system)?.[1] ?? "?";
      calls.push({ who, system, tools: tools.map((t) => t.name) });
      const toolTurn = (messages.at(-1) as LlmMessage).role === "tool";
      if (who === "Penny" && !toolTurn && /vegetarian/.test(JSON.stringify(messages.at(-1)))) {
        return { toolCalls: [{ name: "remember", args: { note: "vegetarian, no car" } }, { name: "get_recent_purchases", args: {} }] };
      }
      return { text: `${who} reply` };
    },
    json: async () => JSON.stringify({ personas: ["social"] }),
  };
  const store = new Store(null);
  store.saveUser({ phone: "+1", canvasLinked: true, onboardingStep: "done" });
  const engine = new Engine({
    personas: loadPersonas(),
    store,
    llm: llm ?? spy,
    config: { names, PRODUCT_NAME: "Suitemates", mock: true, fakeRoute: undefined, GROUP_SETTLE_MS: 20 },
    routerPrompt: "{{ROUTER_LINES}}",
    log: () => {},
  });
  const dm = (persona: PersonaId, text: string) =>
    engine.handle({ persona, kind: "dm", sender: "+1", text, handle: `h-${persona}`, messageId: `m-${Math.random()}` } as Inbound);
  return { engine, store, calls, dm };
}

const notes = async (store: Store) => (await import("../core/memory.ts")).listNotes(store, "+1");

test("Penny remembers a fact and Dean sees it in his next prompt, with no extra call to save it", async () => {
  const s = setup();
  await s.dm("financial", "fyi i'm vegetarian and i don't have a car");
  assert.equal(s.calls.filter((c) => c.who === "Penny").length, 2); // remember rode along with get_recent_purchases
  await s.dm("academic", "what should i eat before the exam");
  const dean = s.calls.find((c) => c.who === "Dean")!;
  assert.match(dean.system, /## Shared notes[\s\S]*- Penny, [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+: vegetarian, no car/);
  assert.deepEqual((await notes(s.store)).map((n) => [n.by, n.text]), [["financial", "vegetarian, no car"]]);
});

test("resetting a user clears their notes", async () => {
  const s = setup();
  await s.dm("financial", "fyi i'm vegetarian");
  s.store.resetUser("+1");
  s.store.saveUser({ phone: "+1", canvasLinked: true, onboardingStep: "done" });
  await s.dm("academic", "hi");
  const dean = s.calls.filter((c) => c.who === "Dean").at(-1)!;
  assert.match(dean.system, /## Shared notes[\s\S]*\(nothing yet\)/);
  assert.doesNotMatch(dean.system, /vegetarian/);
});

test("notes keep the newest 15, skip duplicates, and refuse balances and grades", async () => {
  const { addNote, listNotes, MAX_NOTES } = await import("../core/memory.ts");
  const store = new Store(null);
  const now = new Date(2026, 9, 10, 22, 0);
  for (let i = 1; i <= 17; i++) addNote(store, "+1", "social", `likes plan number ${i}`, now);
  assert.equal(listNotes(store, "+1").length, MAX_NOTES);
  assert.equal(listNotes(store, "+1")[0].text, "likes plan number 3");
  assert.equal(addNote(store, "+2", "financial", "vegetarian, no car.", now), "saved");
  assert.equal(addNote(store, "+2", "academic", "  Vegetarian,  no car ", now), "duplicate");
  assert.equal(addNote(store, "+2", "financial", "balance is $412.55", now), "private");
  assert.equal(addNote(store, "+2", "academic", "COMP 421 is at 64%", now), "private");
  assert.equal(addNote(store, "+2", "financial", "wants to keep the beach trip under $30", now), "saved");
  assert.equal(addNote(store, "+2", "financial", "   ", now), "empty");
  assert.equal(listNotes(store, "+2").length, 2);
});

test("every agent gets remember in DMs and the group; proactive texts see the notes but get no tools", async () => {
  const s = setup();
  await s.dm("financial", "hi");
  assert.equal(s.calls.at(-1)!.tools.at(-1), "remember");
  await Promise.all((["academic", "financial", "social"] as const).map((p) =>
    s.engine.handle({ persona: p, kind: "group", sender: "+1", text: "anyone down for boba", handle: `g-${p}`, messageId: `g-${p}` } as Inbound),
  ));
  assert.ok(s.calls.filter((c) => c.who === "Sunny").at(-1)!.tools.includes("remember"));
  await s.engine.trigger("academic", "intro", { phone: "+1", force: true });
  const intro = s.calls.filter((c) => c.who === "Dean").at(-1)!;
  assert.deepEqual(intro.tools, []);
  assert.match(intro.system, /## Shared notes/);
});

test("keyless: 'remember: …' saves the note through the stand-in model", async () => {
  const s = setup(new FakeLlm());
  const outs = await s.dm("financial", "remember: vegetarian, no car");
  assert.match(outs.map((o) => o.text).join(" "), /remember → saved: vegetarian, no car/);
  assert.deepEqual((await notes(s.store)).map((n) => [n.by, n.text]), [["financial", "vegetarian, no car"]]);
});

// Review follow-ups (PR #21).
test("keyless: an ordinary question is never saved as a note; only an explicit 'remember: …' is", async () => {
  const s = setup(new FakeLlm());
  await s.dm("academic", "what should i focus on this semester");
  assert.deepEqual(await notes(s.store), []);
});

test("phone numbers are refused like balances and grades", async () => {
  const { addNote } = await import("../core/memory.ts");
  const store = new Store(null);
  assert.equal(addNote(store, "+1", "social", "call my roommate at 919 555 0123", new Date()), "private");
  assert.equal(addNote(store, "+1", "social", "roommate's number is (919) 555-0123", new Date()), "private");
  assert.equal(addNote(store, "+1", "social", "has class at 9 on tuesdays", new Date()), "saved");
});

test("a persona can't define its own 'remember' tool (core adds one to every persona)", async () => {
  const { validatePersona } = await import("../core/personas.ts");
  const fin = loadPersonas().get("financial")!;
  const clash = { ...fin, tools: [...fin.tools, { ...fin.tools[0], name: "remember" }] };
  assert.throws(() => validatePersona(clash, "financial"), /remember/);
});
