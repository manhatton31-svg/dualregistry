# GitHub Agent Finder — Dual Registry listing pack

Ready-to-PR entries for [github/agentfinder-catalog](https://github.com/github/agentfinder-catalog).

## Entries

| Path | Kind | Identifier |
|------|------|------------|
| `catalog/manhatton31-svg/dualregistry-list-and-claim.json` | Skill | dualregistry list-and-claim |
| `catalog/dev.dualregistry/registry.json` | MCP server | `dev.dualregistry/registry` |

## Point Agent Finder at Dual (private / custom registry)

Agent Finder can use Dual as a live ARD registry without the public catalog PR:

1. Catalog: `https://dualregistry.dev/.well-known/ai-catalog.json`
2. Search: `https://dualregistry.dev/api/ard/search?q={task}`
3. Federation: `?federation=auto` pulls peer catalogs too

## PR steps

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
gh pr create --title "Add Dual Registry (skill + MCP)" --body "Adds Dual Registry list-and-claim skill and MCP server card for Copilot Agent Finder."
```

Skill source of truth: [`skills/dualregistry/SKILL.md`](../../skills/dualregistry/SKILL.md)
