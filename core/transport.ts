// Photon Spectrum (iMessage) transport: persona lines in, persona lines out. No business logic here.
// Two config shapes (see .env.example): one project with a dedicated line per persona (route by the
// line's number), or one project per persona. Ported from hacknc-tab/src/transport/spectrum.ts.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Spectrum, contact } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import type { Config } from "./config.ts";
import type { Inbound, Outbound, PersonaId } from "./types.ts";
import { capEmoji } from "./voice.ts";

export interface Transport {
  start(onInbound: (ev: Inbound) => Promise<void>): Promise<void>;
  send(o: Outbound): Promise<void>;
}

const SEND_GAP_MS = 700; // per line; bursts look automated to Apple
const ECHO_WINDOW_MS = 60_000;

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;
interface SendableSpace {
  id: string;
  send: (content: string | ReturnType<typeof contact>) => Promise<unknown>;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const digits = (s?: string) => (s ?? "").replace(/\D/g, "").slice(-10);

export class SpectrumTransport implements Transport {
  private readonly config: Config;
  private readonly apps = new Map<PersonaId | "shared", SpectrumApp>();
  private readonly spaces = new Map<string, SendableSpace>(); // "<persona>|<space id>"
  private readonly lastSend = new Map<PersonaId, number>();
  private readonly recentlySent: { text: string; at: number }[] = [];

  constructor(config: Config) {
    this.config = config;
  }

  async start(onInbound: (ev: Inbound) => Promise<void>): Promise<void> {
    const c = this.config;
    const loops: Promise<void>[] = [];
    for (const [persona, creds] of Object.entries(c.projects) as [PersonaId, { projectId: string; projectSecret: string }][]) {
      const make = () => Spectrum({ ...creds, providers: [imessage.config()], options: { logLevel: "warn" } });
      loops.push(this.keepAlive(persona, make, () => persona, onInbound));
    }
    const shared = (["academic", "financial", "social"] as PersonaId[]).some((p) => !c.projects[p]);
    if (shared) {
      if (!c.SPECTRUM_PROJECT_ID || !c.SPECTRUM_PROJECT_SECRET) {
        throw new Error("TRANSPORT=imessage needs SPECTRUM_PROJECT_ID/SECRET (or <PERSONA>_PROJECT_ID/SECRET for every persona)");
      }
      const creds = { projectId: c.SPECTRUM_PROJECT_ID, projectSecret: c.SPECTRUM_PROJECT_SECRET };
      const make = () => Spectrum({ ...creds, providers: [imessage.config()], options: { logLevel: "warn" } });
      loops.push(this.keepAlive("shared", make, (line) => this.personaForLine(line), onInbound));
    }
    console.log(`[imessage] lines: ${(["academic", "financial", "social"] as PersonaId[]).map((p) => `${p}=${c.lines[p] ?? "?"}`).join(" ")}`);
    await Promise.all(loops);
  }

  private personaForLine(line?: string): PersonaId {
    const hit = (Object.entries(this.config.lines) as [PersonaId, string][]).find(([, l]) => l && digits(l) === digits(line));
    return hit?.[0] ?? this.config.DEFAULT_PERSONA;
  }

  private isOurLine(id?: string): boolean {
    return Object.values(this.config.lines).some((l) => l && digits(l) === digits(id));
  }

