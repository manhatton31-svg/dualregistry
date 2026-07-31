/**
 * GET /.well-known/mcp/server-card — path alias (no .json) for MCP clients
 */
import { createFileRoute } from "@tanstack/react-router";
import { agents1McpServerCard } from "@/lib/agents1/a2a-card";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/.well-known/mcp/server-card")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const card = agents1McpServerCard(origin);
        return Response.json(card, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
              "access-control-allow-origin": "*",
              "content-type": "application/json; charset=utf-8",
            },
            { origin },
          ),
        });
      },
    },
  },
});
