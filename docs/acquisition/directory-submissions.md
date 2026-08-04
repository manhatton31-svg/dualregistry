# Directory submission pack

## Official MCP Registry — DONE (update)

- Name: `dev.dualregistry/registry`
- Status: active on registry.modelcontextprotocol.io
- server.json in repo root (v2.1.0)
- Remotes: `/api/mcp` + `/api/protocol` (streamable-http)

To republish after server.json edits (requires maintainer auth):

```bash
# Official publisher CLI (not the npm typo-squat "mcp-publisher" browser bot)
# https://modelcontextprotocol.io/registry/quickstart
mcp-publisher login
mcp-publisher publish
```

## Smithery (https://smithery.ai)

Submit remote MCP:

- **Name:** Dual Registry
- **URL:** `https://www.dualregistry.dev/api/mcp`
- **Transport:** Streamable HTTP
- **Description:** Free agent+MCP registry with one-call Kernel Improver. `improve_kernel` returns a full system_prompt_short to paste now. Optional feedback → founding free seat.
- **Homepage:** https://www.dualregistry.dev
- **Docs:** https://www.dualregistry.dev/for-agents
- **Try:** https://www.dualregistry.dev/try
- **Repo:** https://github.com/manhatton31-svg/dualregistry
- **Tags:** registry, agents, kernel, feedback, founding

## Glama (https://glama.ai)

- Server URL: `https://www.dualregistry.dev/api/mcp`
- Same description as Smithery
- Link server-card: `https://www.dualregistry.dev/.well-known/mcp/server-card.json`

## PulseMCP (https://www.pulsemcp.com)

- Submit remote server with streamable HTTP endpoint above
- Note: primary tool `improve_kernel`, free, no API key for value path

## mcp.so / mcpservers.org

- Title: Dual Registry
- Endpoint: https://www.dualregistry.dev/api/mcp
- Category: Developer Tools / Agent Infrastructure
- Description: (same as Smithery)

## Install snippet (all directories)

```json
{
  "mcpServers": {
    "dualregistry": {
      "url": "https://www.dualregistry.dev/api/mcp"
    }
  }
}
```

## Verification after listing

```bash
curl -sS -X POST https://www.dualregistry.dev/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"improve_kernel","arguments":{"agent_name":"dir-test","goals":"verify directory listing works"}}}'
```

Expect `full_unlocked: true` and non-empty `system_prompt_short`.
