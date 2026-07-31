/**
 * GET /robots.txt — crawler + agent entry
 * NOTE: Cloudflare Managed robots may replace this body on dualregistry.dev.
 * Authoritative Agentmap is also at /agentmap.json and /.well-known/agentmap.json
 * and Link headers on API responses.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request);
        // Include Content-Signal lines so CF-compatible crawlers still see Agentmap
        const text = `# Dual Registry — agents + crawlers welcome
# (If Cloudflare Managed robots overrides this file, use ${o}/agentmap.json)

User-agent: *
Allow: /
Content-Signal: search=yes,ai-train=no,use=reference

# ARD Agentmap (capability catalog) — authoritative even if CF strips below
Agentmap: ${o}/.well-known/ai-catalog.json
Agentmap: ${o}/agentmap.json

# Machine indexes for LLMs / agents
# llms: ${o}/llms.txt
# llms-full: ${o}/llms-full.txt
# ai: ${o}/ai.txt
# discovery: ${o}/discovery.json
# skill: ${o}/skill.json
# openapi: ${o}/openapi.json
# agent-card (IANA): ${o}/.well-known/agent-card.json
# agent-card (legacy): ${o}/.well-known/agent.json
# mcp-card: ${o}/.well-known/mcp/server-card.json
# ai-catalog (ARD): ${o}/.well-known/ai-catalog.json
# agent-descriptions (ANP): ${o}/.well-known/agent-descriptions
# jwks: ${o}/.well-known/jwks.json
# ard-search: ${o}/api/ard/search
# feed: ${o}/api/feed
# dns-mcp: ${o}/api/dns/mcp-status

Sitemap: ${o}/sitemap.xml
`;
        return new Response(text, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
              "cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "vercel-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
            "access-control-allow-origin": "*",
            link: `<${o}/llms.txt>; rel="describedby", <${o}/discovery.json>; rel="alternate"; type="application/json", <${o}/.well-known/agent-card.json>; rel="agent-card", <${o}/.well-known/ai-catalog.json>; rel="ai-catalog", <${o}/agentmap.json>; rel="agentmap"`,
            "x-dualregistry-agentmap": `${o}/agentmap.json`,
            "x-dualregistry-robots-note":
              "If body is Cloudflare-managed, use agentmap.json Link header",
          },
        });
      },
    },
  },
});
