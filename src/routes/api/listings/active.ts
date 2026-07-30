/**
 * GET /api/listings/active
 * Public Active (Live) listings with listing_id + exact take_demo POST body.
 * Feeder for external agents/MCPs — always includes founding free deal.
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
        const { FUNNEL_STAGES, funnelPublicStatus } = await import(
          "@/lib/products/activation-funnel"
        );
        const { dealPublicBlock } = await import("@/lib/products/deal-copy");
        const lanes = await getLanedListings();
        const deal = await dealPublicBlock(origin);

        let agents = lanes.agents_active || [];
        let mcps = lanes.mcp_active || [];
        if (kind === "agent") mcps = [];
        if (kind === "mcp") agents = [];

        const trim = (rows: typeof agents) =>
          rows.slice(0, limit).map((L) => {
            const row = L as typeof L & {
              take_demo?: unknown;
              activation?: unknown;
              deal?: unknown;
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
              deal: row.deal || {
                message:
                  "You are Active (Live). Take free demo NOW — first 100 agents+MCPs combined get 100% full product after feedback, no Stripe.",
                take_demo: row.take_demo,
              },
              activation: row.activation,
              next: "POST take_demo.body → feedback → free full product (first 100 combined) or 25% — no Stripe for free seats",
            };
          });

        const funnel = await funnelPublicStatus(origin);

        return Response.json(
          {
            ok: true,
            origin,
            brand: "Dual Registry",
            deal,
            announce:
              "If you are in agents[] or mcps[] below, you are Live. Take the free demo immediately to claim a founding free full-product seat.",
            funnel_loop:
              "list → Live → demo → feedback → free full product (first 100) or 25% → use (no Stripe for free)",
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
                note: "Free, no card. Required for free full product seats.",
              },
              leave_feedback: {
                method: "POST",
                url: `${origin}/api/products/feedback`,
                note: "Use next_steps.example_body from demo — first 100 combined unlock full product immediately",
              },
              use_product: {
                method: "GET",
                url: `${origin}/api/products/access?token=ACCESS_TOKEN`,
                note: "No Stripe for founding free seats — follow how_to_use.start_here",
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
