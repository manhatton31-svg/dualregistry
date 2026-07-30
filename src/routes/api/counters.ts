/**
 * GET  /api/counters — live high-water (single source of truth for UI)
 * POST /api/counters — raise counters (max-merge); body: { probes_used?, live_ok?, ... }
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/counters")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const {
            loadLiveCounters,
            liveCounterBackend,
            redTeamLiveCounter,
          } = await import("@/lib/agents1/live-counter");
          const c = await loadLiveCounters();
          const rt = redTeamLiveCounter();
          return Response.json(
            {
              ok: true,
              counters: c,
              backend: liveCounterBackend(),
              red_team: rt,
              source_of_truth:
                "live-counter (Redis/Upstash when set, else GitHub CAS max-merge)",
            },
            {
              headers: {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
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
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            probes_used?: number;
            live_ok?: number;
            live_mcp?: number;
            live_agents?: number;
            delisted_count?: number;
          };
          const { raiseLiveCounters, liveCounterBackend } = await import(
            "@/lib/agents1/live-counter"
          );
          const c = await raiseLiveCounters(body);
          return Response.json(
            {
              ok: true,
              counters: c,
              backend: liveCounterBackend(),
            },
            {
              headers: {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
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
