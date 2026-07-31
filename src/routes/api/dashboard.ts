/**
 * Fast dashboard payload for the UI — never hangs forever.
 * Soft poll (default): cache + disk probes, target <2s, never 504.
 * ?refresh=1 / ?live=1: recompute verified numbers (harder timeout).
 *
 * PRODUCT: public totals + items are CLEAN ACTIVE ONLY (probe-first).
 * Store dump / delisted / discovered never leave this API.
 *
 * Side panels (cost / agent_runs / growth_scout) are sticky last-good:
 * timeout or empty isolate must NOT flash zeros.
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

/** Process-local last-good side panels — survives soft timeouts on this isolate. */
type SidePanels = {
  product_engagement: unknown;
  listing_lanes: unknown;
  metrics_truth: unknown;
  protocol: unknown;
  platform_cost: unknown;
  agent_runs: unknown;
  growth_scout: unknown;
  /** Compact 5 homepage stats — product-facing only */
  hero: unknown;
};

let lastGoodSide: SidePanels | null = null;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Prefer high-water for counter-ish side panels; never replace good with null/empty. */
function stickyPanel<T>(
  incoming: T | null | undefined,
  prev: T | null | undefined,
  score: (v: T) => number,
): T | null {
  if (incoming == null) return (prev as T) ?? null;
  if (prev == null) return incoming;
  try {
    return score(incoming) >= score(prev) ? incoming : prev;
  } catch {
    return incoming ?? prev ?? null;
  }
}

function scoreCost(v: unknown): number {
  const o = v as {
    running_total?: { today_usd?: number; month_usd_gross?: number };
    today?: { invocations?: number };
  };
  return (
    num(o?.running_total?.month_usd_gross) * 1e6 +
    num(o?.running_total?.today_usd) * 1e3 +
    num(o?.today?.invocations)
  );
}

function scoreRuns(v: unknown): number {
  const o = v as { totals?: { n?: number; ok?: number } };
  return num(o?.totals?.n) * 10 + num(o?.totals?.ok);
}

function scoreScout(v: unknown): number {
  const o = v as {
    month_invites?: number;
    day_invites?: number;
    month_usd?: number;
    invited_unique?: number;
  };
  return (
    num(o?.month_invites) * 1000 +
    num(o?.day_invites) * 100 +
    num(o?.invited_unique) * 10 +
    num(o?.month_usd) * 1e6
  );
}

function scoreLanes(v: unknown): number {
  const o = v as {
    counts?: { mcp_active?: number; agents_active?: number };
    mcp_active?: unknown[];
    agents_active?: unknown[];
  };
  const mcp = Array.isArray(o?.mcp_active)
    ? o.mcp_active.length
    : num(o?.counts?.mcp_active);
  const ag = Array.isArray(o?.agents_active)
    ? o.agents_active.length
    : num(o?.counts?.agents_active);
  return mcp + ag;
}

function scoreHero(v: unknown): number {
  const o = v as {
    live?: number;
    probes_today?: number;
    agent_events_today?: number;
    feedback_real?: number;
    outcomes?: number;
  };
  return (
    num(o?.live) * 1e6 +
    num(o?.probes_today) * 1e3 +
    num(o?.agent_events_today) * 100 +
    num(o?.feedback_real) * 10 +
    num(o?.outcomes)
  );
}

