# Dual Registry — paused (Vercel credits)

**Status:** Production is a static “paused” page. No serverless functions, no crons.

## Why

Vercel Pro $20 credits were burning on:

- Fluid Active CPU for `/api/*` traffic
- Cron jobs (probe every 5 minutes + several others)

## What changed

- `vercel.json`: empty `crons`, `fluid: false`, static build, `git.deploymentEnabled: false`
- Production serves `public/paused.html` only

## Unpause

1. Restore previous `vercel.json` (git history / revert this commit).
2. Set `"git": { "deploymentEnabled": true }` (or remove the block).
3. Push to `main` (or deploy manually) so the full app rebuilds.
4. Optionally use Vercel dashboard → Project → Unpause if you later use official Pause.
