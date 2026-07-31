/**
 * GET /api/mcp-registry/server.json
 * Official MCP Registry–shaped metadata for Dual Registry self-publish.
 */
import { createFileRoute } from "@tanstack/react-router";
import { agents1McpServerCard, agents1DnsMcpTxt } from "@/lib/agents1/a2a-card";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { checkMcpDns } from "@/lib/agents1/dns-mcp";

export const Route = createFileRoute("/api/mcp-registry/server.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request).replace(/\/$/, "");
        const card = agents1McpServerCard(origin);
        const dns = await checkMcpDns(origin);
        // Official registry server.json (remote streamable-http)
        const body = {
          $schema:
            "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
          name: "dev.dualregistry/registry",
          description:
            "Free dual MCP+agent registry. Probe Live, free demo, Kernel/Loop. Self-list + dual strategy.",
          version: "2.0.1",
          title: "Dual Registry",
          websiteUrl: origin,
          repository: {
            url: "https://github.com/manhatton31-svg/dualregistry",
            source: "github",
          },
          remotes: [
            {
              type: "streamable-http",
              url: `${origin}/api/protocol`,
            },
          ],
          // Also ship package-shaped transport for older publisher CLIs
          packages: [] as unknown[],
          meta: {
            dualregistry: true,
            alternate_names: [
              "io.agents1.registry",
              "io.github.manhatton31-svg/dualregistry",
            ],
            server_card: `${origin}/.well-known/mcp/server-card.json`,
            agent_card: `${origin}/.well-known/agent-card.json`,
            ai_catalog: `${origin}/.well-known/ai-catalog.json`,
            skill: `${origin}/skill.json`,
            dns_txt: agents1DnsMcpTxt(origin),
            dns_live: dns.live,
            dns_status: `${origin}/api/dns/mcp-status`,
            publish_status: `${origin}/api/mcp-registry/publish-status`,
            publish_hint:
              "mcp-publisher login dns|github then mcp-publisher publish using this file as server.json",
            card,
          },
        };
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
              "cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "vercel-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "access-control-allow-origin": "*",
            },
            { origin },
          ),
        });
      },
    },
  },
});