  // One Photon connection, kept up: if it can't connect or the message stream drops (Wi-Fi blip, DNS outage),
  // wait 1 s, 2 s, 4 s … up to 30 s, open a fresh connection and carry on. Without this a single network hiccup
  // left the server running but deaf to every text.
  private async keepAlive(
    key: PersonaId | "shared",
    make: () => Promise<SpectrumApp>,
    personaOf: (line?: string) => PersonaId,
    onInbound: (ev: Inbound) => Promise<void>,
  ): Promise<void> {
    for (let failures = 0; ; ) {
      try {
        const app = await make();
        this.apps.set(key, app);
        if (failures > 0) console.log(`[imessage] ${key}: reconnected`);
        failures = 0;
        await this.loop(app, personaOf, onInbound);
        console.warn(`[imessage] ${key}: message stream ended; reconnecting`);
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        failures++;
        const wait = Math.min(30_000, 1000 * 2 ** (failures - 1));
        console.warn(`[imessage] ${key}: connection lost (${err instanceof Error ? err.message : err}); retrying in ${wait / 1000} s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  private async loop(app: SpectrumApp, personaOf: (line?: string) => PersonaId, onInbound: (ev: Inbound) => Promise<void>) {
    for await (const [space, message] of app.messages) {
      if (message.direction === "outbound" || message.platform !== "imessage") continue;
      const im = imessage(space);
      const persona = personaOf(im.phone);
      this.spaces.set(`${persona}|${space.id}`, space);
      const sender = message.sender?.id;
      // Our own agents' texts can arrive as inbound on another of our lines: never answer them.
      if (!sender || this.isOurLine(sender)) continue;
      const c = message.content;
      if (c.type === "text" && c.text && this.isEcho(c.text)) continue;
      const lineKnown = this.apps.get(persona) === app || this.isOurLine(im.phone);
      const ev = await toInbound({ persona, lineKnown, chatType: im.type, sender, handle: space.id, messageId: message.id, content: c });
      if (!ev) continue;
      console.log(`[imessage] ${persona} line=${im.phone} ${sender}: ${ev.text ?? "<image>"} (space ${space.id}, msg ${message.id})`);
      onInbound(ev).catch((err) => console.error("[imessage] handler error", err));
    }
  }

  private isEcho(text: string): boolean {
    const now = Date.now();
    while (this.recentlySent.length && now - this.recentlySent[0].at > ECHO_WINDOW_MS) this.recentlySent.shift();
    return this.recentlySent.some((s) => s.text === text);
  }

  async send(o: Outbound): Promise<void> {
    const from = o.via ?? o.persona; // whose number it goes out on
    const space = o.handle.startsWith("dm:")
      ? await this.dmSpace(from, o.handle.slice(3))
      : (this.spaces.get(`${from}|${o.handle}`) ?? this.sharedLineSpace(o));
    if (!space) return console.warn(`[imessage] no space for ${from} ${o.handle}; dropping: ${o.text}`);
    const wait = (this.lastSend.get(from) ?? 0) + SEND_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastSend.set(from, Date.now());
    if (o.text) {
      // Capped before the echo buffer, or an echo of the capped text wouldn't match isEcho and we'd answer ourselves.
      const text = this.tagged({ ...o, text: capEmoji(o.text) });
      this.recentlySent.push({ text, at: Date.now() });
      await space.send(text);
    }
    if (o.card) {
      const { name, phone, note, photo } = o.card;
      const [first, ...rest] = name.split(" ");
      await space.send(
        contact({
          name: { formatted: name, first, last: rest.join(" ") || undefined },
          phones: phone ? [{ value: phone, type: "mobile" }] : undefined,
          note,
          photo: { mimeType: "image/png", read: () => readFile(join(ROOT, photo)) },
        }),
      );
    }
  }

  // One shared number: every persona texts from it, so a proactive DM ("dm:<phone>"; only engine.trigger makes
  // those) says who it's from. Off for a persona with its own *_LINE or
  // *_PROJECT_ID. Replies to the user's own DM are left alone: they texted that persona.
  // On the shared pool every persona speaks from the number the user texted, but loop() caches that conversation
  // under the line's persona (DEFAULT_PERSONA). A persona without its own line or project borrows it; dedicated
  // lines and projects never share a conversation.
  private sharedLineSpace(o: Outbound): SendableSpace | undefined {
    const own = (p: string) => Boolean(this.config.lines[p as PersonaId] || this.config.projects[p as PersonaId]);
    if (own(o.persona)) return undefined;
    for (const [key, space] of this.spaces) {
      const [persona, handle] = key.split("|");
      if (handle === o.handle && !own(persona)) return space;
    }
    return undefined;
  }

  private tagged(o: Outbound): string {
    const name = this.config.names[o.persona];
    // Borrowing another agent's conversation (via) always says who's talking.
    if (!o.via && (!o.handle.startsWith("dm:") || this.config.lines[o.persona] || this.config.projects[o.persona])) return o.text;
    return o.text.trimStart().toLowerCase().startsWith(`${name.toLowerCase()}:`) ? o.text : `${name}: ${o.text}`;
  }

  private async dmSpace(persona: PersonaId, phone: string): Promise<SendableSpace> {
    const key = `${persona}|dm:${phone}`;
    const cached = this.spaces.get(key);
    if (cached) return cached;
    const app = this.apps.get(persona) ?? this.apps.get("shared")!;
    const im = imessage(app);
    const user = await im.user(phone);
    const line = this.apps.has(persona) ? undefined : this.config.lines[persona];
    const space = (await (line ? im.space.create(user, { phone: line }) : im.space.create(user))) as SendableSpace;
    this.spaces.set(key, space);
    return space;
  }
}

// One iMessage → an Inbound for the engine, or null when there's nothing to answer (not text or a photo).
export async function toInbound(m: {
  persona: PersonaId;
  lineKnown: boolean;
  chatType: string; // "dm" | "group" (spectrum-ts imessage(space).type)
  sender: string;
  handle: string;
  messageId: string;
  content: { type: string; text?: unknown; mimeType?: unknown; name?: unknown; read?: () => Promise<ArrayBuffer | Uint8Array> };
}): Promise<Inbound | null> {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const c = { ...m.content, text: str(m.content.text), mimeType: str(m.content.mimeType), name: str(m.content.name) };
  // No group chat: a text in an iMessage group (someone added an agent to one) is never answered: the reply would
  // land in a chat with people who never signed up. The shared pool doesn't deliver group events anyway.
  if (m.chatType === "group") {
    console.log(`[imessage] ignored group message ${m.messageId} from ${m.sender}`);
    return null;
  }
  const base = { persona: m.persona, lineKnown: m.lineKnown, sender: m.sender, handle: m.handle, messageId: m.messageId };
  if (c.type === "text" && c.text) return { ...base, text: c.text };
  if (c.type === "attachment" && c.read && /^image\/|\.(heic|heif|jpe?g|png)$/i.test(`${c.mimeType ?? ""} ${c.name ?? ""}`)) {
    return { ...base, image: { bytes: new Uint8Array(await c.read()), mimeType: c.mimeType ?? "image/jpeg" } };
  }
  return null;
}

// Send a turn's texts in order. One that fails (a just-added number Photon doesn't route yet) is logged and skipped,
// so the rest of the batch (another agent's hello, its answer) still goes out.
export async function sendAll(t: Transport, outs: Outbound[], log: (msg: string) => void = console.error): Promise<void> {
  for (const o of outs) {
    try {
      await t.send(o);
    } catch (err) {
      log(`[send] ${o.persona}${o.via ? ` via ${o.via}` : ""} ${o.handle} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
