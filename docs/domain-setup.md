# Agents1 domain setup (when you buy one)

Everything works on the live preview origin today. After you buy a domain:

## 1. Point DNS at the deploy host

Whatever hosts this app (Vercel after platform deploy, or your worker):

- `A` / `CNAME` for apex + `www` per host docs

## 2. Set public origin

```bash
# env for the app process
AGENTS1_PUBLIC_ORIGIN=https://YOUR_DOMAIN
```

Restart / redeploy. Cards, badges, dual-publish docs, and DNS TXT will use this host.

## 3. Publish free inbound discovery TXT

From `/discovery.json` → `surfaces.dns_record_hint`, or:

```
_mcp.YOUR_DOMAIN  TXT  "v=mcp1; url=https://YOUR_DOMAIN/.well-known/mcp/server-card.json; …"
```

Full value is always at:

- `GET /discovery.json` → `surfaces.dns_mcp_txt`
- Overview tab on the dashboard

## 4. Update dual-publish consumers

GitHub Action repo variable:

```
AGENTS1_URL=https://YOUR_DOMAIN
```

README snippet:

```bash
mcp-publisher publish
curl -X POST https://YOUR_DOMAIN/api/publish -H 'content-type: application/json' -d @server.json
```

## 5. Optional community PR

See `docs/community-project-pr.md` — list Agents1 under official MCP community projects with your domain URL.
