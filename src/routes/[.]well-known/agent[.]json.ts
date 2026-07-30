import { createFileRoute } from "@tanstack/react-router";
import { agents1AgentCard } from "@/lib/agents1/a2a-card";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/.well-known/agent.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const card = agents1AgentCard(origin);
        return Response.json(card, {
          headers: {
            "cache-control": "public, max-age=300",
            "access-control-allow-origin": "*",
            "content-type": "application/json; charset=utf-8",
          },
        });
      },
    },
  },
});
