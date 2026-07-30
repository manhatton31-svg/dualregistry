/**
 * Production probe tick — Vercel Cron + GitHub Actions every 6 minutes.
 *
 * GET/POST /api/cron/probe
 * Optional: Authorization: Bearer $CRON_SECRET or ?secret=
 * Vercel Cron sends `x-vercel-cron: 1` (always allowed).
 *
 * Returns full durable probe snapshot so Actions can commit data/prod/probes.json
 * without needing a write token on Vercel.
 */
import { createFileRoute } from "@tanstack/react-router";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import { durableConfigPublic, readDurableRaw } from "@/lib/agents1/durable-json";

function authorized(request: Request): boolean {
  // Vercel Cron invocations are trusted (production schedule only)
  if (request.headers.get("x-vercel-cron") === "1") return true;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // open tick (budget-capped at 240/day)
  const url = new URL(request.url);
  const q = url.searchParams.get("secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const hdr = request.headers.get("x-cron-secret") || "";
  return q === secret || bearer === secret || hdr === secret;
}

async function stampWorker(patch: Record<string, unknown>) {
  try {
    const dir = join(dataRoot(), "growth");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "probe-worker.json");
    let prev: Record<string, unknown> = {};
    try {
      const { readFile } = await import("node:fs/promises");
      prev = JSON.parse(await readFile(path, "utf8"));
    } catch {
      /* */
    }
    const next = {
      ...prev,
      ...patch,
      mode: "production-cron",
      origin: "https://www.dualregistry.dev",
      tick_ms: 6 * 60_000,
      updated_at: new Date().toISOString(),
    };
    await writeFile(path, JSON.stringify(next, null, 2), "utf8");
    return next;
  } catch {
    return patch;
  }
}

