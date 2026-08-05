/**
 * GET /api/products/pricing — feedback-driven list + per-call prices
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { publicFeedbackPricingSnapshot } from "@/lib/products/feedback-driven-pricing";
import { getEventUsagePublic } from "@/lib/products/event-pricing";
import { collabAccessPublic } from "@/lib/products/collab-access";
import { pricingSnapshot } from "@/lib/products/catalog";
import { countPaidSeats } from "@/lib/products/orders";

export const Route = createFileRoute("/api/products/pricing")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        }),
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const [fb, events, seats] = await Promise.all([
          publicFeedbackPricingSnapshot(),
          getEventUsagePublic(),
          countPaidSeats().catch(() => 0),
        ]);
        const seats_n = typeof seats === "number" ? seats : 0;
        return Response.json(
          {
            ok: true,
            origin,
            product: "dual_pricing",
            note: "All list + per-call prices are feedback-driven (median WTP from agents, MCPs, humans). $0 answers are valid.",
            seats: pricingSnapshot(seats_n),
            feedback_driven: fb,
            events,
            collab_lab: collabAccessPublic(),
          },
          {
            headers: {
              "access-control-allow-origin": "*",
              "cache-control": "public, max-age=30",
            },
          },
        );
      },
    },
  },
});
