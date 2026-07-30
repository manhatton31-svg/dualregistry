/**
 * GET /api/dns/mcp-status — live check of _mcp TXT + publish instructions
 */
import { createFileRoute } from "@tanstack/react-router";
import { checkMcpDns } from "@/lib/agents1/dns-mcp";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/dns/mcp-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const status = await checkMcpDns(origin);
        return Response.json(
          {
            ok: true,
            ...status,
            mcp_server_card: `${origin.replace(/\/$/, "")}/.well-known/mcp/server-card.json`,
            mcp_registry_package: `${origin.replace(/\/$/, "")}/api/mcp-registry/server.json`,
            agentmap: `${origin.replace(/\/$/, "")}/agentmap.json`,
          },
          {
            headers: withDemoCtaHeaders(
              { "cache-control": "public, max-age=30" },
              { origin },
            ),
          },
        );
      },
    },
  },
});
