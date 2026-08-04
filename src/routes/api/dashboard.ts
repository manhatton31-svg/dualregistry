/**
 * Fast dashboard payload for the UI — never hangs forever.
 * Soft poll (default): parallel side panels only, target <2.5s, never 504.
 * ?refresh=1: same path + ops panels; does NOT forceLive re-probe the registry.
 * ?ops=1 / ?full=1: include cost / agent_runs / growth_scout.
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

  // Prefer array rows for tables; prefer max(array, counts) so timeout samples
  // never under-report clean-registry high-water counts.
  const mcpActive = Array.isArray(lanesIn?.mcp_active)
    ? lanesIn!.mcp_active!
    : [];
  const agentsActive = Array.isArray(lanesIn?.agents_active)
    ? lanesIn!.agents_active!
    : [];
  const mcpN = Math.max(
    mcpActive.length,
    Number(lanesIn?.counts?.mcp_active || 0) || 0,
  );
  const agN = Math.max(
    agentsActive.length,
    Number(lanesIn?.counts?.agents_active || 0) || 0,
  );

  const toItem = (row: Record<string, unknown>) => {
    const probe = (row.probe as Record<string, unknown> | null) || null;
    return {
      id: row.id,
      name: row.name,
      description: typeof row.description === "string"
        ? row.description.slice(0, 160)
        : row.description,
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

  // Single slim list for tables — avoid shipping full probe blobs twice
  const slimRow = (row: Record<string, unknown>) => {
    const probe = (row.probe as Record<string, unknown> | null) || null;
    return {
      id: row.id,
      name: row.name,
      description:
        typeof row.description === "string"
          ? row.description.slice(0, 160)
          : row.description,
      author: row.author,
      website: row.website,
      repository: row.repository,
      remote_url: row.remote_url,
      endpoint_url: row.endpoint_url,
      agent_card_url: row.agent_card_url,
      lane: "active",
      checks_clean: true,
      probe: probe
        ? { ok: true, handshake: probe.handshake || "ok", target: probe.target }
        : { ok: true },
      category_id: row.category_id,
      category_label: row.category_label,
      kind: row.kind,
      demoed: row.demoed,
      feedbacked: row.feedbacked,
      founder_n: row.founder_n,
    };
  };
  const mcpSlim = mcpActive.map(slimRow);
  const agSlim = agentsActive.map(slimRow);

  const listing_lanes = {
    mcp_active: mcpSlim,
    agents_active: agSlim,
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
    // Lightweight totals only — full rows live under listing_lanes (no triple copy)
    mcp: {
      ok: true,
      service: "dualregistry-clean",
      accepting: true,
      total: mcpN,
      clean_only: true,
      status: "live",
      items: [],
    },
    agents: {
      ok: true,
      service: "dualregistry-clean",
      accepting: true,
      total: agN,
      clean_only: true,
      status: "live",
      items: [],
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

async function attachSidePanels(
  timeoutMs: number,
  opts?: { full?: boolean },
) {
  const full = Boolean(opts?.full);
  const t = Math.max(800, Math.min(timeoutMs, full ? 3500 : 2200));

  // Critical path in parallel — never sequential timeout stacking
  const [
    product_engagement,
    listing_lanes,
    metrics_truth,
    protocol,
    eventUsage,
    outcomesLite,
    funnelHonesty,
  ] = await Promise.all([
    (async () => {
      try {
        const { getProductEngagement } = await import(
          "@/lib/products/engagement"
        );
        return await withTimeout(getProductEngagement(), t);
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { getLanedListings } = await import(
          "@/lib/agents1/listing-lanes"
        );
        // Soft path: allow longer hydrate so homepage does not flash zeros
        const laneT = Math.max(t, full ? 4500 : 5000);
        const lanes = await withTimeout(getLanedListings(), laneT);
        if (lanes) return lanes;
      } catch {
        /* fall through to clean-registry snapshot */
      }
      // Fail open: clean-registry is the durable authority (counts + sample rows)
      try {
        const { loadCleanRegistry } = await import(
          "@/lib/agents1/clean-registry"
        );
        const reg = await withTimeout(loadCleanRegistry(), 2000);
        if (!reg) return null;
        const items = Object.values(reg.items || {});
        const toRow = (it: {
          id: string;
          kind: string;
          name: string;
          target?: string;
          score?: number;
          probed_at?: string;
        }) => ({
          id: it.id,
          name: it.name,
          kind: it.kind,
          agent_card_url: it.kind === "agent" ? it.target : undefined,
          remote_url: it.kind === "mcp" ? it.target : undefined,
          checks_clean: true,
          probe: {
            ok: true,
            handshake: "ok",
            target: it.target,
            score: it.score,
            probed_at: it.probed_at,
          },
        });
        const mcp_active = items
          .filter((i) => i.kind === "mcp")
          .slice(0, 48)
          .map(toRow);
        const agents_active = items
          .filter((i) => i.kind === "agent")
          .slice(0, 48)
          .map(toRow);
        return {
          mcp_active,
          agents_active,
          mcp_discovered: [],
          agents_discovered: [],
          mcp_needs_resubmit: [],
          agents_needs_resubmit: [],
          counts: {
            mcp_active: reg.counts?.mcp ?? mcp_active.length,
            agents_active: reg.counts?.agents ?? agents_active.length,
            mcp_discovered: 0,
            agents_discovered: 0,
            mcp_needs_resubmit: 0,
            agents_needs_resubmit: 0,
            public_listed:
              (reg.counts?.mcp || 0) + (reg.counts?.agents || 0),
          },
          policy: reg.policy,
          degraded: true,
          source: "clean-registry-fallback",
        };
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { getMetricsTruth } = await import(
          "@/lib/agents1/metrics-truth"
        );
        return await withTimeout(getMetricsTruth(), t);
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { getProbePublic } = await import("@/lib/agents1/probe");
        // Do NOT invalidate cache on every soft poll — that forces disk/network work
        const probes = await withTimeout(getProbePublic(), t);
        return probes ? { probes } : null;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { getEventUsagePublic } = await import(
          "@/lib/products/event-pricing"
        );
        return await withTimeout(getEventUsagePublic(), Math.min(t, 1200));
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        // Lightweight: totals only via public, short timeout
        const { getFirstPrinciplesPublic } = await import(
          "@/lib/products/first-principles"
        );
        return await withTimeout(
          getFirstPrinciplesPublic({}),
          Math.min(t, 1200),
        );
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { getFunnelHonesty } = await import(
          "@/lib/products/funnel-honesty"
        );
        return await withTimeout(getFunnelHonesty(), Math.min(t, 1000));
      } catch {
        return null;
      }
    })(),
  ]);

  // Ops panels only on full refresh / when Platform ops needed — soft uses sticky
  let platform_cost = full ? null : lastGoodSide?.platform_cost ?? null;
  let agent_runs = full ? null : lastGoodSide?.agent_runs ?? null;
  let growth_scout = full ? null : lastGoodSide?.growth_scout ?? null;

  if (full) {
    const opsT = Math.min(4500, Math.max(t, 3000));
    const [cost, runs, scout] = await Promise.all([
      (async () => {
        try {
          const { loadPlatformCost, platformCostPublic } = await import(
            "@/lib/agents1/platform-cost"
          );
          return await withTimeout(
            loadPlatformCost().then(platformCostPublic),
            opsT,
          );
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const { loadAgentRuns, agentRunsPublic } = await import(
            "@/lib/agents1/agent-runs"
          );
          return await withTimeout(
            loadAgentRuns().then(agentRunsPublic),
            opsT,
          );
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const { getGrowthScoutStatus } = await import(
            "@/lib/agents1/growth/scout"
          );
          return await withTimeout(getGrowthScoutStatus(), opsT);
        } catch {
          return null;
        }
      })(),
    ]);
    platform_cost = cost;
    agent_runs = runs;
    growth_scout = scout;
  }

  // Hero from parallel results — no extra funnel/exonomics waterfall
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

    const tEv = (eventUsage as { totals?: Record<string, number> } | null)
      ?.totals;
    const event_events = Number(tEv?.total_events || 0);
    const event_free = Number(tEv?.free_events || 0);
    const event_paid = Number(tEv?.paid_events || 0);
    const event_refills = Number(tEv?.refill_grants_total || 0);

    const pe = product_engagement as {
      feedback_agent_only?: number;
      feedback_mcps?: number;
      feedback_agents?: number;
    } | null;
    const fh = funnelHonesty as {
      feedback?: {
        real_public?: number;
        real_agents?: number;
        real_mcps?: number;
      };
      demos?: { invited_pending?: number; self_serve?: number; real_public?: number };
    } | null;
    const feedback_agents = Number(
      fh?.feedback?.real_agents ??
        pe?.feedback_agent_only ??
        pe?.feedback_agents ??
        0,
    );
    const feedback_mcps = Number(
      fh?.feedback?.real_mcps ?? pe?.feedback_mcps ?? 0,
    );
    const feedback_real = Number(
      fh?.feedback?.real_public ?? feedback_agents + feedback_mcps,
    );

    const outcomes = Number(
      (outcomesLite as { totals?: { outcomes?: number } } | null)?.totals
        ?.outcomes || 0,
    );

    hero = {
      version: "1.2.0",
      feedback_source: fh?.feedback ? "funnel_honesty" : "engagement",
      demos_invited_pending: Number(fh?.demos?.invited_pending || 0),
      demos_self_serve: Number(fh?.demos?.self_serve || 0),
      demos_real_public: Number(fh?.demos?.real_public || 0),
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
      network_o: null,
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
        // refresh/live = refresh panels (parallel). Does NOT force re-probe whole registry.
        const userRefresh =
          url.searchParams.get("refresh") === "1" ||
          url.searchParams.get("live") === "1";
        // ops=1 loads cost/runs/scout (Platform ops expand only)
        const wantOps =
          url.searchParams.get("ops") === "1" ||
          url.searchParams.get("full") === "1";
        const headers = {
          "cache-control": userRefresh
            ? "no-store"
            : "private, max-age=30, stale-while-revalidate=60",
          "access-control-allow-origin": "*",
          "x-dashboard-mode": wantOps ? "full" : "soft",
        };

        try {
          // Soft path: skip getLiveSnapshot (heavy store revalidate) — lanes are enough
          // Full/Update: still avoid forceLive; only revalidate=false cache snapshot
          const side = await attachSidePanels(wantOps ? 4_500 : 5_000, {
            full: wantOps,
          });

          // Never block dashboard on production mirror or full store snapshot
          const body = {
            ok: true as const,
            ...side,
            soft: !wantOps && !userRefresh,
            metrics_source: wantOps ? "local-ops" : "local-fast",
          };

          return Response.json(
            cleanOnlyTotals(body as Record<string, unknown>),
            { headers },
          );
        } catch (e) {
          let protocol = null;
          try {
            const { getProbePublic } = await import("@/lib/agents1/probe");
            protocol = {
              probes: await withTimeout(getProbePublic(), 1500),
            };
          } catch {
            /* */
          }
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
          return Response.json(
            cleanOnlyTotals({
              ok: true,
              degraded: true,
              ...sticky,
              protocol: protocol || sticky.protocol,
              error: e instanceof Error ? e.message : String(e),
              message: "Partial dashboard — sticky panels kept where possible",
            } as Record<string, unknown>),
            { headers },
          );
        }
      },
    },
  },
});
