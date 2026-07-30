/**
 * A2A open catalog + federation list — read-safe (store cache only).
 */
import { loadStoreCache } from "./store-cache";
import { loadState } from "./growth/persist";
import type { AgentListing, McpListing } from "./types";

export type PublicAgent = {
  name: string;
  description?: string;
  url?: string;
  agent_card_url?: string;
  repository?: string;
  skills?: { name: string; description?: string }[];
  capabilities?: string[];
  protocols?: string[];
  safety_score?: number;
  status?: string;
  source: "store" | "queue" | "growth";
  lane?: "active" | "discovered" | "needs_resubmit";
  lane_reason?: string;
  checks_clean?: boolean;
  probe_ok?: boolean | null;
};

export type PublicMcp = {
  name: string;
  description?: string;
  repository?: string;
  website?: string;
  remote_url?: string;
  safety_score?: number;
  status?: string;
  source: "store" | "queue" | "growth";
  lane?: "active" | "discovered" | "needs_resubmit";
  lane_reason?: string;
  checks_clean?: boolean;
  probe_ok?: boolean | null;
};

function matchQ(
  q: string,
  fields: Array<string | undefined>,
): boolean {
  if (!q) return true;
  const n = q.toLowerCase();
  return fields.some((f) => f && f.toLowerCase().includes(n));
}

function skillMatch(
  skill: string | undefined,
  skills?: { name: string }[],
  caps?: string[],
): boolean {
  if (!skill) return true;
  const s = skill.toLowerCase();
  if (skills?.some((x) => x.name.toLowerCase().includes(s))) return true;
  if (caps?.some((c) => c.toLowerCase().includes(s))) return true;
  return false;
}

