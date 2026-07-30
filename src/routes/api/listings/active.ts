/**
 * GET /api/listings/active
 * Public Active (Live) listings with listing_id + exact take_demo POST body.
 * Feeder for external agents/MCPs.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/api/listings/active")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind"); // agent | mcp | null
        const limit = Math.min(
          100,
          Math.max(1, Number(url.searchParams.get("limit") || 40)),
        );

        const { getLanedListings } = await import(
          "@/lib/agents1/listing-lanes"
        );
        const {
          FUNNEL_STAGES,
          funnelPublicStatus,
        } = await import("@/lib/products/activation-funnel");
        const lanes = await getLanedListings();

        let agents = lanes.agents_active || [];
        let mcps = lanes.mcp_active || [];
        if (kind === "agent") mcps = [];
        if (kind === "mcp") agents = [];

        const trim = (rows: typeof agents) =>
          rows.slice(0, limit).map((L) => {
            const row = L as typeof L & {
              take_demo?: unknown;
              activation?: unknown;
              demoed?: boolean;
              feedbacked?: boolean;
            };
            return {
              listing_id: row.id,
              id: row.id,
              kind: row.kind,
              name: row.name,
              description: row.description,
              category_id: row.category_id,
              category_label: row.category_label,
              checks_clean: row.checks_clean,
              probe: row.probe,
              agent_card_url: row.agent_card_url,
              remote_url: row.remote_url,
              website: row.website,
              demoed: row.demoed || false,
              feedbacked: row.feedbacked || false,
              take_demo: row.take_demo,
              activation: row.activation,
              next:
                "POST /api/products/demo with take_demo.body → feedback → 25% → buy",
            };
          });

        const funnel = await funnelPublicStatus(origin);

        return Response.json(
          {
            ok: true,
            origin,
            funnel_loop:
              "listing → Live → demo → feedback → discount → buy",
            stages: FUNNEL_STAGES,
            counts: {
              agents_active: lanes.counts.agents_active,
              mcp_active: lanes.counts.mcp_active,
            },
            agents: trim(agents),
            mcps: trim(mcps),
            how_to: {
              take_demo: {
                method: "POST",
                url: `${origin}/api/products/demo`,
                example_body: { listing_id: "paste from agents[] or mcps[]" },
              },
              leave_feedback: {
                method: "POST",
                url: `${origin}/api/products/feedback`,
                note: "Use next_steps.example_body from demo response",
              },
              buy_with_discount: {
                method: "POST",
                url: `${origin}/api/products/checkout`,
                note: "When payments open; pass discount_code from feedback",
              },
            },
            unlock: funnel.unlock,
            payment_gate: funnel.payment_gate,
          },
          {
            headers: {
              "cache-control": "public, max-age=30",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
