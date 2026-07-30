#!/bin/sh
# Agents1 revive — preview :8080 + detached probe worker + watchdog.
# Worker is setsid/nohup so agent tool timeouts cannot SIGTERM it.
set -eu
cd /workspace
mkdir -p /workspace/data/growth /workspace/data/products /workspace/screenshots /tmp

# Dev server (live preview)
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  nohup npm run dev >>/tmp/app-startup.log 2>&1 &
  i=0
  while [ "$i" -lt 90 ]; do
    if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done
fi

worker_alive() {
  [ -f /workspace/data/growth/probe-worker.pid ] || return 1
  wpid=$(cat /workspace/data/growth/probe-worker.pid 2>/dev/null || true)
  [ -n "${wpid:-}" ] || return 1
  kill -0 "$wpid" 2>/dev/null || return 1
  case "$(tr '\0' ' ' < /proc/$wpid/cmdline 2>/dev/null || true)" in
    *probe-worker*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! worker_alive; then
  setsid nohup env PROBE_ORIGIN=http://127.0.0.1:8080 PROBE_TICK_MS=360000 \
    node /workspace/scripts/probe-worker.mjs >>/tmp/probe-worker.log 2>&1 < /dev/null &
  echo $! > /workspace/data/growth/probe-worker.pid
fi

watchdog_alive() {
  [ -f /workspace/data/growth/probe-watchdog.pid ] || return 1
  wdpid=$(cat /workspace/data/growth/probe-watchdog.pid 2>/dev/null || true)
  [ -n "${wdpid:-}" ] || return 1
  kill -0 "$wdpid" 2>/dev/null || return 1
  case "$(tr '\0' ' ' < /proc/$wdpid/cmdline 2>/dev/null || true)" in
    *probe-watchdog*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! watchdog_alive; then
  chmod +x /workspace/scripts/probe-watchdog.sh
  setsid nohup /workspace/scripts/probe-watchdog.sh >>/tmp/probe-watchdog.log 2>&1 < /dev/null &
  echo $! > /workspace/data/growth/probe-watchdog.pid
fi

exit 0
