import type {
  AgentListing,
  Health,
  LiveSnapshot,
  McpListing,
  Milestones,
  PollStatus,
  RegistryPage,
  SkillsGraph,
} from "./types";
import { STORE_BASE } from "./types";
import {
  applyRevalidation,
  buildRevalidateReport,
  sanitizeListings,
  type RevalidateReport,
} from "./revalidate";
import {
  buildMilestones,
  loadStoreCache,
  mergeLiveIntoCache,
  pageFromCache,
  hydrateLocalListings,
} from "./store-cache";
import {
  detectKvLimitMessage,
  isReadSafe,
  loadFreeTier,
  markLiveOk,
  publicBudgetView,
  recordGet,
  shouldLiveFetch,
  tripGetLimit,
  tripPutLimit,
} from "./free-tier";
import seedSkills from "./seed-skills.json";
import seedPoll from "./seed-poll.json";

async function fetchJson<T>(
  path: string,
  timeoutMs = 12000,
  opts?: { countGet?: boolean },
) {
  const url = path.startsWith("http") ? path : `${STORE_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (opts?.countGet !== false) {
      await recordGet(1);
    }
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Agents1Dashboard/1.0",
      },
      cache: "no-store",
    });
    const text = await res.text();
    const limitKind = detectKvLimitMessage(text);
    if (limitKind === "get") {
      await tripGetLimit(`store signal on ${path}: get() limit / 1101`);
      return {
        data: null as T | null,
        error: `${path} → get limit`,
        live: false,
      };
    }
    if (limitKind === "put") {
      await tripPutLimit(`store signal on ${path}: put() limit`);
      return {
        data: null as T | null,
        error: `${path} → put limit`,
        live: false,
      };
    }
    if (!res.ok) {
      if (res.status >= 500) {
        // treat repeated 500 registry as possible get exhaustion
        if (
          path.includes("agents") ||
          path.includes("registry") ||
          path.includes("milestones") ||
          path.includes("health") ||
          path.includes("poll")
        ) {
          // don't trip on single 500; only explicit messages
        }
      }
      return {
        data: null as T | null,
        error: `${path} → ${res.status}`,
        live: false,
      };
    }
    if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
      return {
        data: null as T | null,
        error: `${path} → non-JSON`,
        live: false,
      };
    }
    return { data: JSON.parse(text) as T, live: true };
  } catch (e) {
    return {
      data: null as T | null,
      error: `${path}: ${e instanceof Error ? e.message : String(e)}`,
      live: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

function asPage<T>(
  raw: unknown,
  fallback: RegistryPage<T>,
): RegistryPage<T> {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as RegistryPage<T>;
  const items = Array.isArray(o.items) ? o.items : fallback.items;
  const total =
    typeof o.total === "number" && o.total > 0
      ? o.total
      : items.length > 0
        ? items.length
        : fallback.total;
  return {
    ok: o.ok,
    service: o.service,
    accepting: o.accepting,
    total,
    status: o.status,
    items,
  };
}

function isUsablePage<T>(p: RegistryPage<T> | null | undefined): boolean {
  if (!p) return false;
  return (typeof p.total === "number" && p.total > 0) || (p.items?.length || 0) > 0;
}

function isUsableMilestones(m: Milestones | null | undefined): boolean {
  if (!m) return false;
  return (m.mcp?.approved ?? 0) > 0 || (m.agents?.approved ?? 0) > 0;
}

export type DashboardPayload = LiveSnapshot & {
  revalidate: RevalidateReport;
  storeSoftFails: { mcp: number; agents: number };
  cache_mode?: "live" | "cached" | "partial";
  cache_updated_at?: string;
  free_tier?: ReturnType<typeof publicBudgetView>;
  delist?: {
    delisted_mcp: number;
    delisted_agents: number;
    delisted_total: number;
  } | null;
};

async function snapshotFromCache(
  errors: string[],
  free: ReturnType<typeof publicBudgetView>,
  note: string,
): Promise<DashboardPayload> {
  const cache = await hydrateLocalListings(await loadStoreCache());
  const mcpCount =
    cache.milestones?.mcp?.approved ?? cache.mcp_approved;
  const agentCount =
    cache.milestones?.agents?.approved ?? cache.agents_approved;
  let mcpAdj = mcpCount;
  let agentAdj = agentCount;
  let delistMeta: {
    delisted_mcp: number;
    delisted_agents: number;
    delisted_total: number;
  } | null = null;
  try {
    const { registryCountsAfterDelist } = await import("./delist-on-fail");
    const adj = await registryCountsAfterDelist({
      mcp: mcpCount,
      agents: agentCount,
    });
    mcpAdj = adj.mcp;
    agentAdj = adj.agents;
    delistMeta = {
      delisted_mcp: adj.delisted_mcp,
      delisted_agents: adj.delisted_agents,
      delisted_total: adj.delisted_total,
    };
  } catch {
    /* */
  }
  const milestones =
    cache.milestones ||
    buildMilestones(mcpAdj, agentAdj);
  // Align top-level counts with milestones (authoritative when present)
  const aligned = {
    ...cache,
    mcp_approved: mcpAdj,
    agents_approved: agentAdj,
    milestones: {
      ...milestones,
      mcp: { ...milestones.mcp, approved: mcpAdj },
      agents: { ...milestones.agents, approved: agentAdj },
    },
  };
  const mcpPage = pageFromCache<McpListing>("mcp", aligned);
  const agentsPage = pageFromCache<AgentListing>("agent", aligned);
  const mcpSan = sanitizeListings("mcp", mcpPage.items);
  const agentsSan = sanitizeListings("agent", agentsPage.items);
  const mcp = { ...mcpPage, items: mcpSan.items, total: mcpAdj };
  const agents = { ...agentsPage, items: agentsSan.items, total: agentAdj };
  // Persist cleaned checks so yellow pills never return from cache alone
  if (mcpSan.clearedCount + agentsSan.clearedCount > 0) {
    void mergeLiveIntoCache({
      live: false,
      source: cache.source || "sanitize",
      mcp,
      agents,
      errors: cache.errors,
    });
  }
  const health: Health = {
    ok: true,
    service: "grok-agent-store",
    grok_configured: false,
    milestones: aligned.milestones,
    registry: {
      accepting_submissions: true,
      approved: mcpAdj,
    },
    agent_registry: {
      accepting_submissions: true,
      approved: agentAdj,
    },
    discovery: `${STORE_BASE}/discovery.json`,
  };
  return {
    fetchedAt: new Date().toISOString(),
    live: false,
    source: STORE_BASE,
    health,
    milestones: aligned.milestones,
    mcp: { ...mcp, total: mcpAdj },
    agents: { ...agents, total: agentAdj },
    skills: seedSkills as SkillsGraph,
    poll: seedPoll as PollStatus,
    errors: [...errors, note],
    delist: delistMeta,
    revalidate: {
      checkedAt: new Date().toISOString(),
      mcp: [],
      agents: [],
      summary: {
        mcpSoftFailBefore: 0,
        mcpSoftFailAfter: mcpSan.remainingDirty,
        agentSoftFailBefore: 0,
        agentSoftFailAfter: agentsSan.remainingDirty,
        falsePositivesCleared: mcpSan.clearedCount + agentsSan.clearedCount,
        realIssuesRemaining: mcpSan.remainingDirty + agentsSan.remainingDirty,
      },
      rootCauses: [
        {
          id: "free_tier_thrift",
          title: "Serving last-known-good (free-tier thrift)",
          detail: note,
          fix: "Live registry fetch resumes after TTL or UTC midnight reset.",
        },
        {
          id: "soft_checks_policy",
          title: "Catalog soft-check policy",
          detail:
            "Optional agent cards, skills, and infra flakes cleared on every load.",
          fix: "Hard fails only for confirmed broken surfaces.",
        },
      ],
    },
    storeSoftFails: {
      mcp: mcpSan.remainingDirty,
      agents: agentsSan.remainingDirty,
    },
    cache_mode: "cached",
    cache_updated_at: cache.updated_at,
    free_tier: free,
  };
}

export async function getLiveSnapshot(opts?: {
  revalidate?: boolean;
  forceLive?: boolean;
}): Promise<DashboardPayload> {
  const errors: string[] = [];
  const doRevalidate = opts?.revalidate !== false;
  const gate = await shouldLiveFetch({ force: opts?.forceLive });
  const free = publicBudgetView(gate.state);

  if (!gate.allow) {
    return snapshotFromCache(errors, free, gate.reason);
  }

  // Parallel heavy fetch counts as up to 4 gets (health, milestones, mcp, agents)
  // skills + poll only if get budget has headroom
  const getLeft = free.get.remaining;
  const wantSkillsPoll = getLeft > 10 && !isReadSafe(gate.state);

  const jobs: Promise<{ data: unknown; error?: string; live: boolean; tag: string }>[] = [
    fetchJson<Health>("/health", 10000).then((r) => ({ ...r, tag: "health" })),
    fetchJson<Milestones>("/v1/milestones", 10000).then((r) => ({
      ...r,
      tag: "milestones",
    })),
    fetchJson<RegistryPage<McpListing>>("/registry.json?limit=200", 18000).then(
      (r) => ({ ...r, tag: "mcp" }),
    ),
    fetchJson<RegistryPage<AgentListing>>("/agents.json", 12000).then((r) => ({
      ...r,
      tag: "agents",
    })),
  ];
  if (wantSkillsPoll) {
    jobs.push(
      fetchJson<SkillsGraph>("/skills.json", 10000, { countGet: false }).then(
        (r) => ({ ...r, tag: "skills" }),
      ),
    );
  }

  const results = await Promise.all(jobs);
  const byTag = Object.fromEntries(results.map((r) => [r.tag, r]));
  for (const r of results) {
    if (r.error) errors.push(r.error);
  }

  // Re-check after possible trip from 1101
  const after = await loadFreeTier();
  if (isReadSafe(after)) {
    return snapshotFromCache(
      errors,
      publicBudgetView(after),
      after.safe_reason || "read-safe after store get limit",
    );
  }

  const healthR = byTag.health as {
    data: Health | null;
    live: boolean;
  };
  const milestonesR = byTag.milestones as {
    data: Milestones | null;
    live: boolean;
  };
  const mcpR = byTag.mcp as {
    data: RegistryPage<McpListing> | null;
    live: boolean;
  };
  const agentsR = byTag.agents as {
    data: RegistryPage<AgentListing> | null;
    live: boolean;
  };
  const skillsR = byTag.skills as
    | { data: SkillsGraph | null; live: boolean }
    | undefined;

  const cache = await hydrateLocalListings(await loadStoreCache());
  const liveMilestones = isUsableMilestones(milestonesR.data)
    ? milestonesR.data
    : isUsableMilestones(healthR.data?.milestones)
      ? healthR.data!.milestones
      : null;

  const cacheMcpPage = pageFromCache<McpListing>("mcp", cache);
  const cacheAgentsPage = pageFromCache<AgentListing>("agent", cache);
  const liveMcp = mcpR.live && mcpR.data ? asPage(mcpR.data, cacheMcpPage) : null;
  const liveAgents =
    agentsR.live && agentsR.data
      ? asPage(agentsR.data, cacheAgentsPage)
      : null;

  const anyRegistryLive =
    Boolean(liveMilestones) ||
    isUsablePage(liveMcp) ||
    isUsablePage(liveAgents) ||
    Boolean(healthR.live && healthR.data?.ok);

  if (anyRegistryLive) await markLiveOk();

  let merged = await mergeLiveIntoCache({
    live: anyRegistryLive,
    source: STORE_BASE,
    errors,
    milestones: liveMilestones,
    health: healthR.data,
    mcp: isUsablePage(liveMcp) ? liveMcp : null,
    agents: isUsablePage(liveAgents) ? liveAgents : null,
  });
  // Upstream often 1101s — fill tabs from growth queue + official mirror
  merged = await hydrateLocalListings(merged);

  const milestones =
    liveMilestones ||
    merged.milestones ||
    buildMilestones(merged.mcp_approved, merged.agents_approved);

  // Display totals always follow merged (milestones-authoritative) counts,
  // then durable delists (fail/partial) are subtracted so In Registry drops.
  let mcpTotal = milestones.mcp?.approved ?? merged.mcp_approved;
  let agentsTotal = milestones.agents?.approved ?? merged.agents_approved;
  let delistMeta: {
    delisted_mcp: number;
    delisted_agents: number;
    delisted_total: number;
  } | null = null;
  try {
    const { registryCountsAfterDelist } = await import("./delist-on-fail");
    const adj = await registryCountsAfterDelist({
      mcp: mcpTotal,
      agents: agentsTotal,
    });
    mcpTotal = adj.mcp;
    agentsTotal = adj.agents;
    delistMeta = {
      delisted_mcp: adj.delisted_mcp,
      delisted_agents: adj.delisted_agents,
      delisted_total: adj.delisted_total,
    };
  } catch {
    /* */
  }

  let mcp: RegistryPage<McpListing> = isUsablePage(liveMcp)
    ? { ...liveMcp!, total: mcpTotal }
    : { ...pageFromCache<McpListing>("mcp", merged), total: mcpTotal };

  let agents: RegistryPage<AgentListing> = isUsablePage(liveAgents)
    ? {
        ...liveAgents!,
        total: agentsTotal,
      }
    : {
        ...pageFromCache<AgentListing>("agent", merged),
        total: agentsTotal,
      };

  // If live pages were empty shells, prefer hydrated items
  if (!mcp.items?.length && (merged.mcp_items?.length || 0) > 0) {
    mcp = { ...pageFromCache<McpListing>("mcp", merged), total: mcpTotal };
  }
  if (!agents.items?.length && (merged.agent_items?.length || 0) > 0) {
    agents = {
      ...pageFromCache<AgentListing>("agent", merged),
      total: agentsTotal,
    };
  }

  const health: Health =
    healthR.live && healthR.data
      ? {
          ...healthR.data,
          milestones,
          registry: {
            ...(healthR.data.registry || {}),
            approved: mcpTotal,
          },
          agent_registry: {
            ...(healthR.data.agent_registry || {}),
            approved: agentsTotal,
          },
        }
      : {
          ok: true,
          service: "grok-agent-store",
          grok_configured: false,
          milestones,
          registry: {
            accepting_submissions: true,
            approved: mcpTotal,
          },
          agent_registry: {
            accepting_submissions: true,
            approved: agentsTotal,
          },
          discovery: `${STORE_BASE}/discovery.json`,
        };

  // Always sanitize soft / false-positive checks (sync) — never show yellow
  // pills for optional agent cards, empty skills, or infra probe flakes.
  const mcpBefore = mcp.items.filter((i) => (i.failed_checks?.length || 0) > 0)
    .length;
  const agentsBefore = agents.items.filter(
    (i) => (i.failed_checks?.length || 0) > 0,
  ).length;
  {
    const ms = sanitizeListings("mcp", mcp.items);
    const as = sanitizeListings("agent", agents.items);
    mcp = { ...mcp, items: ms.items };
    agents = { ...agents, items: as.items };
  }

  let revalidate: RevalidateReport;
  if (doRevalidate && (mcp.items.length > 0 || agents.items.length > 0)) {
    revalidate = await buildRevalidateReport(mcp.items, agents.items);
    mcp = { ...mcp, items: applyRevalidation(mcp.items, revalidate.mcp) };
    agents = {
      ...agents,
      items: applyRevalidation(agents.items, revalidate.agents),
    };
  } else {
    const mcpDirty = mcp.items.filter((i) => (i.failed_checks?.length || 0) > 0)
      .length;
    const agentsDirty = agents.items.filter(
      (i) => (i.failed_checks?.length || 0) > 0,
    ).length;
    revalidate = {
      checkedAt: new Date().toISOString(),
      mcp: [],
      agents: [],
      summary: {
        mcpSoftFailBefore: mcpBefore,
        mcpSoftFailAfter: mcpDirty,
        agentSoftFailBefore: agentsBefore,
        agentSoftFailAfter: agentsDirty,
        falsePositivesCleared: Math.max(
          0,
          mcpBefore + agentsBefore - mcpDirty - agentsDirty,
        ),
        realIssuesRemaining: mcpDirty + agentsDirty,
      },
      rootCauses: [
        {
          id: "soft_checks_policy",
          title: "Catalog soft-check policy",
          detail:
            "Optional agent cards, skills derivation, and infra flakes are cleared on every load.",
          fix: "Hard fails only for confirmed broken surfaces; force Refresh for live re-probe.",
        },
      ],
    };
  }

  // Recompute after sanitize / revalidate
  const storeSoftFails = {
    mcp: mcp.items.filter((i) => (i.failed_checks?.length || 0) > 0).length,
    agents: agents.items.filter((i) => (i.failed_checks?.length || 0) > 0)
      .length,
  };

  // Persist cleaned listings so subsequent loads stay clean
  if (
    storeSoftFails.mcp + storeSoftFails.agents <
    mcpBefore + agentsBefore
  ) {
    await mergeLiveIntoCache({
      live: anyRegistryLive,
      source: anyRegistryLive ? STORE_BASE : "sanitize",
      mcp,
      agents,
      errors,
    });
  }

  const cache_mode: "live" | "cached" | "partial" = anyRegistryLive
    ? liveMilestones && isUsablePage(liveMcp) && isUsablePage(liveAgents)
      ? "live"
      : "partial"
    : "cached";

  if (!anyRegistryLive) {
    errors.push(
      "Registry live fetch empty — serving last-known-good free cache",
    );
  }

  const ft = publicBudgetView(await loadFreeTier());

  return {
    fetchedAt: new Date().toISOString(),
    live: anyRegistryLive,
    source: STORE_BASE,
    health,
    milestones: {
      ...milestones,
      mcp: { ...milestones.mcp, approved: mcpTotal },
      agents: { ...milestones.agents, approved: agentsTotal },
    },
    mcp: { ...mcp, total: mcpTotal },
    agents: { ...agents, total: agentsTotal },
    skills: skillsR?.data ?? (seedSkills as SkillsGraph),
    poll: seedPoll as PollStatus,
    errors,
    revalidate,
    storeSoftFails,
    cache_mode,
    cache_updated_at: merged.updated_at,
    free_tier: ft,
    delist: delistMeta,
  };
}
