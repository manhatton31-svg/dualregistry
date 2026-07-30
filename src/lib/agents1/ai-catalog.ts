/**
 * ARD — Agentic Resource Discovery catalog (/.well-known/ai-catalog.json)
 * Static Dual surfaces + dynamic Active clean listings projected as entries.
 * Federation: none | referrals | auto
 */
import { agents1AgentCard, agents1McpServerCard } from "./a2a-card";
import { discoveryPack } from "@/lib/products/discovery-pack";

const ACTIVE_CATALOG_CAP = 80;

/** Peer catalogs for ARD federation referrals (static well-known). */
export const ARD_PEER_REFERRALS: Array<{
  displayName: string;
  catalog: string;
  note?: string;
}> = [
  {
    displayName: "Hugging Face ARD catalog",
    catalog: "https://huggingface.co/.well-known/ai-catalog.json",
    note: "Industry ARD publisher",
  },
  {
    displayName: "Official MCP Registry (search)",
    catalog: "https://registry.modelcontextprotocol.io/v0/servers?search=",
    note: "Metaregistry metadata search — append query",
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
      ],
      capabilities: [
        "list_agent",
        "list_mcp",
        "probe",
        "demo",
        "feedback",
        "search_active",
      ],
      representativeQueries: [
        "list my agent free on a dual registry",
        "MCP registry with live probes and Active clean list",
        "free Kernel Improver demo after I go Live",
        "founding free full product after feedback",
        "A2A agent card dual registry dualregistry.dev",
      ],
      version: card.version || "1.9.0",
      updatedAt: now,
      url: pack.agent_card_iana,
      metadata: {
        alternate_card: pack.agent_card,
        a2a_rpc: pack.a2a_rpc,
        skill: pack.skill_json,
        jwks: pack.jwks,
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
      tags: ["skill", "self-list", "inbound", "portable"],
      capabilities: ["list", "demo", "feedback"],
      representativeQueries: [
        "how does an agent list itself on Dual Registry",
        "portable skill pack dualregistry",
      ],
      version: "1.3.0",
      updatedAt: now,
      url: pack.skill_json,
      metadata: { markdown: pack.skill_md },
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
      referrals: ARD_PEER_REFERRALS,
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
};

export type ArdFederationMode = "none" | "referrals" | "auto";

/** Keyword / query match over ARD catalog (with Active projection) + optional federation. */
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
      if (e.identifier.includes(":listing:") && e.displayName.toLowerCase().includes(q))
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
      });
    }
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

  // auto: best-effort fetch peer catalog titles (no deep merge — referrals only to keep latency low)
  if (federation === "auto" && q) {
    /* referrals already attached; clients follow */
  }

  return out;
}
