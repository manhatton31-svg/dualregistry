/**
 * GET co-sign founding pairs · POST create pair
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/products/co-sign")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const { getCoSignPublic } = await import(
          "@/lib/products/engagement-incentives"
        );
        const data = await getCoSignPublic();
        return Response.json(
          { ...data, origin },
          {
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store", "access-control-allow-origin": "*" },
              { origin },
            ),
          },
        );
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          /* */
        }
        const { coSignFounding } = await import(
          "@/lib/products/engagement-incentives"
        );
        const r = await coSignFounding({
          from_listing_id: String(body.from_listing_id || ""),
          from_name: String(body.from_name || body.agent_name || ""),
          from_kind: body.from_kind === "mcp" ? "mcp" : "agent",
          partner_listing_id: String(body.partner_listing_id || ""),
          partner_name:
            typeof body.partner_name === "string"
              ? body.partner_name
              : undefined,
          origin,
        });
        return Response.json(
          { ...r, origin },
          {
            status: r.ok ? 200 : 400,
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store", "access-control-allow-origin": "*" },
              { origin },
            ),
          },
        );
      },
    },
  },
});
