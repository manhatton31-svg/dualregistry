# Dual-publish to Agents1

Same artifact as official MCP publish — no second form.

## After mcp-publisher

```bash
mcp-publisher init
mcp-publisher publish

# Agents1 free list (uses put budget; defers if write-safe)
curl -X POST "$AGENTS1_URL/api/publish" \
  -H "content-type: application/json" \
  --data-binary @server.json
```

## Agent card only

```bash
curl -X POST "$AGENTS1_URL/api/publish" \
  -H "content-type: application/json" \
  -d '{"agent_card_url":"https://yoursite.com/.well-known/agent.json"}'
```

## Free score first (no store write)

```bash
curl "$AGENTS1_URL/api/score?url=https://yoursite.com/.well-known/agent.json"
```

Score ≥70 → likely auto-approve on publish.

## GitHub Action

Copy `templates/agents1-list-action.yml` → `.github/workflows/agents1-list.yml`  
Set repo variable `AGENTS1_URL`.

## A2A open catalog

```
GET /agents/public
GET /agents/search?skill=…
GET /.well-known/agents
GET /api/catalog   # federation consume
```
