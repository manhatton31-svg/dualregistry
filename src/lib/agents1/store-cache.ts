/**
 * Last-known-good store stats + listings.
 * Never show zeros when we previously had live numbers (worker outages, 1101s).
 * Free to use — local filesystem only, no paid APIs.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import { loadDurableJson, saveDurableJson } from "./durable-json";

import type {
  AgentListing,
  Health,
  McpListing,
  Milestones,
  RegistryPage,
} from "./types";

const CACHE_PATH = join(dataRoot(), "store-cache.json");

/** Floor from last known healthy production day — only used if cache empty. */
export const KNOWN_FLOOR = {
  mcp: 147,
  agents: 124,
  targets: { mcp: 0, agents: 0 }, // 0 = unlimited (no progress-bar ceiling)

} as const;

export type StoreCache = {
  updated_at: string;
  source: string;
  live: boolean;
  mcp_approved: number;
  agents_approved: number;
  mcp_target: number;
  agents_target: number;
  milestones?: Milestones;
  health?: Health;
  mcp_items?: McpListing[];
  agent_items?: AgentListing[];
  mcp_names?: string[];
  agent_names?: string[];
  mcp_repos?: string[];
  agent_repos?: string[];
  agent_cards?: string[];
  errors?: string[];
};

function side(approved: number, target: number) {
  const a = Math.max(0, approved);
  // target 0 = unlimited (no ceiling; progress not capped)
  if (!target || target <= 0) {
    return {
      approved: a,
      target: 0,
      remaining: null as unknown as number, // unlimited
      pct: null as unknown as number,
      ready: false,
      unlimited: true,
    };
  }
  const t = Math.max(1, target);
  return {
    approved: a,
    target: t,
    remaining: Math.max(0, t - a),
    pct: Math.round((a / t) * 1000) / 10,
    ready: a >= t,
    unlimited: false,
  };
}

export function buildMilestones(
  mcp: number,
  agents: number,
  opts?: { targets?: { mcp?: number; agents?: number }; base?: Milestones },
): Milestones {
  const mcpT = opts?.targets?.mcp ?? opts?.base?.targets?.mcp_approved ?? 0;
  const agentsT =
    opts?.targets?.agents ?? opts?.base?.targets?.agents_approved ?? 0;

  const base = opts?.base;
  return {
    ok: true,
    targets: { mcp_approved: mcpT, agents_approved: agentsT },
    mcp: side(mcp, mcpT),
    agents: side(agents, agentsT),
    solicit_ready: true,
    policy: base?.policy ?? {
      summary:
        "Solicit demos + feedback freely. Live payments open after 10 feedback agents + 5 feedback MCPs. Themes: first 3 agents personalized, 4th reuse ships sitewide.",
      when_ready:
        "Invite listed MCPs and agents to free Kernel/Loop demos and structured feedback. Watch the public improvement log for individual → sitewide ships.",
      product_surfaces: [
        "https://grok-agent-store.manhatton31.workers.dev/discovery.json",
        "https://grok-agent-store.manhatton31.workers.dev/skills.json",
        "https://grok-agent-store.manhatton31.workers.dev/agents.json",
        "https://grok-agent-store.manhatton31.workers.dev/registry.json",
      ],
    },

    updated_at: new Date().toISOString(),
  };
}

function emptyCache(): StoreCache {
  return {
    updated_at: new Date().toISOString(),
    source: "floor",
    live: false,
    mcp_approved: KNOWN_FLOOR.mcp,
    agents_approved: KNOWN_FLOOR.agents,
    mcp_target: KNOWN_FLOOR.targets.mcp,
    agents_target: KNOWN_FLOOR.targets.agents,
    milestones: buildMilestones(KNOWN_FLOOR.mcp, KNOWN_FLOOR.agents),
    mcp_items: [],
    agent_items: [],
    mcp_names: [],
    agent_names: [],
    mcp_repos: [],
    agent_repos: [],
    agent_cards: [],
  };
}

let mem: StoreCache | null = null;
let writeChain: Promise<void> = Promise.resolve();

