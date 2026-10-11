// Terminal transport: talk to any agent with no phone.
import { createInterface } from "node:readline";
import { PERSONA_IDS, type Inbound, type Outbound, type PersonaId } from "./types.ts";
import type { App } from "./app.ts";
import type { Transport } from "./transport.ts";
import { listNotes } from "./memory.ts";

export const DEMO_USER = "+19195550001";
type Mode = PersonaId;

const HELP = `commands:
  <text>                   send as the current user
  as +1919...: <text>      send once as someone else
  /to academic|financial|social   switch agent
  /as +1919...             switch user
  /skip                    skip onboarding (budget 600, goal "spring break, $400")
  /reset                   forget this user (re-onboard)
  /trigger <persona> <name>   fire a proactive message, e.g. /trigger academic morning_due
  /who                     show the user profile
  /notes                   show what the agents remember about this user
  /quit`;

export class ConsoleTransport implements Transport {
  private readonly app: App;
  private mode: Mode;
  private sender = DEMO_USER;
  private seq = 0;

  constructor(app: App, mode: Mode) {
    this.app = app;
    this.mode = mode;
  }

  async start(onInbound: (ev: Inbound) => Promise<void>): Promise<void> {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    const prompt = () => `${this.sender} → ${this.app.config.names[this.mode]}> `;
    console.log(HELP);
    if (this.app.store.user(this.sender).onboardingStep !== "done") console.log('\n(not onboarded yet: say "hi", or /skip)');
    const tty = Boolean(process.stdin.isTTY);
    rl.setPrompt(prompt());
    if (tty) rl.prompt();
    for await (const raw of rl) {
      if (!tty) console.log(`${prompt()}${raw}`);
      try {
        await this.onLine(raw.trim(), onInbound);
      } catch (err) {
        console.log(`  ! ${err instanceof Error ? err.message : err}`);
      }
      rl.setPrompt(prompt());
      if (tty) rl.prompt();
    }
  }

  async send(o: Outbound): Promise<void> {
    const where = o.handle.startsWith("dm:") ? " (DM)" : "";
    if (o.text) console.log(`  [${this.app.config.names[o.persona]}]${where} ${o.text}`);
    if (o.card) console.log(`  [${this.app.config.names[o.persona]}]${where} 📇 contact card: ${o.card.name}${o.card.phone ? ` ${o.card.phone}` : ""} (${o.card.photo})`);
  }

  private async onLine(line: string, onInbound: (ev: Inbound) => Promise<void>) {
    if (!line) return;
    const [cmd, ...rest] = line.split(/\s+/);
    switch (cmd) {
      case "/help":
        return console.log(HELP);
      case "/quit":
        return process.exit(0);
      case "/to":
        if (!PERSONA_IDS.includes(rest[0] as PersonaId)) return console.log("  /to academic|financial|social");
        this.mode = rest[0] as Mode;
        return;
      case "/as":
        this.sender = rest[0] ?? DEMO_USER;
        return;
      case "/notes": {
        const notes = listNotes(this.app.store, this.sender);
        return console.log(notes.length ? notes.map((n) => `  - ${this.app.config.names[n.by]}: ${n.text}`).join("\n") : "  (nothing yet)");
      }
      case "/who":
        return console.log(`  ${JSON.stringify(this.app.store.user(this.sender))}`);
      case "/reset":
        this.app.store.resetUser(this.sender);
        return console.log("  user reset");
      case "/skip": {
        const u = this.app.store.user(this.sender);
        this.app.store.saveUser({ ...u, budgetMonthly: 600, savingsGoal: "spring break, $400", canvasLinked: true, onboardingStep: "done" });
        for (const o of await this.app.engine.onboarded(this.sender)) await this.send(o);
        return console.log("  onboarded: budget $600/month, saving for spring break, $400");
      }
      case "/trigger": {
        const outs = await this.app.engine.trigger(rest[0] as PersonaId, rest[1] ?? "", { phone: this.sender, force: true });
        if (outs.length === 0) console.log("  (trigger returned no events)");
        for (const o of outs) await this.send(o);
        return;
      }
    }
    let sender = this.sender;
    let text = line;
    const as = /^as\s+(\S+?):\s*(.*)$/is.exec(line);
    if (as) [sender, text] = [as[1], as[2]];
    const id = `m${++this.seq}`;
    await onInbound({ persona: this.mode, sender, text, handle: `dm-${sender}@${this.mode}`, messageId: id });
  }
}
