// Environment → typed config. Every key is listed in .env.example.
import { z } from "zod";
import { loadDotEnv } from "./env.ts";
import type { PersonaId } from "./types.ts";

const str = z.string().trim();
const opt = str.optional().transform((v) => (v ? v : undefined));

const Env = z.object({
  TRANSPORT: z.enum(["terminal", "imessage"]).default("terminal"),
  MOCK: z.string().default("1"),
  FAKE_LLM: z.string().default("0"),
  FAKE_ROUTE: opt,
  GEMINI_API_KEY: opt,
  GEMINI_MODEL: str.default("gemini-3.6-flash"),

  PRODUCT_NAME: str.default("Suitemates"),
  ACADEMIC_NAME: str.default("Dean"),
  FINANCIAL_NAME: str.default("Penny"),
  SOCIAL_NAME: str.default("Sunny"),

  // Photon, shape 1: one project, one dedicated line per persona (route by line number).
  SPECTRUM_PROJECT_ID: opt,
  SPECTRUM_PROJECT_SECRET: opt,
  ACADEMIC_LINE: opt,
  FINANCIAL_LINE: opt,
  SOCIAL_LINE: opt,
  // Photon, shape 2: one project per persona. If set, that persona gets its own Spectrum().
  ACADEMIC_PROJECT_ID: opt,
  ACADEMIC_PROJECT_SECRET: opt,
  FINANCIAL_PROJECT_ID: opt,
  FINANCIAL_PROJECT_SECRET: opt,
  SOCIAL_PROJECT_ID: opt,
  SOCIAL_PROJECT_SECRET: opt,
  // Who answers when a message arrives on a line we can't match (e.g. a shared-pool number).
  DEFAULT_PERSONA: z.enum(["academic", "financial", "social"]).default("academic"),

  NESSIE_API_KEY: opt,
  NESSIE_ACCOUNT_ID: opt,
  CANVAS_TOKEN: opt,
  CANVAS_BASE_URL: str.default("https://uncch.instructure.com"),

  PORT: z.coerce.number().default(3000),
  DEMO_TOKEN: opt,
  WATCH_MS: z.coerce.number().default(10_000),
  GROUP_SETTLE_MS: z.coerce.number().default(1500),
  MORNING_AT: str.default("08:00"),
  WEEKLY_AT: str.default("sun 18:00"),
  DATA_FILE: str.default("data/state.json"),
  // Personas whose watch() the scheduler polls every WATCH_MS (comma list).
  WATCH: str.default("financial"),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = (loadDotEnv(), process.env)) {
  const e = Env.parse(env);
  const names: Record<PersonaId, string> = {
    academic: e.ACADEMIC_NAME,
    financial: e.FINANCIAL_NAME,
    social: e.SOCIAL_NAME,
  };
  const lines: Partial<Record<PersonaId, string>> = {
    academic: e.ACADEMIC_LINE,
    financial: e.FINANCIAL_LINE,
    social: e.SOCIAL_LINE,
  };
  const projects: Partial<Record<PersonaId, { projectId: string; projectSecret: string }>> = {};
  for (const id of ["academic", "financial", "social"] as const) {
    const pid = e[`${id.toUpperCase() as Uppercase<PersonaId>}_PROJECT_ID`];
    const secret = e[`${id.toUpperCase() as Uppercase<PersonaId>}_PROJECT_SECRET`];
    if (pid && secret) projects[id] = { projectId: pid, projectSecret: secret };
  }
  return {
    ...e,
    mock: e.MOCK !== "0",
    fakeLlm: e.FAKE_LLM === "1" || !e.GEMINI_API_KEY,
    watchList: e.WATCH.split(",").map((s) => s.trim()).filter(Boolean) as PersonaId[],
    fakeRoute: e.FAKE_ROUTE?.split(",").map((s) => s.trim()).filter(Boolean) as PersonaId[] | undefined,
    names,
    lines,
    projects,
  };
}
