/**
 * Soft probe snapshot for GH Actions durable commit without re-running a tick.
 * Vercel Cron is primary; Actions only POST when last_tick is stale.
 */
import { readDurableRaw } from "./durable-json";

export type ProbeSnapshotResult = {
  ok: true;
  action: "probe_snapshot";
  skipped: true;
  reason: string;
  used_today: number;
  last_tick_at: string | null;
  live_active_probe_ok: number;
  age_ms: number | null;
  stale: boolean;
  /** When true, Actions should POST a full tick as backup */
  needs_tick: boolean;
  commit: Record<string, string | null>;
  cost: {
    wall_ms: number;
    mode: "snapshot_only";
    note: string;
  };
};

const STALE_MS = 5.5 * 60_000; // slightly under 6m cadence

export async function buildProbeSnapshot(opts?: {
  stale_ms?: number;
}): Promise<ProbeSnapshotResult> {
  const t0 = Date.now();
  const staleMs = opts?.stale_ms ?? STALE_MS;

  const {
    loadProbeState,
    invalidateProbeCache,
  } = await import("./probe");
  invalidateProbeCache();
  const state = await loadProbeState({ mergeRemote: true });

  let used = Number(state.used || 0);
  let lastIso = state.last_tick_at || null;
  try {
    const { readDisplayAuthority } = await import("./display-authority");
    const auth = await readDisplayAuthority({
      used,
      last_tick_at: lastIso ?? undefined,
    });
    used = Math.max(used, auth.used || 0);
    if (auth.last_tick_at && (!lastIso || auth.last_tick_at >= lastIso)) {
      lastIso = auth.last_tick_at;
    }
  } catch {
    /* */
  }

  const live = state.live_active_snapshot || {
    total: 0,
    mcp: 0,
    agents: 0,
  };
  const age =
    lastIso && Number.isFinite(Date.parse(lastIso))
      ? Date.now() - Date.parse(lastIso)
      : null;
  const stale = age == null || age < 0 || age >= staleMs;

  const probesRaw = JSON.stringify(
    {
      ...state,
      used,
      last_tick_at: lastIso || state.last_tick_at,
    },
    null,
    2,
  );

  const commit: Record<string, string | null> = {
    "data/prod/probes.json": probesRaw,
    "data/prod/growth-state.json": await readDurableRaw("growth-state.json"),
    "data/prod/delisted.json": await readDurableRaw("delisted.json"),
    "data/prod/counter-floors.json": await readDurableRaw(
      "counter-floors.json",
    ),
    "data/prod/live-counters.json": await readDurableRaw(
      "live-counters.json",
    ),
    "data/prod/clean-registry.json": await readDurableRaw(
      "clean-registry.json",
    ),
    "data/prod/platform-cost.json": await readDurableRaw(
      "platform-cost.json",
    ),
    "data/prod/agent-runs.json": await readDurableRaw("agent-runs.json"),
    "data/prod/store-cache.json": await (async () => {
      const cacheRaw = await readDurableRaw("store-cache.json");
      if (!cacheRaw) return null;
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
    })(),
  };

  return {
    ok: true,
    action: "probe_snapshot",
    skipped: true,
    reason: stale
      ? `last_tick stale or missing (age_ms=${age}) — Actions should POST full tick`
      : `last_tick fresh (${Math.round((age || 0) / 1000)}s ago) — commit only, no re-probe`,
    used_today: used,
    last_tick_at: lastIso,
    live_active_probe_ok: Number(live.total || 0),
    age_ms: age,
    stale,
    needs_tick: stale,
    commit,
    cost: {
      wall_ms: Date.now() - t0,
      mode: "snapshot_only",
      note: "No probe work — soft durable pull for GH Actions de-dupe",
    },
  };
}
