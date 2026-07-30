/**
 * GET /.well-known/agent-descriptions — ANP-style agent directory (JSON-LD CollectionPage)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/.well-known/agent-descriptions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request).replace(/\/$/, "");
        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
        const pageSize = 50;

        let items: Array<Record<string, unknown>> = [
          {
            "@type": "ad:AgentDescription",
            name: "Dual Registry",
            "@id": `${origin}/.well-known/agent-card.json`,
            description:
              "Free dual registry for agents + MCPs. Probe Live, free demo, founding seats.",
            url: origin,
            agent_card: `${origin}/.well-known/agent-card.json`,
            a2a_rpc: `${origin}/api/a2a`,
          },
        ];

        try {
          const { listPublicAgents } = await import("@/lib/agents1/catalog");
          const data = await listPublicAgents({ limit: 200 });
          for (const a of data.items || []) {
            items.push({
              "@type": "ad:AgentDescription",
              name: a.name,
              "@id":
                a.agent_card_url ||
                a.url ||
                `${origin}/api/listings/status?name=${encodeURIComponent(a.name)}`,
              description: a.description,
              skills: a.skills,
              protocols: a.protocols,
            });
          }
        } catch {
          /* */
        }

        const total = items.length;
        const start = (page - 1) * pageSize;
        const slice = items.slice(start, start + pageSize);
        const hasNext = start + pageSize < total;

        const body = {
          "@context": {
            "@vocab": "https://schema.org/",
            did: "https://w3id.org/did#",
            ad: "https://agent-network-protocol.com/ad#",
          },
          "@type": "CollectionPage",
          url: `${origin}/.well-known/agent-descriptions`,
          name: "Dual Registry agent descriptions",
          totalItems: total,
          items: slice,
          ...(hasNext
            ? {
                next: `${origin}/.well-known/agent-descriptions?page=${page + 1}`,
              }
            : {}),
          dual_strategy: true,
          ai_catalog: `${origin}/.well-known/ai-catalog.json`,
        };

        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=60",
              "access-control-allow-origin": "*",
            },
            { origin },
          ),
        });
      },
    },
  },
});
