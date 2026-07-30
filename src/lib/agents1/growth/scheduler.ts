import {
  GROWTH_INTERVAL_MS,
  GROWTH_INTERVAL_THROTTLED_MS,
  PROBE_TICK_MS,
  isFullyThrottled,
  loadFreeTier,
  msUntilUtcMidnight,
  cyclePutCap,
} from "../free-tier";
import { loadState, saveState, syncKvFromFreeTier } from "./persist";
import { runGrowthCycle, runProbeTick } from "./engine";

const g = globalThis as typeof globalThis & {
  __agents1GrowthTimer__?: ReturnType<typeof setInterval>;
  __agents1ProbeTimer__?: ReturnType<typeof setInterval>;
  __agents1ProbePoll__?: ReturnType<typeof setInterval>;
  __agents1FeedbackTimer__?: ReturnType<typeof setInterval>;
  __agents1ShipCadenceTimer__?: ReturnType<typeof setInterval>;
  __agents1SelfLoopTimer__?: ReturnType<typeof setInterval>;
  __agents1GrowthStarted__?: boolean;
  __agents1ProbeIntervalMs__?: number;
  __agents1LastProbeAt__?: number;
};

const FEEDBACK_DRIVE_MS = 6 * 60 * 1000;
const SHIP_CADENCE_MS = 30 * 60 * 1000;
const SELF_LOOP_MS = 20 * 60 * 1000;

/**
 * Production (Vercel): probes ONLY via GitHub Actions → POST /api/cron/probe.
 * In-process boot/interval probes on every cold start caused 20–70s double-ticks.
 */
function actionsOnlyProbes(): boolean {
  if (process.env.AGENTS1_PROBE_MODE === "actions-only") return true;
  if (process.env.AGENTS1_PROBE_MODE === "local") return false;
  if (process.env.VERCEL === "1") return true;
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview")
    return true;
  return false;
}

