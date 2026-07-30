# Agents1 Probe System — permanent fix (2026-07-29)

## Critical root cause (why it “only worked when you mentioned it”)
The probe worker was started as a **child of agent tool shells**. When long tool commands **timed out**, the platform sent **SIGTERM to the process group** and killed the worker. Chat restarts made it look like “mentioning probes” fixed it.

## Permanent fix
1. **Detach worker**: `setsid nohup … probe-worker.mjs` (not in agent process group)
2. **Ignore accidental SIGTERM** (only dies on SIGINT or `kill -9` / `PROBE_WORKER_ALLOW_TERM=1`)
3. **Watchdog** `scripts/probe-watchdog.sh` every 30s restarts worker if dead
4. **startup.sh** starts both worker + watchdog on revive
5. Forever loop (not a fragile single setTimeout chain)

## Real numbers only
Public demos/feedback/discounts: external `self_serve`/`organic` only.  
`platform_qa` / invited / dogfood never count.

## Cadence
1 probe / UTC 6 min · 240/day · 12h fail cooldown · agent/MCP interleave · fail-streak break

## Verification (this run)
| Check | Result |
|-------|--------|
| Worker detached + SIGTERM ignored | pid 2725 survived |
| Watchdog running | yes |
| Boot after detach | used **45 → 46** (MCP ok) |
| Natural slot unattended | used **46 → 47** at `23:12:00Z` |
| Live | **8 agents · 15 MCPs** |
| by_kind today | agents + MCPs both |
| Public demos/fb/discounts | **0 / 0 / 0** |
| /api/probes matches disk | yes |
| Dashboard Update | works; Probe pulse on Overview |

## Paths
- `scripts/probe-worker.mjs`
- `scripts/probe-watchdog.sh`
- `startup.sh`
- `GET /api/probes`
- `data/probes.json` · `data/growth/probe-worker.json`