export async function loadStoreCache(): Promise<StoreCache> {
  // Re-read disk / durable if another process updated the file
  try {
    let raw: string | null = null;
    try {
      raw = await readFile(CACHE_PATH, "utf8");
    } catch {
      const hydrated = await loadDurableJson<StoreCache | null>(
        "store-cache.json",
        () => null,
      );
      if (hydrated) raw = JSON.stringify(hydrated);
    }
    if (!raw) throw new Error("no cache");
    const parsed = JSON.parse(raw) as StoreCache;
    const disk = normalizeCache(parsed);
    if (
      !mem ||
      !mem.updated_at ||
      (disk.updated_at && disk.updated_at > mem.updated_at) ||
      disk.mcp_approved !== mem.mcp_approved ||
      disk.agents_approved !== mem.agents_approved
    ) {
      mem = disk;
    }
  } catch {
    if (!mem) {
      mem = emptyCache();
      await saveStoreCache(mem);
    }
  }
  if (mem && needsHydrate(mem)) {
    mem = await hydrateLocalListings(mem);

  }
  return mem!;
}

/** Force clear in-memory cache (tests / after CF day reset). */
export function invalidateStoreCacheMem() {
  mem = null;
}

function normalizeCache(c: Partial<StoreCache>): StoreCache {
  const base = emptyCache();
  // Prefer embedded milestones when present (authoritative snapshot)
  const milMcp = c.milestones?.mcp?.approved;
  const milAgents = c.milestones?.agents?.approved;
  let mcp =
    typeof milMcp === "number" && milMcp > 0
      ? milMcp
      : typeof c.mcp_approved === "number"
        ? c.mcp_approved
        : 0;
  let agents =
    typeof milAgents === "number" && milAgents > 0
      ? milAgents
      : typeof c.agents_approved === "number"
        ? c.agents_approved
        : 0;
  // Floor only if we have nothing (never-zero offline)
  if (mcp <= 0) mcp = KNOWN_FLOOR.mcp;
  if (agents <= 0) agents = KNOWN_FLOOR.agents;
  return {
    ...base,
    ...c,
    mcp_approved: mcp,
    agents_approved: agents,
    mcp_target: 0, // always unlimited
    agents_target: 0,
    milestones:
      c.milestones && (c.milestones.mcp?.approved ?? 0) > 0
        ? {
            ...c.milestones,
            // Force unlimited — never rehydrate old /500 ceilings
            mcp: side(mcp, 0),
            agents: side(agents, 0),
            targets: { mcp_approved: 0, agents_approved: 0 },
          }
        : buildMilestones(mcp, agents, {
            targets: { mcp: 0, agents: 0 },
            base: c.milestones,
          }),
    mcp_items: Array.isArray(c.mcp_items) ? c.mcp_items : [],
    agent_items: Array.isArray(c.agent_items) ? c.agent_items : [],
    mcp_names: Array.isArray(c.mcp_names) ? c.mcp_names : [],
    agent_names: Array.isArray(c.agent_names) ? c.agent_names : [],
    mcp_repos: Array.isArray(c.mcp_repos) ? c.mcp_repos : [],
    agent_repos: Array.isArray(c.agent_repos) ? c.agent_repos : [],
    agent_cards: Array.isArray(c.agent_cards) ? c.agent_cards : [],
    live: Boolean(c.live),
    source: c.source || "cache",
    updated_at: c.updated_at || new Date().toISOString(),
  };
}

