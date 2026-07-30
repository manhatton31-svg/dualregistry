import { createFileRoute } from "@tanstack/react-router";
import { agents1McpServerCard } from "@/lib/agents1/a2a-card";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/.well-known/mcp/server-card.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const card = agents1McpServerCard(origin);
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
