/**
 * ARD — Agentic Resource Discovery catalog (/.well-known/ai-catalog.json)
 * Static Dual surfaces + dynamic Active clean listings projected as entries.
 * Federation: none | referrals | auto (bidirectional peer pull).
 */
import { agents1AgentCard, agents1McpServerCard } from "./a2a-card";
import { discoveryPack } from "@/lib/products/discovery-pack";

const ACTIVE_CATALOG_CAP = 80;
const PEER_FETCH_TIMEOUT_MS = 3_500;
const PEER_ENTRY_CAP = 12;

/** Peer catalogs for ARD federation referrals + auto pull. */
export const ARD_PEER_REFERRALS: Array<{
  displayName: string;
  catalog: string;
  note?: string;
  pull?: boolean;
}> = [
  {
    displayName: "Hugging Face ARD catalog",
    catalog: "https://huggingface.co/.well-known/ai-catalog.json",
    note: "Industry ARD publisher",
    pull: true,
  },
  {
    displayName: "Official MCP Registry (search)",
    catalog: "https://registry.modelcontextprotocol.io/v0/servers?search=",
    note: "Metaregistry metadata search — append query",
    pull: false,
  },
  {
    displayName: "GitHub Agent Finder public catalog",
    catalog: "https://github.com/github/agentfinder-catalog",
    note: "Copilot Agent Finder community catalog (PR Dual entries under docs/agentfinder)",
    pull: false,
  },
];

