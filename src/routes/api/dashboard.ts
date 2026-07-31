/**
 * Fast dashboard payload for the UI — never hangs forever.
 * Soft poll (default): cache + disk probes, target <2s, never 504.
 * ?refresh=1 / ?live=1: recompute verified numbers (harder timeout).
 *
 * PRODUCT: public totals + items are CLEAN ACTIVE ONLY (probe-first).
 * Store dump / delisted / discovered never leave this API.
 */
import { createFileRoute } from "@tanstack/react-router";

function cleanOnlyTotals(body: Record<string, unknown>) {
  const lanesIn = body.listing_lanes as
    | {
        counts?: {
          mcp_active?: number;
          agents_active?: number;
          public_listed?: number;
        };
        mcp_active?: Array<Record<string, unknown>>;
        agents_active?: Array<Record<string, unknown>>;
        policy?: unknown;
        categories?: unknown;
      }
    | null
    | undefined;

  // Arrays are the source of truth — never trust mirrored store counts
  const mcpActive = Array.isArray(lanesIn?.mcp_active)
    ? lanesIn!.mcp_active!
    : [];
  const agentsActive = Array.isArray(lanesIn?.agents_active)
    ? lanesIn!.agents_active!
    : [];
  const mcpN = mcpActive.length;
  const agN = agentsActive.length;

  const toItem = (row: Record<string, unknown>) => {
    const probe = (row.probe as Record<string, unknown> | null) || null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      author: row.author,
      status: "approved",
      safety_score: row.safety_score,
      safety_flags: [],
      failed_checks: [],
      repository: row.repository,
      website: row.website,
      remote_url: row.remote_url,
      endpoint_url: row.endpoint_url,
      agent_card_url: row.agent_card_url,
      target: probe?.target || row.agent_card_url || row.remote_url,
      lane: "active",
      checks_clean: true,
      probe_ok: true,
      category_id: row.category_id,
      category_label: row.category_label,
    };
  };

  const listing_lanes = {
    mcp_active: mcpActive,
    agents_active: agentsActive,
    mcp_discovered: [],
    agents_discovered: [],
    mcp_needs_resubmit: [],
    agents_needs_resubmit: [],
    counts: {
      mcp_active: mcpN,
      agents_active: agN,
      mcp_discovered: 0,
      agents_discovered: 0,
      mcp_needs_resubmit: 0,
      agents_needs_resubmit: 0,
      public_listed: mcpN + agN,
    },
    policy: lanesIn?.policy,
    categories: lanesIn?.categories,
  };

  const prevMilestones =
    (body.milestones as Record<string, unknown> | undefined) || {};
  const prevMcp = (prevMilestones.mcp as Record<string, unknown>) || {};
  const prevAg = (prevMilestones.agents as Record<string, unknown>) || {};

  return {
    ...body,
    mcp: {
      ok: true,
      service: "dualregistry-clean",
      accepting: true,
      total: mcpN,
      clean_only: true,
      status: "live",
      items: mcpActive.map(toItem),
    },
    agents: {
      ok: true,
      service: "dualregistry-clean",
      accepting: true,
      total: agN,
      clean_only: true,
      status: "live",
      items: agentsActive.map(toItem),
    },
    milestones: {
      ...prevMilestones,
      ok: true,
      mcp: { ...prevMcp, approved: mcpN, unlimited: true, target: 0 },
      agents: { ...prevAg, approved: agN, unlimited: true, target: 0 },
      clean_only: true,
    },
    health: body.health
      ? {
          ...(body.health as object),
          registry: { accepting_submissions: true, approved: mcpN },
          agent_registry: { accepting_submissions: true, approved: agN },
        }
      : body.health,
    delist: {
      delisted_total: 0,
      delisted_mcp: 0,
      delisted_agents: 0,
      hidden: true,
      note: "Fails are never listed — discarded, not a public delisted dump",
    },
    listing_lanes,
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
  let platform_cost = null;
  let agent_runs = null;
  let growth_scout = null;

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
  // Cost + agentic observability (cheap local durable reads)
  try {
    const { loadPlatformCost, platformCostPublic } = await import(
      "@/lib/agents1/platform-cost"
    );
    platform_cost = await withTimeout(
      loadPlatformCost().then(platformCostPublic),
      Math.min(timeoutMs, 1500),
    );
  } catch {
    /* */
  }
  try {
    const { loadAgentRuns, agentRunsPublic } = await import(
      "@/lib/agents1/agent-runs"
    );
    agent_runs = await withTimeout(
      loadAgentRuns().then(agentRunsPublic),
      Math.min(timeoutMs, 1500),
    );
  } catch {
    /* */
  }
  try {
    const { getGrowthScoutStatus } = await import(
      "@/lib/agents1/growth/scout"
    );
    growth_scout = await withTimeout(
      getGrowthScoutStatus(),
      Math.min(timeoutMs, 1500),
    );
  } catch {
    /* */
  }
  return {
    product_engagement,
    listing_lanes,
    metrics_truth,
    protocol,
    platform_cost,
    agent_runs,
    growth_scout,
  };
}

/**
 * Mirror product engagement + probe cadence from production so sandbox
 * matches phone. Never mirror store-dump registry totals/items.
 */
async function applyProductionMirror<T extends Record<string, unknown>>(
  payload: T,
  requestUrl: string,
): Promise<T & { metrics_source?: string; mirrored_from?: string }> {
  try {
    const {
      shouldMirrorProductionMetrics,
      fetchProductionDashboardSlice,
    } = await import("@/lib/agents1/canonical-metrics");
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
      // Do NOT mirror mcp/agents/milestones/listing_lanes from production
      // when those still carry store-dump totals — cleanOnlyTotals owns them.
      metrics_source: "mirrored-production-engagement-only",
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
          "cache-control": userRefresh
            ? "no-store"
            : "private, max-age=45, stale-while-revalidate=90",
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

          if (!userRefresh) {
            const snap =
              (await withTimeout(
                getLiveSnapshot({ revalidate: false, forceLive: false }),
                3_000,
              )) || {};
            const side = await attachSidePanels(4_000);
            const body = await applyProductionMirror(
              { ok: true, ...snap, ...side, soft: true },
              request.url,
            );
            return Response.json(
              cleanOnlyTotals(body as Record<string, unknown>),
              { headers },
            );
          }

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
            const side = await attachSidePanels(4_000);
            const body = await applyProductionMirror(
              { ok: true, ...cached, ...side, degraded: true },
              request.url,
            );
            return Response.json(
              cleanOnlyTotals(body as Record<string, unknown>),
              { headers },
            );
          }

          const side = await attachSidePanels(5_000);
          const body = await applyProductionMirror(
            { ok: true, ...snap, ...side },
            request.url,
          );
          return Response.json(
            cleanOnlyTotals(body as Record<string, unknown>),
            { headers },
          );
        } catch (e) {
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
          return Response.json(
            cleanOnlyTotals(body as Record<string, unknown>),
            { headers },
          );
        }
      },
    },
  },
});