export async function saveStoreCache(next: StoreCache): Promise<void> {
  const normalized = normalizeCache(next);
  mem = normalized;
  writeChain = writeChain.then(async () => {
    await saveDurableJson("store-cache.json", normalized);
    try {
      await mkdir(dirname(CACHE_PATH), { recursive: true });
      const tmp = `${CACHE_PATH}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(normalized, null, 2), "utf8");
      await rename(tmp, CACHE_PATH);
    } catch {
      /* */
    }
  });
  await writeChain;
}

/**
 * Merge live fetch results into cache.
 * Authoritative store milestones overwrite counts (no sticky inflation).
 * Only when offline / unusable live data do we keep last known good.
 */
export async function mergeLiveIntoCache(input: {
  live: boolean;
  source?: string;
  errors?: string[];
  milestones?: Milestones | null;
  health?: Health | null;
  mcp?: RegistryPage<McpListing> | null;
  agents?: RegistryPage<AgentListing> | null;
}): Promise<StoreCache> {
  const prev = await loadStoreCache();

  let mcpApproved = prev.mcp_approved;
  let agentsApproved = prev.agents_approved;
  let milestones = prev.milestones;
  let health = prev.health;
  let mcpItems = prev.mcp_items || [];
  let agentItems = prev.agent_items || [];
  let mcpNames = prev.mcp_names || [];
  let agentNames = prev.agent_names || [];
  let mcpRepos = prev.mcp_repos || [];
  let agentRepos = prev.agent_repos || [];
  let agentCards = prev.agent_cards || [];

  // Prefer explicit /v1/milestones as source of truth when live
  const liveMcp =
    input.milestones?.mcp?.approved ??
    input.health?.milestones?.mcp?.approved ??
    input.health?.registry?.approved;
  const liveAgents =
    input.milestones?.agents?.approved ??
    input.health?.milestones?.agents?.approved ??
    input.health?.agent_registry?.approved;

  if (input.live && typeof liveMcp === "number" && liveMcp >= 0) {
    mcpApproved = liveMcp;
  } else if (input.mcp && typeof input.mcp.total === "number" && input.mcp.total > 0) {
    // Registry page total only if no milestones (secondary signal)
    mcpApproved = input.mcp.total;
  }

  if (input.live && typeof liveAgents === "number" && liveAgents >= 0) {
    agentsApproved = liveAgents;
  } else if (
    input.agents &&
    typeof input.agents.total === "number" &&
    input.agents.total > 0
  ) {
    agentsApproved = input.agents.total;
  }

  // Offline / partial: never drop to zero — keep last known good
  if (!input.live || (liveMcp == null && liveAgents == null)) {
    mcpApproved = Math.max(prev.mcp_approved, mcpApproved, KNOWN_FLOOR.mcp);
    agentsApproved = Math.max(
      prev.agents_approved,
      agentsApproved,
      KNOWN_FLOOR.agents,
    );
  } else {
    // Still never show pure zeros if store glitches to empty
    if (mcpApproved === 0 && prev.mcp_approved > 0) mcpApproved = prev.mcp_approved;
    if (agentsApproved === 0 && prev.agents_approved > 0)
      agentsApproved = prev.agents_approved;
  }

  if (input.mcp?.items?.length) {
    const { sanitizeListings } = await import("./revalidate");
    mcpItems = sanitizeListings("mcp", input.mcp.items).items;
    mcpNames = mcpItems
      .map((i) => (i.name || "").toLowerCase())
      .filter(Boolean);
    mcpRepos = mcpItems
      .map((i) => (i.repository || "").toLowerCase())
      .filter(Boolean);
  }
  if (input.agents?.items?.length) {
    const { sanitizeListings } = await import("./revalidate");
    agentItems = sanitizeListings("agent", input.agents.items).items;
    agentNames = agentItems
      .map((i) => (i.name || "").toLowerCase())
      .filter(Boolean);
    agentRepos = agentItems
      .map((i) => (i.repository || "").toLowerCase())
      .filter(Boolean);
    agentCards = agentItems
      .map((i) => (i.agent_card_url || "").toLowerCase())
      .filter(Boolean);
  }

  if (input.milestones && input.live) {
    milestones = {
      ...input.milestones,
      mcp: side(
        mcpApproved,
        input.milestones.mcp?.target ?? mcpApproved,
      ),
      agents: side(
        agentsApproved,
        input.milestones.agents?.target ?? agentsApproved,
      ),
      solicit_ready: true,
      policy: {
        summary:
          "Solicit demos + feedback freely. Payments open after 10 feedback agents + 5 feedback MCPs.",
        when_ready:
          "Invite demos; feedback themes personalize first 3 agents then ship sitewide on reuse.",
        product_surfaces:
          input.milestones.policy?.product_surfaces ||
          prev.milestones?.policy?.product_surfaces ||
          [],
      },
      updated_at: new Date().toISOString(),
    };
  } else {
    milestones = buildMilestones(mcpApproved, agentsApproved, {
      base: input.milestones || prev.milestones,
    });
  }


  if (input.health && input.live) {
    health = {
      ...input.health,
      milestones,
      registry: {
        ...(input.health.registry || {}),
        approved: mcpApproved,
      },
      agent_registry: {
        ...(input.health.agent_registry || {}),
        approved: agentsApproved,
      },
    };
  } else if (input.health) {
    health = input.health;
  }

  const next: StoreCache = {
    updated_at: new Date().toISOString(),
    source: input.live
      ? input.source || "live"
      : prev.live
        ? "cache"
        : prev.source || "cache",
    live: Boolean(input.live),
    mcp_approved: mcpApproved,
    agents_approved: agentsApproved,
    mcp_target: 0, // 0 = unlimited (no cap; dedupe only)
    agents_target: 0,
    milestones,
    health,
    mcp_items: mcpItems,
    agent_items: agentItems,
    mcp_names: mcpNames,
    agent_names: agentNames,
    mcp_repos: mcpRepos,
    agent_repos: agentRepos,
    agent_cards: agentCards,
    errors: input.errors,
  };

  await saveStoreCache(next);
  return next;
}


/**
 * When upstream store is down, fill listing rows from growth queue + official mirror
 * so MCP/Agent registry tabs are never empty while counts are non-zero.
 */
function needsHydrate(cache: StoreCache) {
  const mcpN = cache.mcp_items?.length || 0;
  const agentN = cache.agent_items?.length || 0;
  return mcpN < 5 || agentN < 5;
}

function slugId(prefix: string, name: string) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${prefix}:${s || "item"}`;
}

export async function hydrateLocalListings(
  prev?: StoreCache,
): Promise<StoreCache> {
  const base = prev ?? (await loadStoreCacheRaw());
  if (!needsHydrate(base)) return base;

  let mcpItems = [...(base.mcp_items || [])];
  let agentItems = [...(base.agent_items || [])];
  const mcpNames = new Set(
    mcpItems.map((i) => (i.name || "").toLowerCase()).filter(Boolean),
  );
  const agentNames = new Set(
    agentItems.map((i) => (i.name || "").toLowerCase()).filter(Boolean),
  );

  // Growth queue (inbound free)
  try {
    const { loadState } = await import("./growth/persist");
    const state = await loadState();
    for (const c of state.candidates || []) {
      if (!["approved", "submitted", "enriched", "queued"].includes(c.status))
        continue;
      const key = (c.name || "").toLowerCase();
      if (!key) continue;
      if (c.kind === "mcp") {
        if (mcpNames.has(key)) continue;
        mcpNames.add(key);
        mcpItems.push({
          id: c.store_id || c.id || slugId("growth-mcp", c.name),
          name: c.name,
          description: c.description,
          repository: c.repository,
          website: c.website,
          remote_url: c.remote_url,
          author: c.author,
          status:
            c.status === "approved"
              ? "approved"
              : c.status === "queued"
                ? "needs_review"
                : "needs_review",
          safety_score: c.safety_score ?? 55,
          safety_flags: [],
          failed_checks: [],
          updated_at: c.updated_at,
        });
      } else if (c.kind === "agent") {
        if (agentNames.has(key)) continue;
        agentNames.add(key);
        agentItems.push({
          id: c.store_id || c.id || slugId("growth-agent", c.name),
          name: c.name,
          description: c.description,
          repository: c.repository,
          website: c.website,
          endpoint_url: c.endpoint_url,
          agent_card_url: c.agent_card_url,
          mcp_url: c.mcp_url,
          author: c.author,
          framework: c.framework,
          protocols: c.protocols,
          capabilities: c.capabilities,
          skills: c.skills,
          status:
            c.status === "approved"
              ? "approved"
              : "needs_review",
          safety_score: c.safety_score ?? 55,
          safety_flags: [],
          failed_checks: [],
          updated_at: c.updated_at,
        });
      }
    }
  } catch {
    /* */
  }

  // Official MCP mirror
  try {
    const { loadOfficialMirror } = await import("./official-mirror");
    const mirror = await loadOfficialMirror();
    for (const e of mirror.entries || []) {
      const key = (e.title || e.name || "").toLowerCase();
      if (!key || mcpNames.has(key) || mcpNames.has(e.name.toLowerCase()))
        continue;
      mcpNames.add(key);
      mcpNames.add(e.name.toLowerCase());
      mcpItems.push({
        id: slugId("mirror", e.name),
        name: e.title || e.name,
        description: e.description,
        repository: e.repository,
        website: e.website,
        remote_url: e.remote_url,
        author: e.namespace,
        status: "approved",
        safety_score: 72,
        safety_flags: [],
        failed_checks: [],
        updated_at: e.fetched_at,
      });
    }
  } catch {
    /* */
  }

  // Prefer higher safety / approved first
  mcpItems = mcpItems
    .sort(
      (a, b) =>
        (b.safety_score ?? 0) - (a.safety_score ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 300);
  agentItems = agentItems
    .sort(
      (a, b) =>
        (b.safety_score ?? 0) - (a.safety_score ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 300);

  const mcpApproved = Math.max(base.mcp_approved, mcpItems.length, KNOWN_FLOOR.mcp);
  const agentsApproved = Math.max(
    base.agents_approved,
    agentItems.length,
    KNOWN_FLOOR.agents,
  );

  const next: StoreCache = {
    ...base,
    updated_at: new Date().toISOString(),
    source:
      base.live
        ? base.source
        : mcpItems.length || agentItems.length
          ? "local-hydrate"
          : base.source,
    mcp_approved: mcpApproved,
    agents_approved: agentsApproved,
    milestones: buildMilestones(mcpApproved, agentsApproved, {
      base: base.milestones,
    }),
    mcp_items: mcpItems,
    agent_items: agentItems,
    mcp_names: mcpItems.map((i) => (i.name || "").toLowerCase()).filter(Boolean),
    agent_names: agentItems
      .map((i) => (i.name || "").toLowerCase())
      .filter(Boolean),
    mcp_repos: mcpItems
      .map((i) => (i.repository || "").toLowerCase())
      .filter(Boolean),
    agent_repos: agentItems
      .map((i) => (i.repository || "").toLowerCase())
      .filter(Boolean),
    agent_cards: agentItems
      .map((i) => (i.agent_card_url || "").toLowerCase())
      .filter(Boolean),
    errors: base.errors,
  };

  await saveStoreCache(next);
  return next;
}

/** Raw load without hydrate (avoids recursion). */
async function loadStoreCacheRaw(): Promise<StoreCache> {
  if (mem) return mem;
  try {
    const raw = await readFile(CACHE_PATH, "utf8");
    mem = normalizeCache(JSON.parse(raw) as StoreCache);
    return mem;
  } catch {
    mem = emptyCache();
    return mem;
  }
}


export function pageFromCache<T extends McpListing | AgentListing>(
  kind: "mcp" | "agent",
  cache: StoreCache,
): RegistryPage<T> {
  const raw = (
    kind === "mcp" ? cache.mcp_items || [] : cache.agent_items || []
  ) as T[];
  // Fail/partial delists: never show rejected/delisted in registry lists
  const items = raw.filter(
    (x) =>
      x.status !== "rejected" &&
      x.status !== "delisted" &&
      x.status !== "removed",
  );
  const total =
    kind === "mcp" ? cache.mcp_approved : cache.agents_approved;
  return {
    ok: true,
    service: "agents1-cache",
    accepting: true,
    total: Math.min(total, Math.max(items.length, total)),
    status: cache.live ? "live" : "cached",
    items,
  };
}
