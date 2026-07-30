import { createServerFn } from "@tanstack/react-start";

const DASHBOARD_TIMEOUT_MS = 10_000;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function buildDashboardPayload(opts: {
  revalidate: boolean;
  forceLive: boolean;
}) {
  const { ensureGrowthScheduler } = await import("./growth/server");
  const { getLiveSnapshot } = await import("./fetch-live");
  try {
    // Best-effort in-process timers (Vite can drop these). Real cadence = probe-worker.
    ensureGrowthScheduler();
  } catch {
    /* non-blocking */
  }
  const snap = await withTimeout(
    getLiveSnapshot({
      revalidate: opts.revalidate,
      forceLive: opts.forceLive,
    }),
    opts.forceLive ? 12_000 : 9_000,
    "getLiveSnapshot",
  );
  let product_engagement = null;
  let listing_lanes = null;
  try {
    const { getProductEngagement } = await import("@/lib/products/engagement");
    product_engagement = await withTimeout(
      getProductEngagement(),
      2_500,
      "getProductEngagement",
    );
  } catch {
    /* non-blocking */
  }
  try {
    const { getLanedListings } = await import("./listing-lanes");
    listing_lanes = await withTimeout(
      getLanedListings(),
      3_000,
      "getLanedListings",
    );
  } catch {
    /* non-blocking */
  }
  let metrics_truth = null;
  try {
    const { buildMetricsTruthFromParts } = await import("./metrics-truth");
    metrics_truth = buildMetricsTruthFromParts({
      snap,
      product_engagement,
      listing_lanes,
    });
  } catch {
    /* non-blocking */
  }
  return JSON.parse(
    JSON.stringify({
      ...snap,
      product_engagement,
      listing_lanes,
      metrics_truth,
    }),
  );
}

/** Browser-safe: HTTP API first (survives stuck server-fn), then server fn. */
export async function fetchDashboardClient(opts?: {
  force?: boolean;
}): Promise<Record<string, unknown>> {
  const force = opts?.force === true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DASHBOARD_TIMEOUT_MS);
  try {
    const res = await fetch(
      force ? "/api/dashboard?live=1" : "/api/dashboard",
      { cache: "no-store", signal: controller.signal },
    );
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      if (json && (json.milestones || json.mcp || json.ok !== false)) {
        return json;
      }
    }
    throw new Error(`dashboard api ${res.status}`);
  } catch {
    try {
      return await withTimeout(
        force ? fetchDashboardForce() : fetchDashboard(),
        DASHBOARD_TIMEOUT_MS,
        "serverFn",
      );
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  } finally {
    clearTimeout(timer);
  }
}

export const fetchDashboard = createServerFn({ method: "GET" }).handler(
  async () => buildDashboardPayload({ revalidate: false, forceLive: false }),
);

/** Manual refresh may force a live attempt if budget allows. */
export const fetchDashboardForce = createServerFn({ method: "POST" }).handler(
  async () => buildDashboardPayload({ revalidate: true, forceLive: true }),
);

export const fetchGrowthStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { ensureGrowthScheduler, getGrowthStatus } = await import(
      "./growth/server"
    );
    ensureGrowthScheduler();
    return JSON.parse(JSON.stringify(await getGrowthStatus()));
  },
);

export const triggerGrowthCycle = createServerFn({ method: "POST" }).handler(
  async () => {
    const { ensureGrowthScheduler, runGrowthCycle } = await import(
      "./growth/server"
    );
    ensureGrowthScheduler();
    return JSON.parse(JSON.stringify(await runGrowthCycle()));
  },
);

export const submitListingByUrl = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => data)
  .handler(async ({ data }) => {
    const { ensureGrowthScheduler, submitByUrl } = await import(
      "./growth/server"
    );
    ensureGrowthScheduler();
    return JSON.parse(JSON.stringify(await submitByUrl(data.url)));
  });
