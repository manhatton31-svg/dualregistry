/**
 * GET /.well-known/a2a-card.json — A2A discovery card (alias of agent-card + interop)
 * Fixes prior broken a2a-card endpoint.
 */
import { createFileRoute } from "@tanstack/react-router";
import { agents1AgentCard } from "@/lib/agents1/a2a-card";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/.well-known/a2a-card.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const card = agents1AgentCard(origin);
        const body = {
          ...card,
          a2a_card: true,
          interop: true,
          stigmergy: true,
          autocatalysis: true,
          first_principles: true,
          exonomics: true,
          interop_api: `${origin.replace(/\/$/, "")}/api/products/interop`,
          federation_api: `${origin.replace(/\/$/, "")}/api/products/federation`,
          first_principles_api: `${origin.replace(/\/$/, "")}/api/products/first-principles`,
          exonomics_api: `${origin.replace(/\/$/, "")}/api/products/exonomics`,
          mcp_protocol: `${origin.replace(/\/$/, "")}/api/protocol`,
          note: "A2A card — Dual interop + first-principles + exonomics (ZMC · hyper) v2.8",
        };
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
              "cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "vercel-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "access-control-allow-origin": "*",
              "content-type": "application/json; charset=utf-8",
              "x-dual-a2a-card": "2.8.0",
            },
            { origin },
          ),
        });
      },
    },
  },
});
