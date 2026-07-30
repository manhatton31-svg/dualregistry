/**
 * GET /robots.txt — crawler + agent entry (AEO / LLM index)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request);
        const text = `# Dual Registry — agents + crawlers welcome
User-agent: *
Allow: /

# Machine indexes for LLMs / agents
# llms: ${o}/llms.txt
# llms-full: ${o}/llms-full.txt
# ai: ${o}/ai.txt
# discovery: ${o}/discovery.json
# skill: ${o}/skill.json
# openapi: ${o}/openapi.json
# agent-card: ${o}/.well-known/agent.json
# mcp-card: ${o}/.well-known/mcp/server-card.json

Sitemap: ${o}/sitemap.xml
`;
        return new Response(text, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=300",
            "access-control-allow-origin": "*",
            link: `<${o}/llms.txt>; rel="describedby", <${o}/discovery.json>; rel="alternate"; type="application/json", <${o}/.well-known/agent.json>; rel="agent-card"`,
          },
        });
      },
    },
  },
});
