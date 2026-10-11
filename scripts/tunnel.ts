// Public https address for the local server (phones scanning QR codes, Google Calendar fetching feeds).
//   npm run tunnel
// Runs a Cloudflare quick tunnel to localhost:PORT and writes its address to data/public-url.txt, which the server
// reads on every request (core/kit.ts publicUrl), so QR codes and calendar links follow a new address with no
// restart. Quick tunnels can't reconnect after a network drop, so if cloudflared exits this starts a new one.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadDotEnv } from "../core/env.ts";

loadDotEnv();
if (!process.env.DEMO_TOKEN) {
  console.error(
    "[tunnel] DEMO_TOKEN is not set. The tunnel makes this server public, and without a token anyone with the URL can read " +
      "/admin/signups (everyone's sign-up details) and make the agents text people. Add a long random DEMO_TOKEN to .env, " +
      "then run npm run tunnel again.",
  );
  process.exit(1);
}
const port = process.env.PORT || "3000";
const out = "data/public-url.txt";
const exe = process.platform === "win32" && existsSync("C:\\Program Files (x86)\\cloudflared\\cloudflared.exe")
  ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe"
  : "cloudflared";

function start() {
  console.log(`[tunnel] starting cloudflared → http://localhost:${port}`);
  const child = spawn(exe, ["tunnel", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  const onData = (buf: Buffer) => {
    const text = buf.toString();
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0];
    if (url) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, url);
      console.log(`[tunnel] public URL: ${url}  (saved to ${out}; QR codes and calendar links now use it)`);
    }
    if (/ERR .*Tunnel not found/.test(text)) {
      console.log("[tunnel] Cloudflare dropped this quick tunnel; starting a new one");
      child.kill();
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    console.log(`[tunnel] cloudflared exited (${code}); restarting in 3 s`);
    setTimeout(start, 3000);
  });
}

start();
