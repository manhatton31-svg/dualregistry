/**
 * GET /api/probes — lightweight probe health for humans + agents.
 * Soft CDN (30s) + ETag for harvest de-dupe — same numbers, less Active CPU.
 * Timestamps: Eastern Time (America/New_York); next from adaptive window.
 */
import { createFileRoute } from "@tanstack/react-router";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { discoveryJsonResponse } from "@/lib/agents1/discovery-cache";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";
import { withTrackedRequest } from "@/lib/agents1/track-request";

export const maxDuration = MAX_DURATION.api_read;
export const preferredRegion = PREFERRED_REGION;

export const Route = createFileRoute("/api/probes/")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        withTrackedRequest(
          {
            class: "api_read",
            route: "/api/probes",
            label: "probes_public",
          },
          async () => {
            try {
              const origin = resolvePublicOrigin(request);
              const soft =
                new URL(request.url).searchParams.get("soft") === "1";
              const { getProbePublic, invalidateProbeCache } = await import(
                "@/lib/agents1/probe"
              );
              const {
                formatEtClock,
                formatEtFull,
                formatProbeRelative,
                probeCadencePair,
              } = await import("@/lib/agents1/time-et");
              // Soft harvest: skip hard invalidate (use in-process TTL)
              if (!soft) invalidateProbeCache();
              const probes = await getProbePublic();
              const cadence = probeCadencePair(
                probes.last_tick_at as string | undefined,
              );
              const policy = (probes.policy || {}) as Record<string, unknown>;
              const worker = (probes.probe_worker || {}) as Record<
                string,
                unknown
              >;
              const adaptive =
                ((probes as { adaptive?: Record<string, unknown> })
                  .adaptive as Record<string, unknown> | undefined) ||
                (worker.adaptive as Record<string, unknown> | undefined) ||
                ({
                  behind: true,
                  window_ms: 2 * 60_000,
                  probes_per_tick: 64,
                } as Record<string, unknown>);
              const windowMin =
                Number(adaptive.window_ms || policy.window_minutes || 6) /
                (Number(adaptive.window_ms) ? 60_000 : 1);
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
              const body = {
                ok: true,
                real_numbers_only: true,
                metrics_source:
                  (probes as { metrics_source?: string }).metrics_source ||
                  "local",
                mirrored_from: (probes as { mirrored_from?: string })
                  .mirrored_from,
                timezone: "America/New_York",
                cadence:
                  (policy.cadence as string) ||
                  `adaptive · up to ${adaptive.probes_per_tick || 64} probes / ${windowMin}m · ET`,
                how_it_works: {
                  worker:
                    "Production: Vercel Cron every 6m primary · GH Actions snapshot+commit (backup tick if stale)",
                  tick: "POST /api/cron/probe or POST /api/growth { action: 'probe_tick' }",
                  state: "data/prod/probes.json (durable) on production",
                  dashboard: "GET /api/dashboard?refresh=1 → protocol.probes",
                  timing:
                    "next_tick_at = last_tick_at + adaptive window (2m behind / 10m on-pace)",
                  live_rule: "checks clean + handshake ok → Active list",
                  handoff:
                    "probe ok → offer take-demo skill; demos/feedback external only",
                  fail_rule:
                    "fail = card missing/blocked/non-JSON; spends budget, not Live",
                  not_auto:
                    "demos and feedback come from agents/MCPs who try the product",
                  cost_mode: policy.cost_mode,
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
                  gap_minutes: windowMin,
                  by_kind_today: probes.by_kind_today,
                  live_active:
                    probes.live_active_snapshot || probes.live_active || null,
                  worker: probes.probe_worker,
                  adaptive,
                  policy,
                  window: {
                    used: probes.window_used ?? probes.hourly_used,
                    cap: probes.window_cap ?? probes.hourly_cap,
                    remaining:
                      probes.window_remaining ?? probes.hourly_remaining,
                    minutes: windowMin,
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
              };
              const live =
                (probes.live_active_snapshot as { total?: number }) ||
                (probes.live_active as { total?: number }) ||
                {};
              return discoveryJsonResponse(request, body, {
                browser: soft ? 15 : 10,
                cdn: soft ? 30 : 15,
                swr: 60,
                fingerprint: `probes|${probes.used}|${probes.last_tick_at || ""}|${live.total ?? 0}`,
                extraHeaders: withDemoCtaHeaders(
                  { "access-control-allow-origin": "*" },
                  { origin },
                ),
              });
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
        ),
    },
  },
});
