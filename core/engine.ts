// The brain's front door: Inbound → Outbound[]. Knows nothing about iMessage or the terminal.
import type { Ctx, Inbound, Outbound, Persona, PersonaId, UserProfile } from "./types.ts";
import type { LlmClient } from "./llm/client.ts";
import type { Store } from "./store.ts";
import type { Config } from "./config.ts";
import { respond, type Setting } from "./agent.ts";
import { introTexts } from "./signup.ts";
import { keywordScores } from "./router.ts";
import { onboard } from "./onboarding.ts";
import { withMemory } from "./memory.ts";
import { ackText, answersOffer, consentFromText, getPending, PLAIN_YES, recruitTool, runRecruit, setPending } from "./recruit.ts";
import { photonProjectFor, type AddResult, type AddUser } from "./photon-users.ts";

const SHARED_TIMEOUT_MS = 3_000; // Persona.context budget per reply

export interface EngineDeps {
  personas: Map<PersonaId, Persona>;
  store: Store;
  llm: LlmClient;
  config: Pick<Config, "names" | "PRODUCT_NAME" | "mock"> & { watchList?: PersonaId[] };
  now?: () => number;
  log?: (msg: string) => void;
  addUser?: AddUser; // Photon allowlist add (core/photon-users.ts); unset = no per-agent projects to add anyone to
  // Send texts outside the turn (a recruited agent's texts, as soon as each is ready). Set by core/main.ts.
  deliver?: (outs: Outbound[]) => Promise<void>;
}

export class Engine {
  readonly d: EngineDeps;
  private readonly adds = new Map<string, Promise<AddResult>>(); // "<phone>|<agent>" → Photon add in flight
  private readonly now: () => number;
  readonly log: (msg: string) => void;

  constructor(deps: EngineDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((m) => console.log(`[core] ${m}`));
  }

  // The engine's clock (tests move it).
  time(): number {
    return this.now();
  }

  // Every message is a DM to one agent (there's no group chat: agents bring each other in, core/recruit.ts).
  async handle(ev: Inbound): Promise<Outbound[]> {
    return this.dm(ev);
  }

  private async dm(ev: Inbound): Promise<Outbound[]> {
    const user = this.d.store.user(ev.sender);
    if (user.onboardingStep !== "done") {
      const n = this.d.config.names;
      const r = onboard(user, ev.text ?? "", { me: ev.persona, product: this.d.config.PRODUCT_NAME, ...n });
      this.d.store.saveUser(r.user);
      const extra = r.user.onboardingStep === "done" ? await this.onboarded(r.user.phone) : [];
      return [{ persona: ev.persona, handle: ev.handle, text: r.reply }, ...extra];
    }
    const persona = this.pickPersona(user, ev);
    // Calling an agent they don't have yet by name signs them up with it (it greets them below).
    if (user.agents?.length && !user.agents.includes(persona)) {
      user.agents = [...user.agents, persona];
      this.d.store.saveUser(user);
    }
    // Signed up on the web and just texted in (the "hey Dean" the QR page pre-fills): each agent they signed up
    // with that hasn't said hi yet introduces itself with its contact card, in this same conversation. On an
    // agent's own number only that agent: the others say hi from their own numbers.
    const ungreeted = (user.agents ?? []).filter((id) => !(user.greeted ?? []).includes(id));
    const toGreet = ev.lineKnown ? ungreeted.filter((id) => id === persona) : ungreeted;
    if (user.signupStatus && toGreet.length) {
      const order = [persona, ...toGreet.filter((id) => id !== persona)].filter((id) => toGreet.includes(id));
      // Marked greeted before the (slow) hellos are written, so a second text arriving meanwhile doesn't greet them
      // twice. introTexts never throws for a failing intro (it falls back to the plain hello).
      this.d.store.saveUser({ ...user, signupStatus: "invited", greeted: [...new Set([...(user.greeted ?? []), ...order])], lastAgent: order[0] });
      const intros = await introTexts(this, user.phone, order);
      return intros.map((o) => ({ ...o, handle: ev.handle }));
    }
    // An offer to bring another agent in (core/recruit.ts), answered in the conversation it was made in.
    const offer = getPending(this.d.store, user.phone);
    if (offer && answersOffer(offer, persona, ev.lineKnown, this.now())) {
      const waiting = offer.agents.filter((a) => a.consent === "pending");
      const answer = consentFromText(ev.text ?? "");
      // In another hand-off agent's thread (they replied where the last text landed) only a plain yes accepts, and not
      // when that agent just asked its own question. Anything else is for that agent, and the offer stays open.
      const side = Boolean(ev.lineKnown) && offer.from !== persona;
      const ownQuestion = side && /\?|your call/i.test(this.d.store.history(persona, user.phone).at(-1)?.text ?? "");
      const accepts = !side || (answer === "yes" && PLAIN_YES.test(ev.text ?? "") && !ownQuestion);
      if (waiting.length && accepts) {
        setPending(this.d.store, user.phone, { ...offer, agents: offer.agents.filter((a) => a.consent !== "pending") }); // one shot
        if (answer === "no") return [{ persona, handle: ev.handle, text: "no worries" }];
        if (answer === "yes") {
          const r = await runRecruit(this, user.phone, { ...offer, agents: waiting });
          const ids = waiting.map((a) => a.id);
          return [{ persona, handle: ev.handle, text: ackText(this.d.config.names, ids, r.viaFrom, undefined, side ? offer.from : undefined) }, ...r.out];
        }
      }
    }
    const turnStart = this.now();
    const text = await this.reply(persona, user, ev.text ?? "", ev.image, "dm");
    if (user.agents?.length && user.lastAgent !== persona) this.d.store.saveUser({ ...this.d.store.user(user.phone), lastAgent: persona });
    // One shared number and several agents: say who's talking.
    const tag = !ev.lineKnown && (user.agents?.length ?? 0) > 1 ? `${this.d.config.names[persona]}: ` : "";
    const reply: Outbound = { persona, handle: ev.handle, text: tag + text };
    // bring_in this turn for an agent they named or already have: no question, it texts now.
    const made = getPending(this.d.store, user.phone);
    const ready = made && made.from === persona && made.offeredAt >= turnStart ? made.agents.filter((a) => a.consent !== "pending") : [];
    if (!made || !ready.length) return [reply];
    setPending(this.d.store, user.phone, { ...made, agents: made.agents.filter((a) => a.consent === "pending") });
    return [reply, ...(await runRecruit(this, user.phone, { ...made, agents: ready })).out];
  }

