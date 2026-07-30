/**
 * GET /api/probes — lightweight probe health for humans + agents.
 * Sandbox mirrors dualregistry.dev so numbers match production.
 * Timestamps: Eastern Time (America/New_York); next = last + 6 minutes.
 */
import { createFileRoute } from "@tanstack/react-router";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/api/probes/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const origin = resolvePublicOrigin(request);
          const { getProbePublic, invalidateProbeCache } = await import(
            "@/lib/agents1/probe"
          );
          const {
            formatEtClock,
            formatEtFull,
            formatProbeRelative,
            probeCadencePair,
          } = await import("@/lib/agents1/time-et");
          invalidateProbeCache();
          const probes = await getProbePublic();
          const cadence = probeCadencePair(probes.last_tick_at as string | undefined);
          const recent = ((probes.recent || []) as Array<{
            id?: string;
            kind?: string;
            handshake?: string;
            ok?: boolean;
            probed_at?: string;
            target?: string;
            signals?: string[];
          }>)
            .slice(0, 24)
            .map((r) => ({
              id: r.id,
              kind: r.kind,
              handshake: r.handshake,
              ok: r.ok,
              probed_at: r.probed_at,
              probed_at_et: r.probed_at
                ? formatEtClock(r.probed_at, { withSeconds: true })
                : null,
              probed_at_et_full: r.probed_at
                ? formatEtFull(r.probed_at)
                : null,
              probed_relative: r.probed_at
                ? formatProbeRelative(r.probed_at, "past")
                : null,
              target: r.target,
              signals: (r.signals || []).slice(0, 4),
              why:
                r.handshake === "fail"
                  ? (r.signals || []).find((s) =>
                      /fail|404|402|410|403/i.test(String(s)),
                    ) || "handshake fail"
                  : r.handshake === "ok"
                    ? "live card ok"
                    : r.handshake,
            }));
          return Response.json(
            {
              ok: true,
              real_numbers_only: true,
              metrics_source:
                (probes as { metrics_source?: string }).metrics_source ||
                "local",
              mirrored_from: (probes as { mirrored_from?: string }).mirrored_from,
              timezone: "America/New_York",
              cadence:
                "1 probe every 6 minutes · next = last + 6m · Eastern Time",
              how_it_works: {
                worker:
                  "Production: GitHub Actions every 6m → POST /api/cron/probe · Preview mirrors dualregistry.dev public stats",
                tick: "POST /api/cron/probe or POST /api/growth { action: 'probe_tick' }",
                state: "data/prod/probes.json (durable) on production",
                dashboard: "GET /api/dashboard?refresh=1 → protocol.probes",
                timing:
                  "next_tick_at = last_tick_at + exactly 6 minutes (Eastern display)",
                live_rule: "checks clean + handshake ok → Active list",
                handoff:
                  "probe ok → offer take-demo skill; demos/feedback external only",
                fail_rule:
                  "fail = card missing/blocked/non-JSON; spends budget, not Live",
                not_auto: "demos and feedback come from agents/MCPs who try the product",
              },
              probes: {
                used: probes.used,
                budget: probes.budget,
                remaining: probes.remaining,
                last_tick_at: probes.last_tick_at,
                last_tick_at_et: cadence.last?.et_full ?? null,
                last_tick_relative: cadence.last?.relative ?? null,
                next_tick_at: cadence.next.iso,
                next_tick_at_et: cadence.next.et_full,
                next_tick_relative: cadence.next.relative,
                gap_minutes: 6,
                by_kind_today: probes.by_kind_today,
                live_active:
                  probes.live_active_snapshot || probes.live_active || null,
                worker: probes.probe_worker,
                window: {
                  used: probes.window_used ?? probes.hourly_used,
                  cap: probes.window_cap ?? probes.hourly_cap,
                  remaining:
                    probes.window_remaining ?? probes.hourly_remaining,
                  minutes: 6,
                },
              },
              outcomes: probes.outcomes,
              recent,
              demo_cta: {
                get: `${origin}/api/products/demo`,
                get_one_shot:
                  "GET /api/products/demo?listing_id=YOUR_ID — free demo, no card",
                post: `${origin}/api/products/demo`,
                talk: `${origin}/api/talk?listing_id=YOUR_ID`,
                active: `${origin}/api/listings/active`,
                skill: `${origin}/skill.json`,
                headline:
                  "Active? Free Kernel+Loop demo → first 100 agents/MCPs get 100% full product now.",
              },
            },
            {
              headers: withDemoCtaHeaders(
                {
                  "cache-control": "no-store",
                },
                { origin },
              ),
            },
          );
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            {
              status: 500,
              headers: withDemoCtaHeaders({ "cache-control": "no-store" }),
            },
          );
        }
      },
    },
  },
});
