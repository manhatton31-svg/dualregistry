# GitHub Agent Finder — Dual Registry listing pack

Ready-to-PR entries for [github/agentfinder-catalog](https://github.com/github/agentfinder-catalog).

## Entries

| Path | Kind | Identifier |
|------|------|------------|
| `catalog/manhatton31-svg/dualregistry-list-and-claim.json` | Skill | dualregistry list-and-claim |
| `catalog/dev.dualregistry/registry.json` | MCP server | `dev.dualregistry/registry` |

## Point Agent Finder at Dual (private / custom registry)

Agent Finder can use Dual as a live ARD registry without the public catalog PR:

1. Catalog: `https://www.dualregistry.dev/.well-known/ai-catalog.json`
2. Search: `https://www.dualregistry.dev/api/ard/search?q={task}&federation=auto`
3. Matchmaking: `https://www.dualregistry.dev/api/match?q={task}`
4. Capability tools (MCP): `POST https://www.dualregistry.dev/api/protocol` with JSON-RPC `tools/list` / `tools/call`

### Example: point Copilot Agent Finder

```text
Registry URL: https://www.dualregistry.dev/.well-known/ai-catalog.json
```

Agents only see Dual's Active clean projections + Dual self entries. Federation auto optionally pulls peer catalogs (HF + Active peers).

### Dual-as-tool (invocable registry)

```bash
# List tools
curl -sS -X POST https://www.dualregistry.dev/api/protocol \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Match capability
curl -sS -X POST https://www.dualregistry.dev/api/protocol \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"match_capability","arguments":{"q":"github issues"}}}'
```

## PR steps

Fork branch already prepared: [manhatton31-svg/agentfinder-catalog@add-dualregistry](https://github.com/manhatton31-svg/agentfinder-catalog/tree/add-dualregistry)

Open PR to `github/agentfinder-catalog` from that branch in the GitHub UI (integration token cannot open upstream PRs).

Manual:

```bash
gh repo fork github/agentfinder-catalog --clone
cd agentfinder-catalog
mkdir -p catalog/manhatton31-svg catalog/dev.dualregistry
cp ../dualregistry/docs/agentfinder/catalog/manhatton31-svg/*.json catalog/manhatton31-svg/
cp ../dualregistry/docs/agentfinder/catalog/dev.dualregistry/*.json catalog/dev.dualregistry/
git checkout -b add-dualregistry
git add catalog/
git commit -m "Add Dual Registry skill + MCP server"
git push origin add-dualregistry
gh pr create --title "Add Dual Registry (skill + MCP)" --body "Adds Dual Registry list-and-claim skill and MCP server card for Copilot Agent Finder. Dual is also pointable as a custom ARD registry at https://www.dualregistry.dev/.well-known/ai-catalog.json"
```

Skill source of truth: [`skills/dualregistry/SKILL.md`](../../skills/dualregistry/SKILL.md)

Live status: `GET https://www.dualregistry.dev/api/products/agentfinder`
