import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPersonas, validatePersona } from "../core/personas.ts";
import type { Persona, Tool } from "../core/types.ts";

const tool = (name: string, extra: Partial<Tool> = {}): Tool => ({
  name,
  description: "does a thing",
  parameters: { properties: {} },
  run: async () => "ok",
  ...extra,
});
const persona = (over: Partial<Persona> = {}): Persona => ({
  id: "financial",
  prompt: "you are money",
  routerLine: "money things",
  tools: [tool("get_x")],
  ...over,
});

test("all three persona folders satisfy the contract", () => {
  const all = loadPersonas();
  assert.deepEqual([...all.keys()], ["academic", "financial", "social"]);
  for (const p of all.values()) assert.ok(p.tools.length >= 1, `${p.id} has an example tool`);
});

test("two tools with the same name are refused", () => {
  assert.throws(() => validatePersona(persona({ tools: [tool("get_x"), tool("get_x")] }), "financial"), /two tools are named "get_x"/);
});

test("a required parameter missing from properties is refused", () => {
  const bad = tool("get_y", { parameters: { properties: {}, required: ["days"] } });
  assert.throws(() => validatePersona(persona({ tools: [bad] }), "financial"), /requires "days"/);
});

test("a persona exported under the wrong id is refused", () => {
  assert.throws(() => validatePersona(persona({ id: "social" }), "financial"), /expected "financial"/);
});

test("a non-snake_case tool name is refused", () => {
  assert.throws(() => validatePersona(persona({ tools: [tool("getX")] }), "financial"), /snake_case/);
});