function applySticky(side: SidePanels): SidePanels {
  const prev = lastGoodSide;
  const next: SidePanels = {
    product_engagement:
      side.product_engagement ?? prev?.product_engagement ?? null,
    listing_lanes: stickyPanel(
      side.listing_lanes as object,
      prev?.listing_lanes as object,
      scoreLanes,
    ),
    metrics_truth: side.metrics_truth ?? prev?.metrics_truth ?? null,
    protocol: side.protocol ?? prev?.protocol ?? null,
    platform_cost: stickyPanel(
      side.platform_cost as object,
      prev?.platform_cost as object,
      scoreCost,
    ),
    agent_runs: stickyPanel(
      side.agent_runs as object,
      prev?.agent_runs as object,
      scoreRuns,
    ),
    growth_scout: stickyPanel(
      side.growth_scout as object,
      prev?.growth_scout as object,
      scoreScout,
    ),
    hero: stickyPanel(
      side.hero as object,
      prev?.hero as object,
      scoreHero,
    ),
  };
  // Only store when we have at least one real ops panel
  if (
    next.platform_cost ||
    next.agent_runs ||
    next.growth_scout ||
    next.listing_lanes ||
    next.hero
  ) {
    lastGoodSide = next;
  }
  return next;
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
  // Cost + agentic observability — allow more time; high-water load is cheap after warm
  const opsMs = Math.max(timeoutMs, 2500);
  try {
    const { loadPlatformCost, platformCostPublic } = await import(
      "@/lib/agents1/platform-cost"
    );
    platform_cost = await withTimeout(
      loadPlatformCost().then(platformCostPublic),
      opsMs,
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
      opsMs,
    );
  } catch {
    /* */
  }
  try {
    const { getGrowthScoutStatus } = await import(
      "@/lib/agents1/growth/scout"
    );
    growth_scout = await withTimeout(getGrowthScoutStatus(), opsMs);
  } catch {
    /* */
  }


  let hero: Record<string, unknown> | null = null;
  try {
    const lanes = listing_lanes as {
      counts?: { mcp_active?: number; agents_active?: number };
      mcp_active?: unknown[];
      agents_active?: unknown[];
    } | null;
    const mcpN = Array.isArray(lanes?.mcp_active)
      ? lanes!.mcp_active!.length
      : Number(lanes?.counts?.mcp_active || 0);
    const agN = Array.isArray(lanes?.agents_active)
      ? lanes!.agents_active!.length
      : Number(lanes?.counts?.agents_active || 0);
    const probes = (protocol as { probes?: Record<string, unknown> } | null)
      ?.probes;
    const byKind = (probes?.by_kind_today || {}) as {
      agents?: number;
      mcps?: number;
    };
    const fromKind =
      Number(byKind.agents || 0) + Number(byKind.mcps || 0);
    const probesToday = Number(
      probes?.used != null ? probes.used : fromKind || 0,
    );

    let event_events = 0;
    let event_free = 0;
    let event_paid = 0;
    let event_refills = 0;
    try {
      const { getEventUsagePublic } = await import(
        "@/lib/products/event-pricing"
      );
      const usage = await withTimeout(getEventUsagePublic(), 1500);
      const t = (usage as { totals?: Record<string, number> } | null)?.totals;
      event_events = Number(t?.total_events || 0);
      event_free = Number(t?.free_events || 0);
      event_paid = Number(t?.paid_events || 0);
      event_refills = Number(t?.refill_grants_total || 0);
    } catch {
      /* */
    }

    let feedback_agents = 0;
    let feedback_mcps = 0;
    let feedback_real = 0;
    try {
      const { getFunnelHonesty } = await import(
        "@/lib/products/funnel-honesty"
      );
      const fh = await withTimeout(getFunnelHonesty(), 2000);
      if (fh) {
        feedback_agents = Number(fh.feedback?.real_agents || 0);
        feedback_mcps = Number(fh.feedback?.real_mcps || 0);
        feedback_real = Number(
          fh.feedback?.real_public || feedback_agents + feedback_mcps,
        );
      }
    } catch {
      const pe = product_engagement as {
        feedback_agent_only?: number;
        feedback_mcps?: number;
      } | null;
      if (pe) {
        feedback_agents = Number(pe.feedback_agent_only || 0);
        feedback_mcps = Number(pe.feedback_mcps || 0);
        feedback_real = feedback_agents + feedback_mcps;
      }
    }

    let outcomes = 0;
    let network_o: number | null = null;
    try {
      const { getFirstPrinciplesPublic } = await import(
        "@/lib/products/first-principles"
      );
      const fp = await withTimeout(getFirstPrinciplesPublic({}), 1500);
      outcomes = Number(
        (fp as { totals?: { outcomes?: number } } | null)?.totals?.outcomes ||
          0,
      );
    } catch {
      /* */
    }
    try {
      const { getExonomicsPublic } = await import("@/lib/products/exonomics");
      const exo = await withTimeout(getExonomicsPublic({}), 1500);
      const o = (exo as { network_value?: { components?: { O?: number } } })
        ?.network_value?.components?.O;
      if (typeof o === "number" && Number.isFinite(o)) network_o = o;
    } catch {
      /* */
    }

    hero = {
      version: "1.0.0",
      live: mcpN + agN,
      live_mcp: mcpN,
      live_agents: agN,
      probes_today: probesToday,
      probes_agents: Number(byKind.agents || 0),
      probes_mcps: Number(byKind.mcps || 0),
      agent_events_today: event_events,
      agent_events_free: event_free,
      agent_events_paid: event_paid,
      agent_events_refills: event_refills,
      feedback_real,
      feedback_agents,
      feedback_mcps,
      unlock_agents: 250,
      unlock_mcps: 250,
      outcomes,
      network_o,
      updated_at: new Date().toISOString(),
    };
  } catch {
    hero = null;
  }

  return applySticky({
    product_engagement,
    listing_lanes,
    metrics_truth,
    protocol,
    platform_cost,
    agent_runs,
    growth_scout,
    hero,
  });
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
            const side = await attachSidePanels(5_000);
            const body = await applyProductionMirror(
              { ok: true, ...cached, ...side, degraded: true },
              request.url,
            );
            return Response.json(
              cleanOnlyTotals(body as Record<string, unknown>),
              { headers },
            );
          }

          const side = await attachSidePanels(6_000);
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
          // Prefer sticky side panels even on hard error
          const sticky = lastGoodSide || {
            product_engagement: null,
            listing_lanes: null,
            metrics_truth: null,
            protocol,
            platform_cost: null,
            agent_runs: null,
            growth_scout: null,
            hero: null,
          };
          const body = await applyProductionMirror(
            {
              ok: true,
              degraded: true,
              ...sticky,
              protocol: protocol || sticky.protocol,
              error: e instanceof Error ? e.message : String(e),
              message: "Partial dashboard — sticky panels kept where possible",
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
