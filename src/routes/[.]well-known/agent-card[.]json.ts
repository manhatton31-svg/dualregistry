/**
 * GET /.well-known/agent-card.json — IANA / A2A current path (signed)
 * CDN + ETag — agents re-fetch often; edge hits are free Active CPU.
 */
import { createFileRoute } from "@tanstack/react-router";
import { agents1AgentCard } from "@/lib/agents1/a2a-card";
import { signAgentCard } from "@/lib/agents1/card-sign";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { discoveryJsonResponse } from "@/lib/agents1/discovery-cache";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";

export const maxDuration = MAX_DURATION.metadata;
export const preferredRegion = PREFERRED_REGION;

export const Route = createFileRoute("/.well-known/agent-card.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const card = agents1AgentCard(origin);
        const signed = await signAgentCard(
          card as unknown as Record<string, unknown>,
          origin,
        );
        return discoveryJsonResponse(request, signed, {
          browser: 120,
          cdn: 300,
          fingerprint: `agent-card|${origin}|signed-v1`,
          extraHeaders: withDemoCtaHeaders(
            { "access-control-allow-origin": "*" },
            { origin },
          ),
        });
      },
    },
  },
});
