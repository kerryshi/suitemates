#!/bin/bash
# Install / stop / inspect the Suitemates watchdog as a launchd agent (macOS). See ops/WATCHDOG.md.
#   ops/watchdog.sh install     # start now and at login; WATCHDOG_ROOT=<checkout the server runs in> (default: this one)
#   ops/watchdog.sh restart     # pick up new code (state is saved, so it won't re-send alerts)
#   ops/watchdog.sh uninstall   # stop it (healthchecks will then report it missing - expected)
#   ops/watchdog.sh status      # launchd state + last log lines
set -euo pipefail
LABEL=com.kerryshi.suitemates-watchdog
CODE="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${WATCHDOG_ROOT:-$CODE}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    mkdir -p "$DATA/data/logs"
    NODE="$(command -v node)" || { echo "node not on PATH" >&2; exit 1; }
    sed -e "s#__NODE__#$NODE#g" -e "s#__CODE__#$CODE#g" -e "s#__DATA__#$DATA#g" "$CODE/ops/$LABEL.plist" > "$PLIST"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"   # RunAtLoad starts it; a kickstart here would start it twice
    echo "watchdog running: code $CODE, data $DATA, log $DATA/data/logs/watchdog.log"
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "watchdog restarted"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "watchdog stopped"
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "^\s+(state|pid|last exit code) =" || echo "not loaded"
    tail -5 "$DATA/data/logs/watchdog.log" 2>/dev/null || true
    ;;
  *)
    echo "usage: $0 install|restart|uninstall|status" >&2
    exit 2
    ;;
esac
