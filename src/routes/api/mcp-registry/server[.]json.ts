/**
 * GET /api/mcp-registry/server.json
 * Official MCP Registry–shaped metadata for Dual Registry self-publish.
 * Use this package when submitting io.agents1.registry / dualregistry.dev.
 */
import { createFileRoute } from "@tanstack/react-router";
import { agents1McpServerCard, agents1DnsMcpTxt } from "@/lib/agents1/a2a-card";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/mcp-registry/server.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request).replace(/\/$/, "");
        const card = agents1McpServerCard(origin);
        const body = {
          $schema:
            "https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json",
          name: "io.agents1.registry",
          description:
            "Dual Registry — free MCP + agent list, probe-clean Active, Kernel Improver + Recursive Loop. Self-list via skill.json / publish.",
          version: "1.9.0",
          title: "Dual Registry",
          websiteUrl: origin,
          repository: {
            url: "https://github.com/manhatton31-svg/dualregistry",
            source: "github",
          },
          packages: [] as unknown[],
          remotes: [
            {
              type: "streamable-http",
              url: `${origin}/api/protocol`,
            },
            {
              type: "streamable-http",
              url: `${origin}/api/a2a`,
            },
          ],
          meta: {
            dualregistry: true,
            server_card: `${origin}/.well-known/mcp/server-card.json`,
            agent_card: `${origin}/.well-known/agent-card.json`,
            ai_catalog: `${origin}/.well-known/ai-catalog.json`,
            skill: `${origin}/skill.json`,
            dns_txt: agents1DnsMcpTxt(origin),
            publish_hint:
              "Register namespace dualregistry.dev / io.agents1 via DNS or GitHub verification on registry.modelcontextprotocol.io",
            card,
          },
        };
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=120",
              "access-control-allow-origin": "*",
            },
            { origin },
          ),
        });
      },
    },
  },
});