export type CatalogEntry = {
  identifier: string;
  displayName: string;
  type: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  representativeQueries?: string[];
  version?: string;
  updatedAt?: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

export function buildStaticCatalogEntries(origin: string): CatalogEntry[] {
  const o = origin.replace(/\/$/, "");
  const pack = discoveryPack(o);
  const card = agents1AgentCard(o);
  const mcp = agents1McpServerCard(o);
  const now = new Date().toISOString();

  return [
    {
      identifier: "urn:ai:dualregistry:a2a:dual-registry",
      displayName: "Dual Registry (A2A)",
      type: "application/a2a-agent-card+json",
      description:
        "Free dual registry for agents + MCPs. Probe ~6m to Live. Free demo. First 100 demo+feedback unlock full Kernel/Loop free.",
      tags: [
        "registry",
        "a2a",
        "mcp",
        "self-list",
        "demo",
        "kernel",
        "loop",
        "founding",
        "agentfinder",
      ],
      capabilities: [
        "list_agent",
        "list_mcp",
        "probe",
        "demo",
        "feedback",
        "search_active",
        "ard_search",
        "federation",
      ],
      representativeQueries: [
        "list my agent free on a dual registry",
        "MCP registry with live probes and Active clean list",
        "free Kernel Improver demo after I go Live",
        "founding free full product after feedback",
        "A2A agent card dual registry dualregistry.dev",
        "GitHub Copilot agent finder dual registry",
      ],
      version: card.version || "1.9.0",
      updatedAt: now,
      url: pack.agent_card_iana,
      metadata: {
        alternate_card: pack.agent_card,
        a2a_rpc: pack.a2a_rpc,
        skill: pack.skill_json,
        jwks: pack.jwks,
        agentfinder:
          "https://github.com/manhatton31-svg/dualregistry/tree/main/docs/agentfinder",
      },
    },
    {
      identifier: "urn:ai:dualregistry:mcp:io.agents1.registry",
      displayName: "Dual Registry MCP server",
      type: "application/mcp-server+json",
      description:
        "Federated Grok-scored sub-registry MCP. Dual-publish, free score, Active clean list, Kernel + Loop products.",
      tags: ["mcp", "registry", "tools", "streamable-http", "dual-publish"],
      capabilities: ["tools", "server_discover", "list", "score", "demo"],
      representativeQueries: [
        "MCP server to list myself on Dual Registry",
        "official-style MCP sub-registry with probe",
        "streamable HTTP MCP dualregistry",
      ],
      version: (mcp as { version?: string }).version || "1.9.0",
      updatedAt: now,
      url: pack.mcp_server_card,
      metadata: {
        name: "dev.dualregistry/registry",
        remotes: (mcp as { remotes?: unknown }).remotes,
        official_registry: pack.official_mcp_registry,
      },
    },
    {
      identifier: "urn:ai:dualregistry:skill:list-and-claim",
      displayName: "List yourself skill",
      type: "application/vnd.dualregistry.skill+json",
      description:
        "One-shot skill: publish → status → Talk → one-GET demo → feedback → founding free seat.",
      tags: ["skill", "self-list", "inbound", "portable", "agentfinder"],
      capabilities: ["list", "demo", "feedback"],
      representativeQueries: [
        "how does an agent list itself on Dual Registry",
        "portable skill pack dualregistry",
      ],
      version: "1.3.0",
      updatedAt: now,
      url: pack.skill_json,
      metadata: {
        markdown: pack.skill_md,
        github_skill:
          "https://github.com/manhatton31-svg/dualregistry/blob/main/skills/dualregistry/SKILL.md",
      },
    },
    {
      identifier: "urn:ai:dualregistry:openapi:api",
      displayName: "Dual Registry OpenAPI",
      type: "application/vnd.oai.openapi+json",
      description:
        "OpenAPI for publish, status, active, demo, feedback, talk, A2A.",
      tags: ["openapi", "rest", "tools"],
      capabilities: ["publish", "status", "demo", "feedback", "talk"],
      representativeQueries: [
        "OpenAPI for Dual Registry APIs",
        "agent tools list status demo feedback",
      ],
      version: "1.9.0",
      updatedAt: now,
      url: pack.openapi,
    },
    {
      identifier: "urn:ai:dualregistry:catalog:active",
      displayName: "Active clean listings",
      type: "application/json",
      description:
        "Live Active (checks-clean) agents + MCPs with take_demo on every row.",
      tags: ["catalog", "active", "clean", "demo"],
      capabilities: ["search", "take_demo"],
      representativeQueries: [
        "active clean MCP and agent list",
        "who is live on dual registry",
      ],
      version: "1.0.0",
      updatedAt: now,
      url: pack.active,
    },
  ];
}

/** Sync static catalog (no Active projection). Prefer buildAiCatalogAsync. */
export function buildAiCatalog(origin: string) {
  const o = origin.replace(/\/$/, "");
  const pack = discoveryPack(o);
  return {
    specVersion: "1.0",
    host: {
      displayName: "Dual Registry",
      identifier: "urn:ai:dualregistry:host:dualregistry",
      documentationUrl: `${o}/for-agents`,
      logoUrl: `${o}/favicon.svg`,
      website: o,
    },
    entries: buildStaticCatalogEntries(o),
    federation: {
      mode: "referrals" as const,
      bidirectional: true,
      point_agent_finder_at: `${o}/.well-known/ai-catalog.json`,
      search: `${o}/api/ard/search`,
      referrals: ARD_PEER_REFERRALS,
      note: "Peers may refer Dual; auto mode pulls peer catalogs into search hits",
    },
    dual_strategy: {
      mode: "outbound_plus_inbound",
      note: "We invite Active listings AND agents self-serve. Both always on.",
      surfaces: pack,
    },
  };
}

/** Full catalog: static Dual entries + Active clean listings as ARD entries. */
export async function buildAiCatalogAsync(origin: string) {
  const o = origin.replace(/\/$/, "");
  const base = buildAiCatalog(o);
  const dynamic: CatalogEntry[] = [];
  try {
    const { getLanedListings } = await import("./listing-lanes");
    const { loadCleanRegistry } = await import("./clean-registry");
    const lanes = await getLanedListings();
    const reg = await loadCleanRegistry();
    const cleanItems = reg.items || {};
    const clean = new Set(Object.keys(cleanItems));
    const rows = [
      ...(lanes.agents_active || []),
      ...(lanes.mcp_active || []),
    ]
      .filter((L) => L?.id && clean.has(L.id))
      .slice(0, ACTIVE_CATALOG_CAP);

    for (const L of rows) {
      const approved =
        (cleanItems[L.id] as { approved_at?: string; at?: string } | undefined)
          ?.approved_at ||
        (cleanItems[L.id] as { at?: string } | undefined)?.at ||
        new Date().toISOString();
      const cardUrl =
        L.agent_card_url ||
        L.remote_url ||
        L.endpoint_url ||
        `${o}/api/listings/status?id=${encodeURIComponent(L.id)}`;
      dynamic.push({
        identifier: `urn:ai:dualregistry:listing:${L.id}`,
        displayName: L.name,
        type:
          L.kind === "mcp"
            ? "application/mcp-server+json"
            : "application/a2a-agent-card+json",
        description: (
          L.description ||
          `Active clean ${L.kind} on Dual Registry — free demo available`
        ).slice(0, 280),
        tags: [L.kind, "active", "clean", "dualregistry", ...(L.tags || [])].slice(
          0,
          12,
        ),
        capabilities: ["status", "demo", "talk", ...(L.capabilities || [])].slice(
          0,
          12,
        ),
        representativeQueries: [
          `find ${L.name}`,
          `${L.kind} ${L.name} dual registry`,
          `demo for ${L.name}`,
        ],
        version: "1.0.0",
        updatedAt: approved,
        url: cardUrl,
        metadata: {
          listing_id: L.id,
          kind: L.kind,
          status: `${o}/api/listings/status?id=${encodeURIComponent(L.id)}`,
          demo: `${o}/api/products/demo?listing_id=${encodeURIComponent(L.id)}`,
          talk: `${o}/api/talk?listing_id=${encodeURIComponent(L.id)}`,
          agent_card_url: L.agent_card_url || null,
          website: L.website || null,
          source: L.source,
        },
      });
    }
  } catch {
    /* cold start — static only */
  }

  return {
    ...base,
    entries: [...base.entries, ...dynamic],
    active_projected: dynamic.length,
    updatedAt: new Date().toISOString(),
  };
}

export type ArdSearchHit = {
  identifier: string;
  displayName: string;
  type: string;
  description?: string;
  url?: string;
  score: number;
  tags?: string[];
  representativeQueries?: string[];
  source?: "dual" | "peer";
  peer?: string;
};

export type ArdFederationMode = "none" | "referrals" | "auto";

async function pullPeerCatalog(
  peerUrl: string,
  query: string,
): Promise<ArdSearchHit[]> {
  if (!peerUrl.startsWith("https://") || peerUrl.includes("search=")) return [];
  try {
    const res = await fetch(peerUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryARD/2.2 (+https://dualregistry.dev; federation)",
      },
      signal: AbortSignal.timeout(PEER_FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      entries?: Array<Record<string, unknown>>;
      resources?: Array<Record<string, unknown>>;
    };
    const entries = j.entries || j.resources || [];
    const q = query.toLowerCase();
    const hits: ArdSearchHit[] = [];
    for (const e of entries.slice(0, 40)) {
      const displayName = String(e.displayName || e.name || e.title || "");
      const description = String(e.description || "");
      const identifier = String(
        e.identifier || e.id || e.url || displayName || "peer",
      );
      const type = String(e.type || e.mediaType || "application/json");
      const url = typeof e.url === "string" ? e.url : peerUrl;
      const blob = `${displayName} ${description} ${identifier}`.toLowerCase();
      let score = 0;
      if (!q) score = 8;
      else {
        for (const t of q.split(/\s+/).filter(Boolean)) {
          if (blob.includes(t)) score += 10;
        }
        if (displayName.toLowerCase().includes(q)) score += 12;
      }
      if (score <= 0) continue;
      hits.push({
        identifier: identifier.startsWith("urn:")
          ? identifier
          : `urn:ai:peer:${identifier}`,
        displayName: displayName || identifier,
        type,
        description: description.slice(0, 280) || undefined,
        url,
        score: Math.min(35, score),
        tags: ["peer", "federation"],
        source: "peer",
        peer: peerUrl,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, PEER_ENTRY_CAP);
  } catch {
    return [];
  }
}

/** Keyword / query match over ARD catalog + optional bidirectional federation. */
export async function ardSearch(
  origin: string,
  query: string,
  opts?: { limit?: number; federation?: ArdFederationMode },
): Promise<{
  query: string;
  total: number;
  hits: ArdSearchHit[];
  catalog: string;
  federation: ArdFederationMode;
  referrals?: typeof ARD_PEER_REFERRALS;
  peers_pulled?: Array<{ catalog: string; hits: number; ok: boolean }>;
}> {
  const q = (query || "").trim().toLowerCase();
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 12));
  const federation: ArdFederationMode = opts?.federation || "referrals";
  const catalog = await buildAiCatalogAsync(origin);
  const hits: ArdSearchHit[] = [];

  for (const e of catalog.entries) {
    let score = 0;
    if (!q) {
      score = e.identifier.includes(":listing:") ? 30 : 40;
    } else {
      const blob = [
        e.displayName,
        e.description,
        ...(e.tags || []),
        ...(e.capabilities || []),
        ...(e.representativeQueries || []),
        e.identifier,
      ]
        .join(" ")
        .toLowerCase();
      for (const token of q.split(/\s+/).filter(Boolean)) {
        if (blob.includes(token)) score += 15;
      }
      for (const rq of e.representativeQueries || []) {
        if (rq.toLowerCase().includes(q)) score += 25;
      }
      if (e.displayName.toLowerCase().includes(q)) score += 20;
      if (
        e.identifier.includes(":listing:") &&
        e.displayName.toLowerCase().includes(q)
      )
        score += 15;
    }
    if (score > 0) {
      hits.push({
        identifier: e.identifier,
        displayName: e.displayName,
        type: e.type,
        description: e.description,
        url: e.url,
        score,
        tags: e.tags,
        representativeQueries: e.representativeQueries,
        source: "dual",
      });
    }
  }

  const peers_pulled: Array<{ catalog: string; hits: number; ok: boolean }> =
    [];

  if (federation === "auto") {
    const pullable = ARD_PEER_REFERRALS.filter((p) => p.pull);
    const peerHits = await Promise.all(
      pullable.map(async (p) => {
        const ph = await pullPeerCatalog(p.catalog, query);
        peers_pulled.push({
          catalog: p.catalog,
          hits: ph.length,
          ok: ph.length > 0,
        });
        return ph;
      }),
    );
    for (const ph of peerHits) hits.push(...ph);
  }

  hits.sort((a, b) => b.score - a.score);
  const sliced = hits.slice(0, limit);

  const out: {
    query: string;
    total: number;
    hits: ArdSearchHit[];
    catalog: string;
    federation: ArdFederationMode;
    referrals?: typeof ARD_PEER_REFERRALS;
    peers_pulled?: typeof peers_pulled;
  } = {
    query: query || "",
    total: hits.length,
    hits: sliced,
    catalog: `${origin.replace(/\/$/, "")}/.well-known/ai-catalog.json`,
    federation,
  };

  if (federation === "referrals" || federation === "auto") {
    out.referrals = ARD_PEER_REFERRALS.map((r) =>
      r.catalog.endsWith("search=")
        ? { ...r, catalog: `${r.catalog}${encodeURIComponent(query || "mcp")}` }
        : r,
    );
  }
  if (federation === "auto") out.peers_pulled = peers_pulled;

  return out;
}
