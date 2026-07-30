/**
 * GET /api/feed — public activity feed (no PII)
 * New Live, founding seats left, unlock meter, dual strategy signal.
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

        items.unshift({
          type: "dual_strategy",
          mode: "outbound_plus_inbound",
          note: "Outbound go-harder + inbound self-serve always on",
          at: new Date().toISOString(),
        });

        return Response.json(
          {
            ok: true,
            title: "Dual Registry public activity",
            updated_at: new Date().toISOString(),
            items: items.slice(0, 40),
            discovery: pack,
            self_serve: pack.skill_json,
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
