/**
 * GET /api/products/discovery-pack — full inbound discovery URLs + hard conversion next.
 * CDN + ETag/304 — zero Active CPU on repeat agent fetches.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { discoveryPack } from "@/lib/products/discovery-pack";
import { conversionHardNext } from "@/lib/products/conversion-next";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { discoveryJsonResponse } from "@/lib/agents1/discovery-cache";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";
import { withTrackedRequest } from "@/lib/agents1/track-request";

export const maxDuration = MAX_DURATION.discovery;
export const preferredRegion = PREFERRED_REGION;

export const Route = createFileRoute("/api/products/discovery-pack")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type, accept, if-none-match",
          },
        }),
      GET: async ({ request }) =>
        withTrackedRequest(
          {
            class: "discovery",
            route: "/api/products/discovery-pack",
            label: "discovery_pack",
          },
          async () => {
            const origin = resolvePublicOrigin(request);
            const url = new URL(request.url);
            const listing_id =
              url.searchParams.get("listing_id") ||
              url.searchParams.get("id") ||
              undefined;
            const pack = discoveryPack(origin, listing_id);
            const hard = conversionHardNext({
              origin,
              listing_id: listing_id || null,
            });
            const body = {
              ok: true,
              ...pack,
              hard_next: hard,
              first_action: hard.first_action,
              second_action: hard.second_action,
              mcp: {
                endpoint: `${origin}/api/mcp`,
                protocol: `${origin}/api/protocol`,
                short: `${origin}/mcp`,
                server_card: pack.mcp_server_card,
                well_known: `${origin}/.well-known/mcp.json`,
              },
            };
            return discoveryJsonResponse(request, body, {
              browser: 60,
              cdn: 300,
              extraHeaders: withDemoCtaHeaders(
                {
                  "access-control-allow-origin": "*",
                },
                { origin, listing_id },
              ),
              fingerprint: `discovery-pack|${origin}|${listing_id || ""}|v1`,
            });
          },
        ),
    },
  },
});
