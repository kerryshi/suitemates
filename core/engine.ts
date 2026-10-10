// The brain's front door: Inbound → Outbound[]. Knows nothing about iMessage or the terminal.
import type { Ctx, Inbound, Outbound, Persona, PersonaId, UserProfile } from "./types.ts";
import type { LlmClient } from "./llm/client.ts";
import type { Store } from "./store.ts";
import type { Config } from "./config.ts";
import { respond, type Setting } from "./agent.ts";
import { route } from "./router.ts";
import { onboard } from "./onboarding.ts";

// Every persona line in the group chat receives its own copy of each message. Copies with the same
// sender + text inside this window are one message: the router runs once.
export const DEDUPE_TTL_MS = 15_000;

interface Batch {
  at: number;
  handles: Map<PersonaId, string>;
  messageIds: string[];
  release: () => void;
}

export interface EngineDeps {
  personas: Map<PersonaId, Persona>;
  store: Store;
  llm: LlmClient;
  config: Pick<Config, "names" | "PRODUCT_NAME" | "mock" | "fakeRoute" | "GROUP_SETTLE_MS">;
  routerPrompt: string;
  now?: () => number;
  log?: (msg: string) => void;
}

export class Engine {
  readonly d: EngineDeps;
  private readonly batches = new Map<string, Batch>();
  private readonly now: () => number;
  readonly log: (msg: string) => void;

  constructor(deps: EngineDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((m) => console.log(`[core] ${m}`));
  }

  async handle(ev: Inbound): Promise<Outbound[]> {
    return ev.kind === "group" ? this.group(ev) : this.dm(ev);
  }

  private async dm(ev: Inbound): Promise<Outbound[]> {
    const user = this.d.store.user(ev.sender);
    if (user.onboardingStep !== "done") {
      const n = this.d.config.names;
      const r = onboard(user, ev.text ?? "", { me: ev.persona, product: this.d.config.PRODUCT_NAME, ...n });
      this.d.store.saveUser(r.user);
      return [{ persona: ev.persona, handle: ev.handle, text: r.reply }];
    }
    const text = await this.reply(ev.persona, user, ev.text ?? "", ev.image, "dm");
    return [{ persona: ev.persona, handle: ev.handle, text }];
  }

  private async group(ev: Inbound): Promise<Outbound[]> {
    const now = this.now();
    for (const [k, b] of this.batches) if (now - b.at >= DEDUPE_TTL_MS) this.batches.delete(k);
    const key = `${ev.sender}|${(ev.text ?? `image:${ev.image?.bytes.length}`).trim().toLowerCase()}`;

    const existing = this.batches.get(key);
    if (existing) {
      existing.handles.set(ev.persona, ev.handle);
      existing.messageIds.push(`${ev.persona}:${ev.messageId}`);
      if (existing.handles.size >= this.d.personas.size) existing.release();
      return [];
    }
    let release!: () => void;
    const ready = new Promise<void>((r) => (release = r));
    const batch: Batch = { at: now, handles: new Map([[ev.persona, ev.handle]]), messageIds: [`${ev.persona}:${ev.messageId}`], release };
    this.batches.set(key, batch);
    if (batch.handles.size < this.d.personas.size) {
      await Promise.race([ready, new Promise((r) => setTimeout(r, this.d.config.GROUP_SETTLE_MS))]);
    }
    this.log(`group copies: ${batch.messageIds.join(", ")}`);

    const user = this.d.store.user(ev.sender);
    const chosen = await route({
      text: ev.text ?? "(sent a photo)",
      personas: this.d.personas,
      names: this.d.config.names,
      llm: this.d.llm,
      routerPrompt: this.d.routerPrompt,
      fakeRoute: this.d.config.fakeRoute,
      log: this.log,
    });
    this.log(`router → [${chosen.join(", ")}]`);

    const texts = await Promise.all(chosen.map((id) => this.reply(id, user, ev.text ?? "", ev.image, "group")));
    return chosen.map((id, i): Outbound => {
      const handle = batch.handles.get(id);
      if (handle) return { persona: id, handle, text: texts[i] };
      // That persona's line never got a copy: speak through a line that did, with a name tag.
      const [via, h] = [...batch.handles][0];
      this.log(`WARN ${id} has no handle in this group; sending via ${via}`);
      return { persona: via, handle: h, text: `${this.d.config.names[id]}: ${texts[i]}` };
    });
  }

  // Proactive: run a persona's named trigger (or "watch") and turn its events into DMs.
  // force = true (demo trigger) re-sends events already delivered; scheduled runs pass false.
  async trigger(personaId: PersonaId, name: string, opts: { phone?: string; force?: boolean } = {}): Promise<Outbound[]> {
    const persona = this.d.personas.get(personaId);
    if (!persona) throw new Error(`unknown persona "${personaId}"`);
    const fn = name === "watch" ? persona.watch : persona.triggers?.[name];
    if (!fn) {
      const has = ["watch", ...Object.keys(persona.triggers ?? {})].join(", ");
      throw new Error(`personas/${personaId} has no trigger "${name}" (has: ${has})`);
    }
    const users = opts.phone ? [this.d.store.user(opts.phone)] : this.d.store.onboardedUsers();
    const out: Outbound[] = [];
    for (const user of users) {
      const events = await fn.call(persona, this.ctx(personaId, user));
      for (const ev of events) {
        if (!this.d.store.claim(ev.dedupeKey) && !opts.force) continue;
        const target = this.d.store.user(ev.userPhone);
        const text = await this.reply(personaId, target, `[proactive] ${ev.kind}: ${ev.facts}`, undefined, "proactive");
        out.push({ persona: personaId, handle: `dm:${ev.userPhone}`, text });
      }
    }
    return out;
  }

  ctx(personaId: PersonaId, user: UserProfile): Ctx {
    return {
      user,
      mock: this.d.config.mock,
      now: new Date(this.now()),
      kv: this.d.store.kv(personaId, user.phone),
      log: (m) => this.log(`${personaId}: ${m}`),
    };
  }

  private async reply(id: PersonaId, user: UserProfile, text: string, image: Inbound["image"], setting: Setting): Promise<string> {
    const persona = this.d.personas.get(id)!;
    let out: string;
    try {
      out = await respond({
        persona,
        ctx: this.ctx(id, user),
        llm: this.d.llm,
        history: this.d.store.history(id, user.phone),
        text,
        image,
        setting,
        product: this.d.config.PRODUCT_NAME,
        names: this.d.config.names,
      });
    } catch (err) {
      this.log(`ERROR ${id} reply failed: ${err instanceof Error ? err.message : err}`);
      return "one sec, my brain glitched 😵 try that again?";
    }
    const said = setting === "proactive" ? [] : [{ role: "user" as const, text: setting === "group" ? `(group chat) ${text}` : text }];
    this.d.store.pushHistory(id, user.phone, ...said, { role: "model", text: out });
    return out;
  }
}
