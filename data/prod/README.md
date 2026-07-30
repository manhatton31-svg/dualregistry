# Production durable state

Hydrated by dualregistry.dev on cold start (Vercel `/tmp` is ephemeral).

- `probes.json` — handshake results → Live active
- `growth-state.json` — growth engine candidates
- `store-cache.json` — last-known store listings for probe targets

Updated every ~6 minutes by `.github/workflows/prod-probe.yml` and/or Vercel Cron `*/6 * * * *` → `POST /api/cron/probe`.
