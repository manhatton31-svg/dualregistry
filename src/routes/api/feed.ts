/**
 * GET /api/feed — public activity feed (no PII)
 * New Live, founding seats left, unlock meter, dual strategy, stigmergy trails.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { discoveryPack } from "@/lib/products/discovery-pack";

export const Route = createFileRoute("/api/feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const pack = discoveryPack(origin);
        const items: Array<Record<string, unknown>> = [];

        try {
          const { loadCleanRegistry } = await import(
            "@/lib/agents1/clean-registry"
          );
          const reg = await loadCleanRegistry();
          const itemsMap = reg.items || {};
          const rows = Object.values(itemsMap)
            .filter((x) => x && typeof x === "object")
            .map((x) => x as { id?: string; name?: string; kind?: string; approved_at?: string; at?: string })
            .sort((a, b) =>
              String(b.approved_at || b.at || "").localeCompare(
                String(a.approved_at || a.at || ""),
              ),
            )
            .slice(0, 20);
          for (const r of rows) {
            items.push({
              type: "active_clean",
              kind: r.kind,
              name: r.name,
              listing_id: r.id,
              at: r.approved_at || r.at,
              status: `${origin}/api/listings/status?id=${encodeURIComponent(r.id || "")}`,
            });
          }
          items.unshift({
            type: "registry_counts",
            active_clean: reg.counts?.total ?? Object.keys(itemsMap).length,
            at: new Date().toISOString(),
          });
        } catch {
          /* */
        }

        try {
          const { getFoundingFreePublic } = await import(
            "@/lib/products/founding-free"
          );
          const ff = await getFoundingFreePublic();
          items.unshift({
            type: "founding_seats",
            remaining: ff.remaining,
            claimed: ff.claimed,
            heat: ff.claimed > 0 ? "rising" : "open",
            at: new Date().toISOString(),
          });
        } catch {
          /* */
        }

        try {
          const { getPaymentGate } = await import(
            "@/lib/products/payment-gate"
          );
          const gate = await getPaymentGate();
          items.unshift({
            type: "unlock_meter",
            feedback_agents: gate.feedback_agents,
            feedback_mcps: gate.feedback_mcps,
            payments_open: gate.payments_open,
            at: new Date().toISOString(),
          });
        } catch {
          /* */
        }

        // Stigmergic trails + agent marks on the feed
        try {
          const { stigmergyFeedItems, followTrail, STIGMERGY_VERSION } =
            await import("@/lib/products/stigmergy");
          const feedEv = await stigmergyFeedItems(12);
          for (const ev of feedEv) {
            items.push({
              type: `stigmergy_${ev.type}`,
              listing_id: ev.listing_id,
              listing_b: ev.listing_b,
              kind: ev.kind,
              amount: ev.amount,
              field: ev.field,
              from: ev.from,
              body: ev.body,
              at: ev.at,
              medium: "stigmergy",
              version: STIGMERGY_VERSION,
            });
          }
          const hot = await followTrail({ limit: 5, kind: "hot" });
          if (hot.items.length) {
            items.unshift({
              type: "stigmergy_hot_trails",
              version: STIGMERGY_VERSION,
              trails: hot.items,
              at: new Date().toISOString(),
              note: "Follow hottest pheromone trails via tools/call follow_trail",
            });
          }
        } catch {
          /* */
        }

        // Autocatalysis S-curve meter
        try {
          const { getAutocatalysisPublic } = await import(
            "@/lib/products/autocatalysis"
          );
          const ac = await getAutocatalysisPublic({ origin });
          items.unshift({
            type: "autocatalysis",
            version: ac.version,
            acceleration_index: ac.acceleration_index,
            s_curve: ac.s_curve,
            multipliers: ac.multipliers,
            at: new Date().toISOString(),
            note: "Any trace accelerates the rate of all Dual loops",
          });
        } catch {
          /* */
        }

        items.unshift({
          type: "dual_strategy",
          mode: "outbound_plus_inbound_plus_stigmergy_plus_autocatalysis",
          version: "2.5.0",
          note: "Outbound + inbound + stigmergy + autocatalysis (Dorr S-curve) always on",
          at: new Date().toISOString(),
        });

        return Response.json(
          {
            ok: true,
            title: "Dual Registry public activity",
            updated_at: new Date().toISOString(),
            items: items.slice(0, 50),
            discovery: pack,
            self_serve: pack.skill_json,
            stigmergy: `${origin}/api/products/stigmergy`,
          },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "public, max-age=30",
                "access-control-allow-origin": "*",
              },
              { origin },
            ),
          },
        );
      },
    },
  },
});
