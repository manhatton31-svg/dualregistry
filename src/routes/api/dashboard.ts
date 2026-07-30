/**
 * Fast dashboard payload for the UI — never hangs forever.
 * Soft poll (default): cache + disk probes, target <2s, never 504.
 * ?refresh=1 / ?live=1: recompute verified numbers (harder timeout).
 *
 * Grok sandbox / local: mirror dualregistry.dev public metrics so phone
 * production and sandbox always show the same demos/feedback/probes/times.
 */
import { createFileRoute } from "@tanstack/react-router";


function cleanOnlyTotals(body: Record<string, unknown>) {
  const lanes = body.listing_lanes as
    | {
        counts?: { mcp_active?: number; agents_active?: number };
        mcp_active?: unknown[];
        agents_active?: unknown[];
      }
    | null
    | undefined;
  const mcpN =
    lanes?.counts?.mcp_active ??
    (Array.isArray(lanes?.mcp_active) ? lanes!.mcp_active!.length : null);
  const agN =
    lanes?.counts?.agents_active ??
    (Array.isArray(lanes?.agents_active) ? lanes!.agents_active!.length : null);
  if (mcpN == null && agN == null) return body;
  const mcp = (body.mcp as Record<string, unknown>) || {};
  const agents = (body.agents as Record<string, unknown>) || {};
  return {
    ...body,
    // Public "in registry" = clean only
    mcp: { ...mcp, total: mcpN ?? 0, clean_only: true },
    agents: { ...agents, total: agN ?? 0, clean_only: true },
    delist: {
      delisted_total: 0,
      delisted_mcp: 0,
      delisted_agents: 0,
      hidden: true,
      note: "Fails are never listed — not shown as a public delisted dump",
    },
    registry_policy: "clean_only_probe_first",
  };
}

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
    if (u.searchParams.get("mirror") === "1") {
      return { ...payload, metrics_source: "production-local" };
    }
    if (!shouldMirrorProductionMetrics()) {
      return { ...payload, metrics_source: "production-local" };
    }
    const slice = await withTimeout(fetchProductionDashboardSlice(), 10_000);
    if (!slice) {
      return { ...payload, metrics_source: "local-mirror-failed" };
    }
    const baseMcp = payload.mcp as { total?: number } | undefined;
    const baseAgents = payload.agents as { total?: number } | undefined;
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
      // In Registry + milestones from production so cards match phone
      mcp:
        slice.mcp?.total != null && baseMcp
          ? { ...baseMcp, total: slice.mcp.total }
          : slice.mcp?.total != null
            ? { total: slice.mcp.total }
            : payload.mcp,
      agents:
        slice.agents?.total != null && baseAgents
          ? { ...baseAgents, total: slice.agents.total }
          : slice.agents?.total != null
            ? { total: slice.agents.total }
            : payload.agents,
      milestones: slice.milestones ?? payload.milestones,
      delist: slice.delist ?? payload.delist,
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
              const { invalidateMirrorCache } = await import(
                "@/lib/agents1/canonical-metrics"
              );
              invalidateMirrorCache();
            } catch {
              /* */
            }
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
            return Response.json(cleanOnlyTotals(body as Record<string, unknown>), { headers });
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
            return Response.json(cleanOnlyTotals(body as Record<string, unknown>), { headers });
          }

          const side = await attachSidePanels(3_000);
          const body = await applyProductionMirror(
            { ok: true, ...snap, ...side },
            request.url,
          );
          return Response.json(cleanOnlyTotals(body as Record<string, unknown>), { headers });
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
          return Response.json(cleanOnlyTotals(body as Record<string, unknown>), { headers });
        }
      },
    },
  },
});
