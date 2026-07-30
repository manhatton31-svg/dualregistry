/**
 * GET /api/probes — lightweight probe health for humans + agents.
 * Always disk-backed; no store crawl. Use this to verify the 6-min worker.
 * Timestamps: Eastern Time (America/New_York); next = last + 6 minutes.
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
          const {
            formatEtClock,
            formatEtFull,
            formatProbeRelative,
            probeCadencePair,
          } = await import("@/lib/agents1/time-et");
          invalidateProbeCache();
          const probes = await getProbePublic();
          const cadence = probeCadencePair(probes.last_tick_at);
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
            }),
          );
          return Response.json(
            {
              ok: true,
              real_numbers_only: true,
              timezone: "America/New_York",
              cadence: "1 probe every 6 minutes · next = last + 6m · Eastern Time",
              how_it_works: {
                worker:
                  "Production: GitHub Actions every 6m → POST /api/cron/probe · Preview: scripts/probe-worker.mjs",
                tick: "POST /api/cron/probe or POST /api/growth { action: 'probe_tick' }",
                state: "data/prod/probes.json (durable) + local data root",
                status: "data/growth/probe-worker.json",
                dashboard: "GET /api/dashboard?refresh=1 → protocol.probes",
                timing:
                  "next_tick_at = last_tick_at + exactly 6 minutes (Eastern display)",
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
                last_tick_at_et: cadence.last?.et_full ?? null,
                last_tick_relative: cadence.last?.relative ?? null,
                next_tick_at: cadence.next.iso,
                next_tick_at_et: cadence.next.et_full,
                next_tick_relative: cadence.next.relative,
                gap_minutes: 6,
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
