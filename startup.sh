#!/bin/sh
# Dual Registry revive — preview :8080 only.
# Public probe ticks run on dualregistry.dev (GitHub Actions every 6m).
# Sandbox dashboard mirrors production metrics — do NOT run a local probe
# worker here (it desynced used/last/next from the phone site).
set -eu

# --- secrets bootstrap (presence only; never echo values) ---
# GitHub token from gh CLI for durable JSON push
if [ -z "${GITHUB_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
  _gh_tok=$(gh auth token 2>/dev/null || true)
  if [ -n "${_gh_tok:-}" ]; then
    export GITHUB_TOKEN="$_gh_tok"
    export GH_TOKEN="$_gh_tok"
    export DURABLE_GITHUB_TOKEN="${DURABLE_GITHUB_TOKEN:-$_gh_tok}"
  fi
  unset _gh_tok
fi
# Load dualregistry/.env.local if present (gitignored)
if [ -f /workspace/dualregistry/.env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . /workspace/dualregistry/.env.local
  set +a
fi

cd /workspace/dualregistry
mkdir -p /workspace/data/growth /workspace/data/products /workspace/screenshots /tmp
mkdir -p data/growth data/products

# Stop any legacy local probe workers (source of sandbox vs phone mismatch)
if [ -f data/growth/probe-worker.pid ]; then
  wpid=$(cat data/growth/probe-worker.pid 2>/dev/null || true)
  if [ -n "${wpid:-}" ]; then
    kill "$wpid" 2>/dev/null || true
  fi
  rm -f data/growth/probe-worker.pid
fi
if [ -f data/growth/probe-watchdog.pid ]; then
  wdpid=$(cat data/growth/probe-watchdog.pid 2>/dev/null || true)
  if [ -n "${wdpid:-}" ]; then
    kill "$wdpid" 2>/dev/null || true
  fi
  rm -f data/growth/probe-watchdog.pid
fi
pkill -f 'scripts/probe-worker.mjs' 2>/dev/null || true
pkill -f 'scripts/probe-watchdog.sh' 2>/dev/null || true

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

exit 0
