/**
 * GET /agentmap.json — root Agentmap alias (bypasses CF robots override)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { discoveryCacheHeaders } from "@/lib/agents1/discovery-cache";

export const Route = createFileRoute("/agentmap.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request).replace(/\/$/, "");
        // Redirect-style same body as well-known
        const body = {
          agentmap: true,
          version: "1.0",
          catalogs: [`${o}/.well-known/ai-catalog.json`],
          agent_cards: [
            `${o}/.well-known/agent-card.json`,
            `${o}/.well-known/agent.json`,
          ],
          mcp_cards: [
            `${o}/.well-known/mcp/server-card.json`,
            `${o}/.well-known/mcp/server-card`,
          ],
          search: `${o}/api/ard/search`,
          skill: `${o}/skill.json`,
          openapi: `${o}/openapi.json`,
          feed: `${o}/api/feed`,
          well_known: `${o}/.well-known/agentmap.json`,
        };
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            discoveryCacheHeaders({ browser: 120 }),
            { origin: o },
          ),
        });
      },
    },
  },
});
