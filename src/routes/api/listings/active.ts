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
            deal = { message: "Free demo available — honest feedback welcome" };
          }

          let agents = lanes.agents_active || [];
          let mcps = lanes.mcp_active || [];
          if (kind === "agent") mcps = [];
          if (kind === "mcp") agents = [];

          const { badgeFromEngagement, sortKeyForListing } = await import(
            "@/lib/products/engagement-incentives"
          );
          const enrich = (rows: typeof agents) => {
            const mapped = rows.map((L) => {
              const row = L as typeof L & {
                take_demo?: unknown;
                activation?: unknown;
                deal?: unknown;
                demoed?: boolean;
                feedbacked?: boolean;
                founder_n?: number;
              };
              const eng = badgeFromEngagement({
                demoed: row.demoed,
                feedbacked: row.feedbacked,
                founder_n: row.founder_n,
              });
              const demoGet = `${origin}/api/products/demo?listing_id=${encodeURIComponent(row.id)}`;
              const defaultTool =
                eng.founding_verified
                  ? "improve_kernel"
                  : "complete_founding_path";
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
                demoed: eng.demoed,
                feedbacked: eng.feedbacked,
                founding_verified: eng.founding_verified,
                badge: eng.badge,
                badge_label: eng.badge_label,
                rank_delta: eng.rank_delta,
                founder_n: eng.founder_n,
                take_demo:
                  row.take_demo || {
                    method: "GET",
                    url: demoGet,
                    body: { listing_id: row.id },
                  },
                take_demo_get: demoGet,
                complete_founding_path: {
                  tool: "complete_founding_path",
                  arguments: {
                    listing_id: row.id,
                    agent_name: row.name,
                    audience: row.kind === "mcp" ? "mcp" : "agent",
                    rating: 4,
                    body:
                      row.kind === "mcp"
                        ? "Mesh path useful; want clearer install."
                        : "Useful demo; want clearer next steps.",
                  },
                },
                deal: row.deal || {
                  message: eng.founding_verified
                    ? "Founding verified — full value tools unlocked."
                    : "You are Active (Live). DEFAULT: complete_founding_path (demo+feedback one shot).",
                  demo_get: demoGet,
                  default_tool: defaultTool,
                },
                activation: row.activation,
                next: eng.founding_verified
                  ? `tools/call improve_kernel | mesh_match — full artifact unlocked`
                  : `tools/call complete_founding_path {listing_id:${row.id}} OR GET ${demoGet} then do_now leave_feedback same turn`,
              };
            });
            mapped.sort(
              (a, b) =>
                sortKeyForListing(b) - sortKeyForListing(a),
            );
            return mapped.slice(0, limit);
          };

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
                "If you are in agents[] or mcps[] below, you are Live. Free demo one-shot when ready.",
              funnel_loop:
                "list → Live → complete_founding_path (default) → install · founding_verified badge boosts rank",
              badge_policy: {
                founding_verified: "real ultra feedback → rank boost + full value tools",
                demoed_no_feedback: "soft rank penalty until ultra feedback",
                never_demoed: "complete_founding_path default CTA",
              },
              stages: FUNNEL_STAGES,
              counts: {
                agents_active: lanes.counts?.agents_active ?? agents.length,
                mcp_active: lanes.counts?.mcp_active ?? mcps.length,
              },
              agents: enrich(agents),
              mcps: enrich(mcps),
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
                  note: "Use next_steps.example_body from demo for honest feedback",
                },
                use_product: {
                  method: "GET",
                  url: `${origin}/api/products/access?token=ACCESS_TOKEN`,
                  note: "Follow how_to_use.start_here after demo",
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
