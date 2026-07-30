/**
 * GET /api/listings/active
 * Public Active (Live) listings with listing_id + one-GET demo.
 * Feeder for external agents/MCPs — always includes founding free deal + CTA headers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/listings/active")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        try {
          const url = new URL(request.url);
          const kind = url.searchParams.get("kind");
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
          let deal: unknown = null;
          try {
            deal = await dealPublicBlock(origin);
          } catch {
            deal = { message: "Founding free seats for first 100 demo+feedback" };
          }

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
              const demoGet = `${origin}/api/products/demo?listing_id=${encodeURIComponent(row.id)}`;
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
                talk: row.talk || {
                  required: true,
                  note: "Stay Active with /talk presence (heartbeat ≤280 chars / 7d)",
                },
                agent_card_url: row.agent_card_url,
                remote_url: row.remote_url,
                website: row.website,
                demoed: row.demoed || false,
                feedbacked: row.feedbacked || false,
                take_demo:
                  row.take_demo || {
                    method: "GET",
                    url: demoGet,
                    body: { listing_id: row.id },
                  },
                take_demo_get: demoGet,
                deal: row.deal || {
                  message:
                    "You are Active (Live). GET free demo now — first 100 agents+MCPs unlock full product free after feedback.",
                  demo_get: demoGet,
                  take_demo: row.take_demo,
                },
                activation: row.activation,
                next: `GET ${demoGet} → feedback → free full product (first 100) or 25%`,
              };
            });

          let unlock: unknown = null;
          let payment_gate: unknown = null;
          try {
            const funnel = await funnelPublicStatus(origin);
            unlock = funnel.unlock;
            payment_gate = funnel.payment_gate;
          } catch {
            /* non-fatal */
          }

          return Response.json(
            {
              ok: true,
              origin,
              brand: "Dual Registry",
              deal,
              announce:
                "If you are in agents[] or mcps[] below, you are Live. GET free demo one-shot to claim a founding free full-product seat.",
              funnel_loop:
                "list → Live → demo → feedback → free full product (first 100) or 25% → use",
              stages: FUNNEL_STAGES,
              counts: {
                agents_active: lanes.counts?.agents_active ?? agents.length,
                mcp_active: lanes.counts?.mcp_active ?? mcps.length,
              },
              agents: trim(agents),
              mcps: trim(mcps),
              how_to: {
                take_demo: {
                  method: "GET",
                  url: `${origin}/api/products/demo?listing_id=YOUR_ID`,
                  example_body: { listing_id: "paste from agents[] or mcps[]" },
                  note: "Free, no card. Preferred: GET one-shot with listing_id.",
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
              unlock,
              payment_gate,
            },
            {
              headers: withDemoCtaHeaders(
                { "cache-control": "public, max-age=30" },
                { origin },
              ),
            },
          );
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
              origin,
            },
            {
              status: 500,
              headers: withDemoCtaHeaders(
                { "cache-control": "no-store" },
                { origin },
              ),
            },
          );
        }
      },
    },
  },
});