export async function listPublicAgents(opts?: {
  q?: string;
  skill?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  total: number;
  items: PublicAgent[];
  endpoint: string;
}> {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
  const offset = Math.max(0, opts?.offset ?? 0);
  const q = (opts?.q || "").trim();
  const skill = (opts?.skill || "").trim();

  const cache = await loadStoreCache();
  const items: PublicAgent[] = [];

  for (const a of cache.agent_items || []) {
    if (a.status && a.status !== "approved" && a.status !== "needs_review")
      continue;
    if (
      !matchQ(q, [a.name, a.description, a.author, a.repository, a.website])
    )
      continue;
    if (!skillMatch(skill, a.skills, a.capabilities)) continue;
    items.push({
      name: a.name,
      description: a.description,
      url: a.endpoint_url || a.website,
      agent_card_url: a.agent_card_url,
      repository: a.repository,
      skills: a.skills,
      capabilities: a.capabilities,
      protocols: a.protocols,
      safety_score: a.safety_score,
      status: a.status,
      source: "store",
    });
  }

  // Merge recent queue approvals / enriched agents (inbound free)
  try {
    const state = await loadState();
    for (const c of state.candidates) {
      if (c.kind !== "agent") continue;
      if (!["approved", "submitted", "enriched", "queued"].includes(c.status))
        continue;
      if (items.some((i) => i.name.toLowerCase() === c.name.toLowerCase()))
        continue;
      if (
        !matchQ(q, [c.name, c.description, c.repository, c.website, c.author])
      )
        continue;
      if (!skillMatch(skill, c.skills, c.capabilities)) continue;
      items.push({
        name: c.name,
        description: c.description,
        url: c.endpoint_url || c.website,
        agent_card_url: c.agent_card_url,
        repository: c.repository,
        skills: c.skills,
        capabilities: c.capabilities,
        protocols: c.protocols,
        safety_score: c.safety_score,
        status: c.status,
        source: "queue",
      });
    }
  } catch {
    /* */
  }

  items.sort(
    (a, b) => (b.safety_score ?? 0) - (a.safety_score ?? 0) || a.name.localeCompare(b.name),
  );
  const slice = items.slice(offset, offset + limit);
  return {
    total: items.length,
    items: slice,
    endpoint: "agents/public",
  };
}

export async function listPublicMcps(opts?: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; items: PublicMcp[] }> {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
  const offset = Math.max(0, opts?.offset ?? 0);
  const q = (opts?.q || "").trim();
  const cache = await loadStoreCache();
  const items: PublicMcp[] = [];

  for (const m of cache.mcp_items || []) {
    if (m.status && m.status !== "approved" && m.status !== "needs_review")
      continue;
    if (!matchQ(q, [m.name, m.description, m.author, m.repository, m.website]))
      continue;
    items.push({
      name: m.name,
      description: m.description,
      repository: m.repository,
      website: m.website,
      remote_url: m.remote_url,
      safety_score: m.safety_score,
      status: m.status,
      source: "store",
    });
  }

  try {
    const state = await loadState();
    for (const c of state.candidates) {
      if (c.kind !== "mcp") continue;
      if (!["approved", "submitted", "enriched", "queued"].includes(c.status))
        continue;
      if (items.some((i) => i.name.toLowerCase() === c.name.toLowerCase()))
        continue;
      if (!matchQ(q, [c.name, c.description, c.repository, c.website]))
        continue;
      items.push({
        name: c.name,
        description: c.description,
        repository: c.repository,
        website: c.website,
        remote_url: c.remote_url,
        safety_score: c.safety_score,
        status: c.status,
        source: "queue",
      });
    }
  } catch {
    /* */
  }

  items.sort(
    (a, b) => (b.safety_score ?? 0) - (a.safety_score ?? 0) || a.name.localeCompare(b.name),
  );
  return { total: items.length, items: items.slice(offset, offset + limit) };
}

export async function searchAgents(body: {
  query?: string;
  skill?: string;
  capability?: string;
  limit?: number;
}) {
  return listPublicAgents({
    q: body.query || body.capability,
    skill: body.skill || body.capability,
    limit: body.limit,
  });
}

/** Federation-friendly MCP registry-shaped list (read API for peers). */
export async function federationCatalog(origin: string) {
  const agents = await listPublicAgents({ limit: 100 });
  const mcps = await listPublicMcps({ limit: 100 });
  const cache = await loadStoreCache();
  return {
    name: "Agents1",
    role: "sub-registry",
    version: "1.2.0",
    origin,
    updated_at: cache.updated_at,
    counts: {
      agents: agents.total,
      mcp: mcps.total,
      store_mcp_approved: cache.mcp_approved,
      store_agents_approved: cache.agents_approved,
    },
    agents: agents.items,
    mcp: mcps.items,
    endpoints: {
      agents_public: `${origin}/agents/public`,
      agents_search: `${origin}/agents/search`,
      well_known_agents: `${origin}/.well-known/agents`,
      publish: `${origin}/api/publish`,
      score: `${origin}/api/score`,
      discovery: `${origin}/discovery.json`,
      list: `${origin}/list`,
    },
    consume_hint:
      "ETL this JSON or /agents/public into ToolHive / enterprise catalogs as a scored source",
  };
}


/** Lane-aware public catalog — active first, then discovered */
export async function listPublicAgentsLaned(opts?: {
  q?: string;
  skill?: string;
  limit?: number;
  offset?: number;
  lane?: "active" | "discovered" | "all";
}): Promise<{
  total: number;
  active: number;
  discovered: number;
  items: PublicAgent[];
  policy: Record<string, unknown>;
  endpoint: string;
}> {
  const { getLanedListings } = await import("./listing-lanes");
  const lanes = await getLanedListings();
  const lane = opts?.lane || "active";
  let rows = [
    ...(lane === "discovered" ? [] : lanes.agents_active),
    ...(lane === "active" ? [] : lanes.agents_discovered),
  ];
  const q = (opts?.q || "").trim();
  const skill = (opts?.skill || "").trim();
  if (q) {
    rows = rows.filter((r) =>
      matchQ(q, [r.name, r.description, r.author, r.repository, r.website]),
    );
  }
  if (skill) {
    rows = rows.filter((r) =>
      skillMatch(skill, undefined, undefined),
    );
  }
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
  const offset = Math.max(0, opts?.offset ?? 0);
  const slice = rows.slice(offset, offset + limit);
  return {
    total: rows.length,
    active: lanes.counts.agents_active,
    discovered: lanes.counts.agents_discovered,
    items: slice.map((a) => ({
      name: a.name,
      description: a.description,
      url: a.endpoint_url || a.website,
      agent_card_url: a.agent_card_url,
      repository: a.repository,
      safety_score: a.safety_score,
      status: a.status,
      source: a.source === "growth" ? "growth" : "store",
      lane: a.lane,
      lane_reason: a.lane_reason,
      checks_clean: a.checks_clean,
      probe_ok: a.probe?.ok ?? null,
    })),
    policy: lanes.policy,
    endpoint: "/api/listing-lanes?kind=agents",
  };
}

export async function listPublicMcpsLaned(opts?: {
  q?: string;
  limit?: number;
  offset?: number;
  lane?: "active" | "discovered" | "all";
}): Promise<{
  total: number;
  active: number;
  discovered: number;
  items: PublicMcp[];
  policy: Record<string, unknown>;
  endpoint: string;
}> {
  const { getLanedListings } = await import("./listing-lanes");
  const lanes = await getLanedListings();
  const lane = opts?.lane || "active";
  let rows = [
    ...(lane === "discovered" ? [] : lanes.mcp_active),
    ...(lane === "active" ? [] : lanes.mcp_discovered),
  ];
  const q = (opts?.q || "").trim();
  if (q) {
    rows = rows.filter((r) =>
      matchQ(q, [r.name, r.description, r.author, r.repository, r.website, r.remote_url]),
    );
  }
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
  const offset = Math.max(0, opts?.offset ?? 0);
  const slice = rows.slice(offset, offset + limit);
  return {
    total: rows.length,
    active: lanes.counts.mcp_active,
    discovered: lanes.counts.mcp_discovered,
    items: slice.map((m) => ({
      name: m.name,
      description: m.description,
      repository: m.repository,
      website: m.website,
      remote_url: m.remote_url,
      safety_score: m.safety_score,
      status: m.status,
      source: m.source === "growth" ? "growth" : "store",
      lane: m.lane,
      lane_reason: m.lane_reason,
      checks_clean: m.checks_clean,
      probe_ok: m.probe?.ok ?? null,
    })),
    policy: lanes.policy,
    endpoint: "/api/listing-lanes?kind=mcp",
  };
}
