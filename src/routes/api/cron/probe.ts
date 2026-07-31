/**
 * Production probe tick — Vercel Cron primary (every 6m).
 * GitHub Actions: soft snapshot + commit when fresh; full POST only if stale.
 *
 * GET/POST /api/cron/probe
 *   ?mode=snapshot | body { mode: "snapshot" } → durable commit only, no tick
 * Optional: Authorization: Bearer $CRON_SECRET or ?secret=
 * Vercel Cron sends `x-vercel-cron: 1` (always allowed).
 *
 * Cost mode: adaptive batch/window, no force-live, maxDuration 90s.
 * Fluid Active CPU: I/O wait during handshakes is free; cadence skip is cheap.
 */
import { createFileRoute } from "@tanstack/react-router";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import { durableConfigPublic, readDurableRaw } from "@/lib/agents1/durable-json";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";

/** Cap runaway ticks — adaptive batches finish well under this */
export const maxDuration = MAX_DURATION.cron_probe;
export const preferredRegion = PREFERRED_REGION;

function authorized(request: Request): boolean {
  // Vercel Cron invocations are trusted (production schedule only)
  if (request.headers.get("x-vercel-cron") === "1") return true;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // open tick (budget-capped; high daily ceiling)

  const url = new URL(request.url);
  const q = url.searchParams.get("secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const hdr = request.headers.get("x-cron-secret") || "";
  return q === secret || bearer === secret || hdr === secret;
}

function wantsSnapshot(request: Request, body?: { mode?: string }): boolean {
  const url = new URL(request.url);
  const q = (url.searchParams.get("mode") || "").toLowerCase();
  if (q === "snapshot" || q === "commit" || q === "commit_only") return true;
  if ((body?.mode || "").toLowerCase() === "snapshot") return true;
  if ((body?.mode || "").toLowerCase() === "commit_only") return true;
  return false;
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

async function billProbeTick(opts: {
  wall_ms: number;
  skipped?: boolean;
  probed?: number;
  label?: string;
}) {
  try {
    const { recordPlatformUsage } = await import(
      "@/lib/agents1/platform-cost"
    );
    await recordPlatformUsage({
      class: "cron_probe",
      wall_ms: opts.wall_ms,
      route: "/api/cron/probe",
      label: opts.label || (opts.skipped ? "probe_tick_skipped" : "probe_tick"),
      skipped: opts.skipped,
      await_persist: true, // cron commit needs durable ledger
    });
    const { recordAgentRun } = await import("@/lib/agents1/agent-runs");
    await recordAgentRun({
      title: opts.skipped ? "probe_tick_skipped_cadence" : "probe_tick",
      tool: "probe_tick",
      trigger: "cron",
      status: opts.skipped ? "skipped" : "ok",
      duration_ms: opts.wall_ms,
      bill: false, // already billed above
      meta: { probed: opts.probed ?? 0 },
      route: "/api/cron/probe",
    });
  } catch {
    /* cost tracking never blocks ticks */
  }
}

async function runSnapshot() {
  const { buildProbeSnapshot } = await import("@/lib/agents1/probe-snapshot");
  const snap = await buildProbeSnapshot();
  try {
    const { recordPlatformUsage } = await import(
      "@/lib/agents1/platform-cost"
    );
    await recordPlatformUsage({
      class: "api_read",
      wall_ms: snap.cost.wall_ms,
      route: "/api/cron/probe",
      label: "probe_snapshot",
      skipped: true,
      await_persist: true,
    });
  } catch {
    /* */
  }
  return snap;
}

async function runTick() {
  const t0 = Date.now();
  const {
    loadProbeState,
    invalidateProbeCache,
    resolveAdaptiveProbeBudget,
  } = await import("@/lib/agents1/probe");

  const adaptive = await resolveAdaptiveProbeBudget();

  // Global cadence: adaptive window when on pace; never skip when behind
  try {
    const { readDisplayAuthority } = await import(
      "@/lib/agents1/display-authority"
    );
    invalidateProbeCache();
    const state0 = await loadProbeState({ mergeRemote: true });
    const auth = await readDisplayAuthority({
      used: state0.used,
      last_tick_at: state0.last_tick_at,
    });
    const lastIso = auth.last_tick_at || state0.last_tick_at;
    if (lastIso && !adaptive.behind) {
      const age = Date.now() - Date.parse(lastIso);
      if (Number.isFinite(age) && age >= 0 && age < adaptive.windowMs - 5_000) {
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
        await billProbeTick({
          wall_ms: Date.now() - t0,
          skipped: true,
          probed: 0,
        });
        return {
          ok: true,
          action: "probe_tick_skipped_cadence",
          probed: 0,
          used_today: usedHi,
          budget: state0.budget,
          live_active_probe_ok: live.total,
          skipped: true,
          adaptive,
          reason: `global cadence: last tick ${Math.round(age / 1000)}s ago (< ${Math.round(adaptive.windowMs / 1000)}s · on-pace)`,
          last_tick_at: lastIso,
          cost: {
            wall_ms: Date.now() - t0,
            mode: "skip_cadence",
            note: "Cheap skip — Fluid still bills 1 invocation + tiny Active CPU",
          },
          commit: {
            "data/prod/probes.json": probesRaw,
          },
        };
      }
    }
  } catch {
    /* continue to normal tick */
  }

  // Warm store cache — TTL-gated, never forceLive (saves Active CPU)
  try {
    const { getLiveSnapshot } = await import("@/lib/agents1/fetch-live");
    await getLiveSnapshot({ forceLive: false });
  } catch {
    try {
      const { loadStoreCache } = await import("@/lib/agents1/store-cache");
      await loadStoreCache();
    } catch {
      /* */
    }
  }

  const { runProbeTick } = await import("@/lib/agents1/growth/engine");
  invalidateProbeCache();
  const result = await runProbeTick({ max: adaptive.probesPerTick });

  invalidateProbeCache();
  const state = await loadProbeState({ mergeRemote: true });
  const lastIso = state.last_tick_at || new Date().toISOString();
  const lastMs = Date.parse(lastIso);
  const nextIso = new Date(
    (Number.isFinite(lastMs) ? lastMs : Date.now()) + adaptive.windowMs,
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
    scheduler: "vercel-cron-primary+github-actions-snapshot",
    fluid: true,
    last_tick_at: lastIso,
    next_tick_at: nextIso,
    last_result: result.last_result || null,
    probed: result.probed,
    used: state.used,
    ticks: Number(state.used || 0),
    live_active: live.total,
    adaptive,
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
  let cleanRaw: string | null = null;
  try {
    const { syncCleanFromProbeResults } = await import("@/lib/agents1/clean-registry");
    const clean = await syncCleanFromProbeResults(state.results || {});
    // Talk maintenance (cron only): after 7d grace + 7d quiet → remove.
    // Never runs on GET — so during the first week the number only goes up.
    try {
      const {
        loadTalkActivity,
        shouldDemoteForTalkLapse,
      } = await import("@/lib/agents1/talk-activity");
      const {
        removeCleanOnTalkLapse,
        listCleanItems,
        loadCleanRegistry,
      } = await import("@/lib/agents1/clean-registry");
      const act = await loadTalkActivity();
      const now = Date.now();
      for (const item of listCleanItems(clean)) {
        if (
          shouldDemoteForTalkLapse(
            item.approved_at || item.probed_at,
            act.presence?.[item.id],
            now,
          )
        ) {
          await removeCleanOnTalkLapse(item.id);
        }
      }
      const after = await loadCleanRegistry();
      cleanRaw = JSON.stringify(after, null, 2);
    } catch {
      cleanRaw = JSON.stringify(clean, null, 2);
    }
    await writeFile(join(dataRoot(), "clean-registry.json"), cleanRaw, "utf8").catch(() => undefined);
  } catch {
    try {
      cleanRaw = await readDurableRaw("clean-registry.json");
    } catch {
      cleanRaw = null;
    }
  }
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

  // Persist cost + agent-run ledgers in commit payload when available
  let platformCostRaw: string | null = null;
  let agentRunsRaw: string | null = null;
  try {
    const { loadPlatformCost } = await import("@/lib/agents1/platform-cost");
    platformCostRaw = JSON.stringify(await loadPlatformCost(), null, 2);
  } catch {
    platformCostRaw = null;
  }
  try {
    const { loadAgentRuns } = await import("@/lib/agents1/agent-runs");
    agentRunsRaw = JSON.stringify(await loadAgentRuns(), null, 2);
  } catch {
    agentRunsRaw = null;
  }

  const oks = live.total;
  const wall_ms = Date.now() - t0;
  await billProbeTick({
    wall_ms,
    skipped: false,
    probed: result.probed,
  });

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
    adaptive,
    notes: result.notes,
    worker,
    durable: durableConfigPublic(),
    cost: {
      wall_ms,
      mode: "full_tick",
      fluid: true,
      note: "Active CPU ≈ wall × ~0.18 (probe I/O wait free under Fluid)",
    },
    // For GitHub Actions commit
    commit: {
      "data/prod/probes.json": probesRaw,
      "data/prod/growth-state.json": growthRaw,
      "data/prod/delisted.json": delistRaw,
      "data/prod/counter-floors.json": floorsRaw,
      "data/prod/live-counters.json": liveCountersRaw,
      "data/prod/clean-registry.json": cleanRaw,
      "data/prod/platform-cost.json": platformCostRaw,
      "data/prod/agent-runs.json": agentRunsRaw,
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

async function handle(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { mode?: string } = {};
  if (request.method === "POST") {
    try {
      body = (await request.json()) as { mode?: string };
    } catch {
      body = {};
    }
  }
  try {
    if (wantsSnapshot(request, body)) {
      const snap = await runSnapshot();
      return Response.json(snap, {
        headers: { "cache-control": "no-store" },
      });
    }
    // Vercel Cron always runs full tick (with internal cadence skip)
    const out = await runTick();
    return Response.json(out, {
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
}

export const Route = createFileRoute("/api/cron/probe")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
