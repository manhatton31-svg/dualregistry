/**
 * GET /api/probes — lightweight probe health for humans + agents.
 * Always disk-backed; no store crawl. Use this to verify the 6-min worker.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/probes/")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getProbePublic, invalidateProbeCache } = await import(
            "@/lib/agents1/probe"
          );
          invalidateProbeCache();
          const probes = await getProbePublic();
          const recent = (probes.recent || []).slice(0, 12).map(
            (r: {
              id?: string;
              kind?: string;
              handshake?: string;
              ok?: boolean;
              probed_at?: string;
              target?: string;
              signals?: string[];
            }) => ({
              id: r.id,
              kind: r.kind,
              handshake: r.handshake,
              ok: r.ok,
              probed_at: r.probed_at,
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
            }),
          );
          return Response.json(
            {
              ok: true,
              real_numbers_only: true,
              cadence: "1 probe every 6 minutes UTC · 240/day",
              how_it_works: {
                worker:
                  "Production: GitHub Actions every 6m → POST /api/cron/probe · Preview: scripts/probe-worker.mjs",
                tick: "POST /api/cron/probe or POST /api/growth { action: 'probe_tick' }",
                state: "data/prod/probes.json (durable) + local data root",
                status: "data/growth/probe-worker.json",
                dashboard: "GET /api/dashboard?refresh=1 → protocol.probes",
                timing:
                  "next_tick_at = last_tick_at + 6 minutes (always; not wall-clock alone)",
                live_rule: "checks clean + handshake ok → Active list",
                handoff:
                  "probe ok → offer take-demo skill (listing_id + POST body); demos/feedback external only",
                fail_rule:
                  "fail = card missing/blocked/non-JSON; spends budget, not Live",
                not_auto: "demos/feedback never auto-increment (external only)",
              },
              probes: {
                used: probes.used,
                budget: probes.budget,
                remaining: probes.remaining,
                last_tick_at: probes.last_tick_at,
                next_tick_at: probes.next_tick_at,
                by_kind_today: probes.by_kind_today,
                worker: probes.probe_worker,
                window: {
                  used: probes.window_used,
                  cap: probes.window_cap,
                  remaining: probes.window_remaining,
                  minutes: 6,
                },
              },
              outcomes: probes.outcomes,
              recent,
            },
            {
              headers: {
                "access-control-allow-origin": "*",
                "cache-control": "no-store",
              },
            },
          );
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
