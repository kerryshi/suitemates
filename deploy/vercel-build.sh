#!/usr/bin/env bash
# Builds the static Vercel site in deploy/vercel/: pages + avatars, API paths proxied to the Mac's tunnel.
# Usage: deploy/vercel-build.sh <tunnel-url> <public-site-url>   (re-run + redeploy whenever the tunnel URL changes)
set -euo pipefail
TUNNEL="${1:?tunnel url, e.g. https://x.trycloudflare.com}"; SITE="${2:?public site url, e.g. https://suitemates.vercel.app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/deploy/vercel"
rm -rf "$OUT/public"; mkdir -p "$OUT/public/avatars"
cp "$ROOT/web/index.html" "$ROOT/web/join.html" "$OUT/public/"
for n in dean penny sunny dean-icon penny-icon sunny-icon; do cp "$ROOT/docs/avatars/$n.png" "$OUT/public/avatars/"; done
printf '{"publicUrl":"%s"}\n' "$SITE" > "$OUT/public/config.json"
cat > "$OUT/vercel.json" <<JSON
{
  "outputDirectory": "public",
  "cleanUrls": false,
  "rewrites": [
    { "source": "/qr", "destination": "/index.html" },
    { "source": "/join/:agent(academic|financial|social)", "destination": "/join.html" },
    { "source": "/signup", "destination": "$TUNNEL/signup" },
    { "source": "/try/:agent", "destination": "$TUNNEL/try/:agent" },
    { "source": "/cal/:file", "destination": "$TUNNEL/cal/:file" }
  ],
  "headers": [{ "source": "/(.*)", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }]
}
JSON
echo "built $OUT (tunnel=$TUNNEL site=$SITE)"
