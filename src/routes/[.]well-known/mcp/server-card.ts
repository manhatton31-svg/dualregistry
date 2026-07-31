/**
 * GET /.well-known/mcp/server-card — path alias (no .json) for MCP clients
 */
import { createFileRoute } from "@tanstack/react-router";
import { agents1McpServerCard } from "@/lib/agents1/a2a-card";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { discoveryJsonResponse } from "@/lib/agents1/discovery-cache";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";

export const maxDuration = MAX_DURATION.metadata;
export const preferredRegion = PREFERRED_REGION;

export const Route = createFileRoute("/.well-known/mcp/server-card")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const card = agents1McpServerCard(origin);
        return discoveryJsonResponse(request, card, {
          browser: 300,
          cdn: 300,
          fingerprint: `mcp-server-card|${origin}|v1`,
          extraHeaders: withDemoCtaHeaders(
            { "access-control-allow-origin": "*" },
            { origin },
          ),
        });
      },
    },
  },
});