export function ensureGrowthScheduler(): void {
  const probeLocally = !actionsOnlyProbes();

  // Always rebind when cadence changes
  if (
    g.__agents1GrowthStarted__ &&
    g.__agents1ProbeIntervalMs__ === (probeLocally ? PROBE_TICK_MS : 0) &&
    (probeLocally ? Boolean(g.__agents1ProbeTimer__ && g.__agents1ProbePoll__) : true)
  ) {
    return;
  }

  if (g.__agents1GrowthTimer__) clearInterval(g.__agents1GrowthTimer__);
  if (g.__agents1ProbeTimer__) clearInterval(g.__agents1ProbeTimer__);
  if (g.__agents1ProbePoll__) clearInterval(g.__agents1ProbePoll__);
  if (g.__agents1FeedbackTimer__) clearInterval(g.__agents1FeedbackTimer__);
  if (g.__agents1ShipCadenceTimer__) clearInterval(g.__agents1ShipCadenceTimer__);
  if (g.__agents1SelfLoopTimer__) clearInterval(g.__agents1SelfLoopTimer__);

  g.__agents1GrowthStarted__ = true;
  g.__agents1ProbeIntervalMs__ = probeLocally ? PROBE_TICK_MS : 0;
  g.__agents1LastProbeAt__ = 0;

  const fireProbe = async (reason: string) => {
    if (!probeLocally) {
      console.info(`[agents1-probe] skip ${reason} — Actions-only production probes`);
      return;
    }
    try {
      const r = await runProbeTick({ max: 1 });
      g.__agents1LastProbeAt__ = Date.now();
      console.info(
        `[agents1-probe] ${reason} +${r.probed} · ${r.notes.slice(0, 4).join(" · ")}`,
      );
      try {
        const { runFeedbackDrive } = await import(
          "@/lib/products/feedback-drive"
        );
        await runFeedbackDrive();
      } catch (e) {
        console.error("[agents1-feedback-drive] after-probe", e);
      }
    } catch (e) {
      console.error("[agents1-probe]", reason, e);
    }
  };

  // Boot: probe + feedback immediately so numbers move without waiting
  setTimeout(() => {
    void (async () => {
      if (probeLocally) await fireProbe("boot");
      try {
        const ft = await loadFreeTier();
        if (!isFullyThrottled(ft)) {
          await runGrowthCycle().catch((e) =>
            console.error("[agents1-growth] initial", e),
          );
        }
      } catch (e) {
        console.error("[agents1-growth] boot", e);
      }
    })();
  }, 5_000);

  // Growth cycle (discover + put)
  g.__agents1GrowthTimer__ = setInterval(() => {
    void (async () => {
      try {
        const state = await loadState();
        if (!state.scheduler.enabled || state.scheduler.running) return;
        const ft = await loadFreeTier();
        const last = state.scheduler.last_run_at
          ? Date.parse(state.scheduler.last_run_at)
          : 0;
        const interval = isFullyThrottled(ft)
          ? Math.min(msUntilUtcMidnight(), GROWTH_INTERVAL_THROTTLED_MS)
          : cyclePutCap(ft) <= 0
            ? GROWTH_INTERVAL_THROTTLED_MS
            : GROWTH_INTERVAL_MS;
        if (Date.now() - last < interval - 1000) return;
        await runGrowthCycle();
      } catch (e) {
        console.error("[agents1-growth] scheduled", e);
      }
    })();
  }, 30_000);

  if (probeLocally) {
    // Primary 6-minute probe timer (local/dev only)
    g.__agents1ProbeTimer__ = setInterval(() => {
      void fireProbe("tick-6m");
    }, PROBE_TICK_MS);

    // Catch-up poll every 30s
    g.__agents1ProbePoll__ = setInterval(() => {
      const last = g.__agents1LastProbeAt__ || 0;
      if (Date.now() - last >= PROBE_TICK_MS - 2000) {
        void fireProbe("poll-catchup");
      }
    }, 30_000);
  } else {
    console.info("[agents1-probe] production: probes only via GitHub Actions → /api/cron/probe");
  }

  g.__agents1FeedbackTimer__ = setInterval(() => {
    void (async () => {
      try {
        const { runFeedbackDrive } = await import(
          "@/lib/products/feedback-drive"
        );
        await runFeedbackDrive();
      } catch (e) {
        console.error("[agents1-feedback-drive]", e);
      }
    })();
  }, FEEDBACK_DRIVE_MS);

  g.__agents1ShipCadenceTimer__ = setInterval(() => {
    void (async () => {
      try {
        const { runShipCadence } = await import("@/lib/products/ship-cadence");
        await runShipCadence();
      } catch (e) {
        console.error("[agents1-ship-cadence]", e);
      }
    })();
  }, SHIP_CADENCE_MS);

  g.__agents1SelfLoopTimer__ = setInterval(() => {
    void (async () => {
      try {
        const { runSelfLoop } = await import("@/lib/products/self-loop");
        await runSelfLoop();
      } catch (e) {
        console.error("[agents1-self-loop]", e);
      }
    })();
  }, SELF_LOOP_MS);

  setTimeout(() => {
    void (async () => {
      try {
        const { runSelfLoop } = await import("@/lib/products/self-loop");
        await runSelfLoop({ force: true });
      } catch (e) {
        console.error("[agents1-self-loop] boot", e);
      }
    })();
  }, 25_000);

  // Only unref growth poller — probe/feedback stay REF'd so process keeps ticking
  if (g.__agents1GrowthTimer__) {
    (g.__agents1GrowthTimer__ as { unref?: () => void }).unref?.();
  }

  void (async () => {
    const state = await loadState();
    state.scheduler.enabled = true;
    state.scheduler.interval_ms = GROWTH_INTERVAL_MS;
    state.kv = await syncKvFromFreeTier(state.kv);
    state.scheduler.next_run_at = new Date(
      Date.now() + GROWTH_INTERVAL_MS,
    ).toISOString();
    await saveState(state);
  })();
}

export async function setGrowthEnabled(enabled: boolean) {
  const state = await loadState();
  state.scheduler.enabled = enabled;
  await saveState(state);
}

export async function getGrowthStatus() {
  const { getGrowthStatus: status } = await import("./engine");
  return status();
}

export { runGrowthCycle } from "./engine";
