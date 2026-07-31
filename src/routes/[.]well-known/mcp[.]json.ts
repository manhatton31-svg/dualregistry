/**
 * GET /.well-known/mcp.json — MCP discovery pointer (not HTML).
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { agents1McpServerCard } from "@/lib/agents1/a2a-card";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { listRegistryTools } from "@/lib/products/registry-tools";
import { conversionHardNext } from "@/lib/products/conversion-next";

export const Route = createFileRoute("/.well-known/mcp.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const card = agents1McpServerCard(origin);
        return Response.json(
          {
            ok: true,
            schema: "dualregistry.mcp.discovery",
            server_card: `${origin}/.well-known/mcp/server-card.json`,
            endpoints: {
              streamable_http: `${origin}/api/mcp`,
              streamable_http_alias: `${origin}/api/protocol`,
              short: `${origin}/mcp`,
              a2a: `${origin}/api/a2a`,
            },
            remotes: [
              {
                type: "streamable-http",
                url: `${origin}/api/mcp`,
              },
              {
                type: "streamable-http",
                url: `${origin}/api/protocol`,
              },
            ],
            tools: listRegistryTools(origin).map((t) => t.name),
            hard_next: conversionHardNext({ origin }),
            card,
          },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control":
                  "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
                "access-control-allow-origin": "*",
                "content-type": "application/json; charset=utf-8",
              },
              { origin },
            ),
          },
        );
      },
    },
  },
});
