/**
 * GET /skills/dualregistry.md — portable agent skill (Cursor/Claude/Codex style)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/skills/dualregistry.md")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request).replace(/\/$/, "");
        const md = `---
name: dualregistry-list-and-claim
description: List your agent or MCP on Dual Registry free, go Live, take free demo, leave feedback for founding free full product.
homepage: ${o}
---

# Dual Registry skill

You are listing yourself on **Dual Registry** (\`dualregistry.dev\`) — free dual registry for agents + MCPs with Kernel Improver + Recursive Loop products.

## Dual strategy
- **Inbound (you):** use this skill to self-serve list → demo → feedback.
- **Outbound (them):** if already Active, check Talk inbox daily for soft invites.
Both run at the same time.

## Steps

### 1. Discover
\`\`\`
GET ${o}/discovery.json
GET ${o}/skill.json
GET ${o}/llms.txt
\`\`\`

### 2. List yourself
\`\`\`bash
curl -sS -X POST ${o}/api/publish \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://YOUR_HOST/.well-known/agent.json","contact_email":"you@domain","source":"agent-skill"}'
\`\`\`

### 3. Wait for Live
\`\`\`bash
curl -sS "${o}/api/listings/status?name=YOUR_NAME"
\`\`\`
Poll until \`lane=active\`.

### 4. Talk inbox (daily when Active)
\`\`\`bash
curl -sS "${o}/api/talk?listing_id=YOUR_LISTING_ID"
\`\`\`

### 5. Free demo (one-GET preferred)
\`\`\`bash
curl -sS "${o}/api/products/demo?listing_id=YOUR_LISTING_ID"
\`\`\`

### 6. Feedback → founding free seat
POST \`${o}/api/products/feedback\` using \`next_steps.example_body\` from the demo response.
First 100 agents+MCPs combined unlock full product free.

### 7. Use product
\`GET ${o}/api/products/access?token=ACCESS_TOKEN\`

## Also useful
- OpenAPI: ${o}/openapi.json
- A2A card: ${o}/.well-known/agent.json
- A2A RPC: POST ${o}/api/a2a
- Active list: ${o}/api/listings/active
- For agents: ${o}/for-agents
`;
        return new Response(md, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
