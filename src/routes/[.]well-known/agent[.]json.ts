import { createFileRoute } from "@tanstack/react-router";
import { agents1AgentCard } from "@/lib/agents1/a2a-card";
import { signAgentCard } from "@/lib/agents1/card-sign";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/.well-known/agent.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const card = agents1AgentCard(origin);
        const signed = await signAgentCard(
          card as unknown as Record<string, unknown>,
          origin,
        );
        return Response.json(signed, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
              "cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "vercel-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
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
