/**
 * Public catalog = CLEAN ACTIVE ONLY (probe ok at source URL).
 * Never dump the store cache or unprobed queue.
 */
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
  source: "store" | "queue" | "growth" | "mirror";
  lane?: "active" | "discovered" | "needs_resubmit";
  lane_reason?: string;
  checks_clean?: boolean;
  probe_ok?: boolean | null;
  target?: string;
};

export type PublicMcp = {
  name: string;
  description?: string;
  repository?: string;
  website?: string;
  remote_url?: string;
  safety_score?: number;
  status?: string;
  source: "store" | "queue" | "growth" | "mirror";
  lane?: "active" | "discovered" | "needs_resubmit";
  lane_reason?: string;
  checks_clean?: boolean;
  probe_ok?: boolean | null;
  target?: string;
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
  skills?: { name?: string }[],
  caps?: string[],
): boolean {
  if (!skill) return true;
  const s = skill.toLowerCase();
  if (skills?.some((x) => (x.name || "").toLowerCase().includes(s)))
    return true;
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

  const { getLanedListings } = await import("./listing-lanes");
  const lanes = await getLanedListings();
  const items: PublicAgent[] = [];

  for (const a of lanes.agents_active || []) {
    if (
      !matchQ(q, [
        a.name,
        a.description,
        a.author,
        a.repository,
        a.website,
        a.agent_card_url,
        a.probe?.target,
      ])
    )
      continue;
    if (!skillMatch(skill, a.skills, a.capabilities)) continue;
    items.push({
      name: a.name,
      description: a.description,
      url: a.endpoint_url || a.website || a.probe?.target,
      agent_card_url: a.agent_card_url || a.probe?.target,
      repository: a.repository,
      skills: a.skills as PublicAgent["skills"],
      capabilities: a.capabilities,
      safety_score: a.safety_score,
      status: "approved",
      source: a.source,
      lane: "active",
      lane_reason: a.lane_reason,
      checks_clean: true,
      probe_ok: true,
      target: a.probe?.target || a.agent_card_url,
    });
  }

  items.sort(
    (a, b) =>
      (b.safety_score ?? 0) - (a.safety_score ?? 0) ||
      a.name.localeCompare(b.name),
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

  const { getLanedListings } = await import("./listing-lanes");
  const lanes = await getLanedListings();
  const items: PublicMcp[] = [];

  for (const m of lanes.mcp_active || []) {
    if (
      !matchQ(q, [
        m.name,
        m.description,
        m.author,
        m.repository,
        m.website,
        m.remote_url,
        m.probe?.target,
      ])
    )
      continue;
    items.push({
      name: m.name,
      description: m.description,
      repository: m.repository,
      website: m.website,
      remote_url: m.remote_url || m.probe?.target,
      safety_score: m.safety_score,
      status: "approved",
      source: m.source,
      lane: "active",
      lane_reason: m.lane_reason,
      checks_clean: true,
      probe_ok: true,
      target: m.probe?.target || m.remote_url,
    });
  }

  items.sort(
    (a, b) =>
      (b.safety_score ?? 0) - (a.safety_score ?? 0) ||
      a.name.localeCompare(b.name),
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

/** Federation-friendly MCP registry-shaped list (clean Active only). */
export async function federationCatalog(origin: string) {
  const agents = await listPublicAgents({ limit: 100 });
  const mcps = await listPublicMcps({ limit: 100 });
  return {
    name: "Dual Registry",
    role: "sub-registry",
    version: "2.0.0",
    origin,
    updated_at: new Date().toISOString(),
    policy: "clean_only_probe_first",
    counts: {
      agents: agents.total,
      mcp: mcps.total,
      store_mcp_approved: mcps.total,
      store_agents_approved: agents.total,
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
      active: `${origin}/api/listings/active`,
    },
    consume_hint:
      "Only probe-ok Active listings. Never treat store dumps as Dual Registry.",
  };
}
