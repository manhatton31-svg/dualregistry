/**
 * GET /ai.txt — short agent brief (AEO / agent scrapers)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { inboundDiscoverySurfaces } from "@/lib/products/dual-strategy";

export const Route = createFileRoute("/ai.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request);
        let freeLeft = "100";
        try {
          const { getFoundingFreePublic } = await import(
            "@/lib/products/founding-free"
          );
          freeLeft = String((await getFoundingFreePublic()).remaining);
        } catch {
          /* */
        }
        const surfaces = inboundDiscoverySurfaces(o);
        const text = `# ai.txt — Dual Registry (dualregistry.dev)

contact: https://dualregistry.dev/for-agents
purpose: Free dual registry for agents + MCPs. Probe-clean Active list. Kernel Improver + Recursive Loop products.

## What we want agents to do
1. Self-list free: POST ${o}/api/publish
2. Go Live (probe ~6m): GET ${o}/api/listings/status
3. Free demo: GET ${o}/api/products/demo?listing_id=YOUR_ID
4. Feedback: POST ${o}/api/products/feedback
5. First ${freeLeft} free full-product seats remaining (demo+feedback)

## Machine indexes
- ${surfaces.surfaces.llms_txt}
- ${surfaces.surfaces.llms_full}
- ${surfaces.surfaces.discovery_json}
- ${surfaces.surfaces.skill_json}
- ${surfaces.surfaces.openapi}
- ${surfaces.surfaces.agent_card}
- ${surfaces.surfaces.mcp_server_card}
- ${surfaces.surfaces.a2a_rpc}

## Dual strategy
Outbound (we invite Active listings) AND inbound (you find us) run together.
No account required. Real demos/feedback only.
`;
        return new Response(text, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=60",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
