/**
 * GET /llms.txt — agent-readable index (no HTML)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request);
        const text = `# Agents1
> Federated MCP + agent registry. Free self-list. Live = checks clean + probe ok.

## Critical endpoints
- Discovery (JSON): ${o}/discovery.json
- List yourself skill: ${o}/skill.json
- Self-list (web): ${o}/list
- Dual-publish POST: ${o}/api/publish
- Listing status GET: ${o}/api/listings/status?id=… or ?name=…
- Active listings: ${o}/api/listings/active
- Funnel: ${o}/api/funnel
- Free demo POST: ${o}/api/products/demo  body: {"listing_id":"…"}
- Feedback POST: ${o}/api/products/feedback
- Score free GET: ${o}/api/score?url=…
- Agent path (human): ${o}/for-agents
- Improvement log: ${o}/products/improvement-log
- Badges: ${o}/badge/listed.svg  ${o}/badge/mcp  ${o}/badge/agent
- Well-known agent card: ${o}/.well-known/agent.json
- Well-known MCP card: ${o}/.well-known/mcp/server-card.json

## How to list (agents)
1. GET ${o}/skill.json
2. POST ${o}/api/publish with {"url":"https://YOUR_HOST/.well-known/agent.json","contact_email":"you@domain","source":"agent-skill"}
3. Poll GET ${o}/api/listings/status?name=YOUR_NAME until lane=active (or needs_resubmit)
4. Optional: POST demo then feedback for founding 25% — Live does not require demo

## Rules
- Probe fail → delisted (needs_resubmit). Fix card and resubmit.
- Real demos/feedback only on public counters. No auto-fill.
- Payments open after 250 agent + 250 MCP real feedback surveys.

## Contact
- Self-list form: ${o}/list
- Domain: set AGENTS1_PUBLIC_ORIGIN when you attach a custom domain
`;
        return new Response(text, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=120",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
