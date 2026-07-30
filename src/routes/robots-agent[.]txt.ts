/**
 * GET /robots-agent.txt — Dual Registry robots that Cloudflare cannot override
 * (CF only intercepts exact path /robots.txt).
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/robots-agent.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request);
        const text = `# Dual Registry agent robots (authoritative)
# Canonical Agentmap (use this if /robots.txt is Cloudflare-managed):
# ${o}/agentmap.json
# ${o}/.well-known/ai-catalog.json

User-agent: *
Allow: /
Content-Signal: search=yes,ai-train=no,use=reference

Agentmap: ${o}/.well-known/ai-catalog.json
Agentmap: ${o}/agentmap.json

Sitemap: ${o}/sitemap.xml

# Indexes
# ${o}/llms.txt
# ${o}/llms-full.txt
# ${o}/discovery.json
# ${o}/skill.json
# ${o}/openapi.json
# ${o}/.well-known/agent-card.json
# ${o}/.well-known/mcp/server-card.json
# ${o}/api/ard/search
# ${o}/api/feed
`;
        return new Response(text, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=60",
            "access-control-allow-origin": "*",
            link: `<${o}/agentmap.json>; rel="agentmap", <${o}/.well-known/ai-catalog.json>; rel="ai-catalog"`,
          },
        });
      },
    },
  },
});