  // Does bringing this agent in mean adding them to its own Photon project first?
  needsAdd(id: PersonaId, user: UserProfile): boolean {
    const { own, project } = photonProjectFor(id);
    return Boolean(this.d.addUser && own && !user.poolLines?.[project!]);
  }

  // The Photon add for this person and agent: the one already in flight (started when it was offered), or a new one.
  addFor(id: PersonaId, user: UserProfile): Promise<AddResult> {
    const key = `${user.phone}|${id}`;
    let p = this.adds.get(key);
    if (!p) {
      p = this.d.addUser!(user.phone, user.name ?? "", id).catch((err): AddResult => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      this.adds.set(key, p);
    }
    // A successful add stays here, so the "yes" that follows the offer reuses it instead of running the CLI again;
    // a failed one is dropped so the next offer can retry.
    void p.then((r) => {
      if (!r.ok) this.adds.delete(key);
    });
    return p;
  }

  // Who answers a DM. A dedicated line (or a user who never signed up on the web) → that line's persona. On the
  // shared pool, among the agents this user signed up with: one they named ("dean, …") → their only agent → the
  // one whose area the text is about → whoever they talked to last.
  pickPersona(user: UserProfile, ev: Inbound): PersonaId {
    const mine = (user.agents ?? []).filter((id) => this.d.personas.has(id));
    if (ev.lineKnown || mine.length === 0) return ev.persona;
    const text = ev.text ?? "";
    // The agent they call by name, even one they never signed up with ("hey sunny" → Sunny, and dm() adds her).
    // Two names in one text: the first one ("u re not penny ure dean" → Penny).
    const named = this.namedIn(text);
    if (named) return named;
    if (mine.length === 1) return mine[0];
    const scores = [...keywordScores(text, new Map(mine.map((id) => [id, this.d.personas.get(id)!])))].sort((x, y) => y[1] - x[1]);
    if (scores[0]?.[1] > 0 && scores[0][1] > (scores[1]?.[1] ?? 0)) return scores[0][0];
    return user.lastAgent && mine.includes(user.lastAgent) ? user.lastAgent : mine[0];
  }

  // The persona whose name appears first in the text, if any.
  private namedIn(text: string): PersonaId | undefined {
    const hits = [...this.d.personas.keys()]
      .map((id) => ({ id, at: text.search(new RegExp(`\\b${this.d.config.names[id]}\\b`, "i")) }))
      .filter((h) => h.at >= 0)
      .sort((a, b) => a.at - b.at);
    return hits[0]?.id;
  }

  // Run each watcher once as soon as a user is onboarded, so its first poll (the baseline that
  // records what already exists) happens now, not up to WATCH_MS later. Otherwise a purchase made
  // right after "you're all set" would be counted as pre-existing and never roasted. Runs through
  // trigger(), so if it isn't the first poll (e.g. /skip again after a buy) the events are delivered.
  async onboarded(phone: string): Promise<Outbound[]> {
    const out: Outbound[] = [];
    for (const id of this.d.config.watchList ?? []) {
      if (!this.d.personas.get(id)?.watch) continue;
      try {
        out.push(...(await this.trigger(id, "watch", { phone })));
      } catch (err) {
        this.log(`WARN ${id} baseline at onboarding failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
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
      // Web sign-ups hear from an agent only if they picked it, and only after its hello + contact card: no
      // "PS6 due in 3 hours" before "hey, I'm Dean", and no Penny roasts for someone who only wanted Dean.
      if (name !== "intro" && user.agents && !(user.agents.includes(personaId) && (user.greeted ?? []).includes(personaId))) continue;
      const events = await fn.call(persona, this.ctx(personaId, user));
      for (const ev of events) {
        if (!this.d.store.claim(ev.dedupeKey) && !opts.force) continue;
        const target = this.d.store.user(ev.userPhone);
        let text: string;
        try {
          text = await this.replyOrThrow(personaId, target, `[proactive] ${ev.kind}: ${ev.facts}`, undefined, "proactive");
        } catch (err) {
          // The event is already claimed and won't come back, so never drop it: send the facts plainly.
          this.log(`ERROR ${personaId} proactive text failed, sending plain facts: ${err instanceof Error ? err.message : err}`);
          text = ev.facts.replace(/\s*Tone: [^.]*\./g, "").trim();
        }
        // An agent not on their phone under its own number speaks through the one they text (UserProfile.via).
        const via = target.via?.[personaId];
        out.push({ persona: personaId, handle: `dm:${ev.userPhone}`, text, ...(via ? { via } : {}) });
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

  async reply(id: PersonaId, user: UserProfile, text: string, image: Inbound["image"], setting: Setting): Promise<string> {
    try {
      return await this.replyOrThrow(id, user, text, image, setting);
    } catch (err) {
      this.log(`ERROR ${id} reply failed: ${err instanceof Error ? err.message : err}`);
      return "one sec, my brain glitched. try that again?";
    }
  }

  // The other personas' Persona.context lines for this user. A slow or failing one is skipped, never fatal.
  private async shared(id: PersonaId, user: UserProfile): Promise<string[]> {
    const others = [...this.d.personas.values()].filter((p) => p.id !== id && p.context);
    const lines = await Promise.all(
      others.map(async (p) => {
        try {
          let timer: NodeJS.Timeout | undefined;
          const timeout = new Promise<string>((r) => (timer = setTimeout(() => r(""), SHARED_TIMEOUT_MS)));
          const line = await Promise.race([p.context!(this.ctx(p.id, user)), timeout]).finally(() => clearTimeout(timer));
          return line.trim() ? `${this.d.config.names[p.id]}: ${line.trim()}` : "";
        } catch (err) {
          this.log(`WARN ${p.id} context failed: ${err instanceof Error ? err.message : err}`);
          return "";
        }
      }),
    );
    return lines.filter(Boolean);
  }

  async replyOrThrow(id: PersonaId, user: UserProfile, text: string, image: Inbound["image"], setting: Setting): Promise<string> {
    const remembered = withMemory(this.d.personas.get(id)!, { store: this.d.store, user, names: this.d.config.names, text });
    // In their own DMs every agent can bring another one in (core/recruit.ts).
    const persona =
      setting === "dm"
        ? {
            ...remembered,
            // Before `remember`, which stays last (memory.ts: the keyless model prefers the persona's own tools).
            tools: [
              ...remembered.tools.slice(0, -1),
              recruitTool({
                store: this.d.store,
                names: this.d.config.names,
                from: id,
                text,
                now: this.now,
                needsAdd: (a, u) => this.needsAdd(a, u),
                startAdd: (a, u) => void this.addFor(a, u),
              }),
              ...remembered.tools.slice(-1),
            ],
          }
        : remembered;
    const shared = setting === "proactive" ? [] : await this.shared(id, user);
    const out = await respond({
      shared,
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
    const said = setting === "proactive" || setting === "recruit" ? [] : [{ role: "user" as const, text }];
    this.d.store.pushHistory(id, user.phone, ...said, { role: "model", text: out });
    return out;
  }
}
