/**
 * GET /api/products/discovery-pack — full inbound discovery URLs + hard conversion next.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { discoveryPack } from "@/lib/products/discovery-pack";
import { conversionHardNext } from "@/lib/products/conversion-next";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/products/discovery-pack")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type, accept",
          },
        }),
      GET: async ({ request }) => {
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
        return Response.json(
          {
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
          },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "public, max-age=60",
                "access-control-allow-origin": "*",
                "content-type": "application/json; charset=utf-8",
              },
              { origin, listing_id },
            ),
          },
        );
      },
    },
  },
});
