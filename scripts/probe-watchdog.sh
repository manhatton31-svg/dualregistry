#!/bin/sh
# Restarts probe-worker if dead. Detached; safe under agent tool timeouts.
set -eu
cd /workspace
mkdir -p /workspace/data/growth /tmp
LOG=/tmp/probe-watchdog.log
PIDF=/workspace/data/growth/probe-watchdog.pid
WPIDF=/workspace/data/growth/probe-worker.pid

echo $$ > "$PIDF"
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

worker_alive() {
  [ -f "$WPIDF" ] || return 1
  wpid=$(cat "$WPIDF" 2>/dev/null || true)
  [ -n "${wpid:-}" ] || return 1
  kill -0 "$wpid" 2>/dev/null || return 1
  case "$(tr '\0' ' ' < /proc/$wpid/cmdline 2>/dev/null || true)" in
    *probe-worker*) return 0 ;;
    *) return 1 ;;
  esac
}

start_worker() {
  log "starting probe-worker (setsid/nohup)"
  # Fully detach from this shell's process group
  setsid nohup env PROBE_ORIGIN=http://127.0.0.1:8080 PROBE_TICK_MS=360000 \
    node /workspace/scripts/probe-worker.mjs >>/tmp/probe-worker.log 2>&1 < /dev/null &
  echo $! > "$WPIDF"
  log "started pid=$(cat "$WPIDF")"
}

log "watchdog start pid=$$"
while true; do
  if ! worker_alive; then
    log "worker dead — restarting"
    start_worker
  fi
  sleep 30
done
