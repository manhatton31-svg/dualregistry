/**
 * GET /.well-known/agent-card.json — IANA / A2A current path (alias of agent.json)
 */
import { createFileRoute } from "@tanstack/react-router";
import { agents1AgentCard } from "@/lib/agents1/a2a-card";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/.well-known/agent-card.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const card = agents1AgentCard(origin);
        return Response.json(card, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=300",
              "access-control-allow-origin": "*",
              "content-type": "application/json; charset=utf-8",
            },
            { origin },
          ),
        });
      },
    },
  },
});
