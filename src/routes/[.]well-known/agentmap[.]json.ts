/**
 * GET /.well-known/agentmap.json — ARD Agentmap pointer
 * (robots.txt is often overridden by Cloudflare Managed Content;
 *  this path + HTML/Link headers remain authoritative.)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/.well-known/agentmap.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request).replace(/\/$/, "");
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
          note:
            "Cloudflare may override /robots.txt; use this Agentmap or Link: rel=ai-catalog instead.",
        };
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
              "access-control-allow-origin": "*",
            },
            { origin: o },
          ),
        });
      },
    },
  },
});