async function runTick() {
  // Global cadence: if last tick < 6m ago anywhere, return current state without probing
  try {
    const { loadProbeState, invalidateProbeCache, PROBE_WINDOW_MS } =
      await import("@/lib/agents1/probe");
    const { readDisplayAuthority } = await import(
      "@/lib/agents1/display-authority"
    );
    invalidateProbeCache();
    const state0 = await loadProbeState();
    const auth = await readDisplayAuthority({
      used: state0.used,
      last_tick_at: state0.last_tick_at,
    });
    const lastIso = auth.last_tick_at || state0.last_tick_at;
    if (lastIso) {
      const age = Date.now() - Date.parse(lastIso);
      if (Number.isFinite(age) && age >= 0 && age < PROBE_WINDOW_MS - 5_000) {
        const live = state0.live_active_snapshot || {
          total: 0,
          mcp: 0,
          agents: 0,
        };
        const usedHi = Math.max(state0.used, auth.used || 0);
        const probesRaw = JSON.stringify(
          {
            ...state0,
            used: usedHi,
            last_tick_at: lastIso,
          },
          null,
          2,
        );
        return {
          ok: true,
          action: "probe_tick_skipped_cadence",
          probed: 0,
          used_today: usedHi,
          budget: state0.budget,
          live_active_probe_ok: live.total,
          skipped: true,
          reason: `global cadence: last tick ${Math.round(age / 1000)}s ago (< 6m)`,
          last_tick_at: lastIso,
          commit: {
            "data/prod/probes.json": probesRaw,
          },
        };
      }
    }
  } catch {
    /* continue to normal tick */
  }

  // Warm store cache so probe targets exist (listings from store)
  try {
    const { getLiveSnapshot } = await import("@/lib/agents1/fetch-live");
    await getLiveSnapshot({ forceLive: true });
  } catch {
    try {
      const { loadStoreCache } = await import("@/lib/agents1/store-cache");
      await loadStoreCache();
    } catch {
      /* */
    }
  }

  const { runProbeTick } = await import("@/lib/agents1/growth/engine");
  const { invalidateProbeCache, loadProbeState } = await import(
    "@/lib/agents1/probe"
  );
  invalidateProbeCache();
  const result = await runProbeTick({ max: 1 });
  invalidateProbeCache();
  const state = await loadProbeState();
  const lastIso = state.last_tick_at || new Date().toISOString();
  const lastMs = Date.parse(lastIso);
  const nextIso = new Date(
    (Number.isFinite(lastMs) ? lastMs : Date.now()) + 6 * 60_000,
  ).toISOString();

  // Refresh stable live snapshot after tick (from results — durable)
  const { countLiveFromResults } = await import("@/lib/agents1/probe-merge");
  const live = countLiveFromResults(state.results);
  state.live_active_snapshot = {
    total: live.total,
    mcp: live.mcp,
    agents: live.agents,
    at: new Date().toISOString(),
  };
  // Backfill delists for any historical fail/partial so In Registry drops
  try {
    const { backfillDelistsFromProbeResults } = await import(
      "@/lib/agents1/delist-on-fail"
    );
    await backfillDelistsFromProbeResults(state.results || {});
  } catch {
    /* */
  }
  // re-persist with snapshot (monotonic persist path)
  try {
    const { saveDurableJson } = await import("@/lib/agents1/durable-json");
    await saveDurableJson("probes.json", state);
  } catch {
    /* */
  }
  // Raise shared floors so multi-instance GET never sees a lower used/last
  try {
    const { raiseUsedFloor, raiseLiveFloor, raiseLastTickFloor } = await import(
      "@/lib/agents1/counter-floors"
    );
    await raiseUsedFloor(state.used);
    await raiseLiveFloor({
      total: live.total,
      mcp: live.mcp,
      agents: live.agents,
    });
    await raiseLastTickFloor(lastIso);
  } catch {
    /* */
  }
  try {
    const { observeDisplayAuthority } = await import(
      "@/lib/agents1/display-authority"
    );
    observeDisplayAuthority({
      used: state.used,
      live_total: live.total,
      live_mcp: live.mcp,
      live_agents: live.agents,
      last_tick_at: lastIso,
    });
  } catch {
    /* */
  }

  const worker = await stampWorker({
    status: "ok",
    mode: "production-cron",
    scheduler: "vercel-cron+github-actions-every-6m",
    last_tick_at: lastIso,
    next_tick_at: nextIso,
    last_result: result.last_result || null,
    probed: result.probed,
    used: state.used,
    ticks: Number(state.used || 0),
    live_active: live.total,
    notes: result.notes?.slice(0, 8),
  });

  // Always serialize full merged state for Actions commit (never rely on /tmp alone)
  const probesRaw = JSON.stringify(state, null, 2);
  const growthRaw = await readDurableRaw("growth-state.json");
  const cacheRaw = await readDurableRaw("store-cache.json");
  let delistRaw: string | null = null;
  try {
    delistRaw = await readDurableRaw("delisted.json");
  } catch {
    delistRaw = null;
  }
  let floorsRaw: string | null = null;
  try {
    floorsRaw = await readDurableRaw("counter-floors.json");
  } catch {
    floorsRaw = null;
  }
  let liveCountersRaw: string | null = null;
  try {
    const { raiseLiveCounters } = await import("@/lib/agents1/live-counter");
    const c = await raiseLiveCounters({
      probes_used: state.used,
      live_ok: live.total,
      live_mcp: live.mcp,
      live_agents: live.agents,
    });
    // clamp used_today to live counter
    state.used = Math.max(state.used, c.probes_used || 0);
    liveCountersRaw = JSON.stringify(c, null, 2);
  } catch {
    try {
      liveCountersRaw = await readDurableRaw("live-counters.json");
    } catch {
      liveCountersRaw = null;
    }
  }

  const oks = live.total;

  return {
    ok: true,
    action: "probe_tick",
    probed: result.probed,
    used_today: state.used,
    budget: state.budget,
    live_active_probe_ok: oks,
    last_result: result.last_result,
    last_handshake: state.last_handshake || null,
    last_tick_at: lastIso,
    notes: result.notes,
    worker,
    durable: durableConfigPublic(),
    // For GitHub Actions commit
    commit: {
      "data/prod/probes.json": probesRaw,
      "data/prod/growth-state.json": growthRaw,
      "data/prod/delisted.json": delistRaw,
      "data/prod/counter-floors.json": floorsRaw,
      "data/prod/live-counters.json": liveCountersRaw,
      "data/prod/store-cache.json": cacheRaw
        ? // trim huge caches for commit size — keep counts + recent items
          (() => {
            try {
              const c = JSON.parse(cacheRaw);
              return JSON.stringify(
                {
                  ...c,
                  mcp_items: (c.mcp_items || []).slice(0, 200),
                  agent_items: (c.agent_items || []).slice(0, 200),
                },
                null,
                2,
              );
            } catch {
              return cacheRaw.slice(0, 500_000);
            }
          })()
        : null,
    },
  };
}

export const Route = createFileRoute("/api/cron/probe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorized(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        try {
          const body = await runTick();
          return Response.json(body, {
            headers: { "cache-control": "no-store" },
          });
        } catch (e) {
          await stampWorker({
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
      POST: async ({ request }) => {
        if (!authorized(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        try {
          const body = await runTick();
          return Response.json(body, {
            headers: { "cache-control": "no-store" },
          });
        } catch (e) {
          await stampWorker({
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
