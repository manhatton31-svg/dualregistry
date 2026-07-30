/**
 * GET /sitemap.xml — AEO + crawler surface
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request).replace(/\/$/, "");
        const paths = [
          "/",
          "/for-agents",
          "/list",
          "/list/status",
          "/products",
          "/products/improvement-log",
          "/products/roadmap",
          "/talk",
          "/llms.txt",
          "/llms-full.txt",
          "/ai.txt",
          "/discovery.json",
          "/skill.json",
          "/skills/dualregistry.md",
          "/openapi.json",
          "/.well-known/agent.json",
          "/.well-known/agent-card.json",
          "/.well-known/ai-catalog.json",
          "/.well-known/agent-descriptions",
          "/.well-known/agents",
          "/.well-known/mcp/server-card.json",
          "/.well-known/mcp/server-card",
          "/agents/public",
          "/api/listings/active",
          "/api/protocol",
          "/api/a2a",
          "/api/ard/search",
          "/api/feed",
          "/api/mcp-registry/server.json",
          "/api/mcp-registry/publish-status",
          "/api/dns/mcp-status",
          "/api/products/dual-strategy",
          "/agentmap.json",
          "/.well-known/agentmap.json",
          "/.well-known/jwks.json",
        ];
        const urls = paths
          .map(
            (p) => `  <url>
    <loc>${o}${p === "/" ? "/" : p}</loc>
    <changefreq>hourly</changefreq>
    <priority>${p === "/" || p === "/for-agents" ? "1.0" : "0.8"}</priority>
  </url>`,
          )
          .join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
        return new Response(xml, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=300",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
