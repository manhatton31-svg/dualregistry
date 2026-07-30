/**
 * Fast dashboard payload for the UI — never hangs forever.
 * Soft poll (default): cache + disk probes, target <2s, never 504.
 * ?refresh=1 / ?live=1: recompute verified numbers (harder timeout).
 *
 * Grok sandbox / local: mirror dualregistry.dev public metrics so phone
 * production and sandbox always show the same demos/feedback/probes/times.
 */
import { createFileRoute } from "@tanstack/react-router";

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function attachSidePanels(timeoutMs: number) {
  let product_engagement = null;
  let listing_lanes = null;
  let metrics_truth = null;
  let protocol = null;

  try {
    const { getProductEngagement } = await import(
      "@/lib/products/engagement"
    );
    product_engagement = await withTimeout(getProductEngagement(), timeoutMs);
  } catch {
    /* */
  }
  try {
    const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
    listing_lanes = await withTimeout(getLanedListings(), timeoutMs);
  } catch {
    /* */
  }
  try {
    const { getMetricsTruth } = await import("@/lib/agents1/metrics-truth");
    metrics_truth = await withTimeout(getMetricsTruth(), timeoutMs);
  } catch {
    /* */
  }
  try {
    const { getProbePublic, invalidateProbeCache } = await import(
      "@/lib/agents1/probe"
    );
    invalidateProbeCache();
    const probes = await getProbePublic();
    protocol = { probes };
  } catch {
    /* */
  }
  return { product_engagement, listing_lanes, metrics_truth, protocol };
}

/** Overlay production metrics onto local payload (sandbox match). */
async function applyProductionMirror<T extends Record<string, unknown>>(
  payload: T,
  requestUrl: string,
): Promise<T & { metrics_source?: string; mirrored_from?: string }> {
  try {
    const {
      shouldMirrorProductionMetrics,
      fetchProductionDashboardSlice,
    } = await import("@/lib/agents1/canonical-metrics");
    // Avoid infinite loop if production is called with mirror=1 from itself
    const u = new URL(requestUrl);
    if (u.searchParams.get("mirror") === "1") return payload;
    if (!shouldMirrorProductionMetrics()) {
      return { ...payload, metrics_source: "production-local" };
    }
    const slice = await withTimeout(fetchProductionDashboardSlice(), 10_000);
    if (!slice) {
      return { ...payload, metrics_source: "local-mirror-failed" };
    }
    return {
      ...payload,
      product_engagement:
        slice.product_engagement ?? payload.product_engagement,
      protocol: {
        ...((payload.protocol as object) || {}),
        probes:
          slice.protocol?.probes ??
          (payload.protocol as { probes?: unknown })?.probes,
      },
      // Keep lane counts aligned when production has them
      listing_lanes: payload.listing_lanes
        ? {
            ...(payload.listing_lanes as object),
            counts:
              slice.listing_lanes?.counts ||
              (payload.listing_lanes as { counts?: unknown })?.counts,
          }
        : payload.listing_lanes,
      metrics_source: "mirrored-production",
      mirrored_from: slice.mirrored_from,
      mirrored_at: slice.mirrored_at,
    };
  } catch {
    return payload;
  }
}

export const Route = createFileRoute("/api/dashboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const userRefresh =
          url.searchParams.get("refresh") === "1" ||
          url.searchParams.get("live") === "1";
        const headers = {
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        };

        try {
          const { getLiveSnapshot } = await import("@/lib/agents1/fetch-live");
          try {
            const { ensureGrowthScheduler } = await import(
              "@/lib/agents1/growth/server"
            );
            ensureGrowthScheduler();
          } catch {
            /* */
          }

          if (userRefresh) {
            try {
              const { reloadOrdersFromDisk } = await import(
                "@/lib/products/orders"
              );
              await reloadOrdersFromDisk();
            } catch {
              /* */
            }
          }

          // Soft poll: cache only, never wait on live store crawls
          if (!userRefresh) {
            const snap =
              (await withTimeout(
                getLiveSnapshot({ revalidate: false, forceLive: false }),
                3_000,
              )) || {};
            const side = await attachSidePanels(2_000);
            const body = await applyProductionMirror(
              { ok: true, ...snap, ...side, soft: true },
              request.url,
            );
            return Response.json(body, { headers });
          }

          // Hard refresh: allow live revalidate with hard ceiling
          const snap = await withTimeout(
            getLiveSnapshot({ revalidate: true, forceLive: true }),
            10_000,
          );
          if (!snap) {
            const cached =
              (await withTimeout(
                getLiveSnapshot({ revalidate: false, forceLive: false }),
                3_000,
              )) || {};
            const side = await attachSidePanels(2_500);
            const body = await applyProductionMirror(
              { ok: true, ...cached, ...side, degraded: true },
              request.url,
            );
            return Response.json(body, { headers });
          }

          const side = await attachSidePanels(3_000);
          const body = await applyProductionMirror(
            { ok: true, ...snap, ...side },
            request.url,
          );
          return Response.json(body, { headers });
        } catch (e) {
          // Last resort: probes-only so Overview never goes blank
          let protocol = null;
          try {
            const { getProbePublic, invalidateProbeCache } = await import(
              "@/lib/agents1/probe"
            );
            invalidateProbeCache();
            protocol = { probes: await getProbePublic() };
          } catch {
            /* */
          }
          const body = await applyProductionMirror(
            {
              ok: true,
              degraded: true,
              protocol,
              error: e instanceof Error ? e.message : String(e),
              message: "Partial dashboard — probe stats still live",
            },
            request.url,
          );
          return Response.json(body, { headers });
        }
      },
    },
  },
});
