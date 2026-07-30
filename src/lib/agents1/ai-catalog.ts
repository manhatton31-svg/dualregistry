/**
 * ARD — Agentic Resource Discovery catalog (/.well-known/ai-catalog.json)
 * Find-before-invoke layer pointing at Dual Registry A2A / MCP / skill / OpenAPI.
 */
import { agents1AgentCard, agents1McpServerCard } from "./a2a-card";
import { discoveryPack } from "@/lib/products/discovery-pack";

export function buildAiCatalog(origin: string) {
  const o = origin.replace(/\/$/, "");
  const pack = discoveryPack(o);
  const card = agents1AgentCard(o);
  const mcp = agents1McpServerCard(o);
  const now = new Date().toISOString();

  return {
    specVersion: "1.0",
    host: {
      displayName: "Dual Registry",
      identifier: "urn:ai:dualregistry:host:dualregistry",
      documentationUrl: `${o}/for-agents`,
      logoUrl: `${o}/favicon.svg`,
      website: o,
    },
    entries: [
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
          name: "io.agents1.registry",
          remotes: (mcp as { remotes?: unknown }).remotes,
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
        metadata: {
          markdown: pack.skill_md,
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
    ],
    dual_strategy: {
      mode: "outbound_plus_inbound",
      note: "We invite Active listings AND agents self-serve. Both always on.",
      surfaces: pack,
    },
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

/** Simple keyword / query match over ARD catalog entries + active listing names. */
export async function ardSearch(
  origin: string,
  query: string,
  opts?: { limit?: number },
): Promise<{
  query: string;
  total: number;
  hits: ArdSearchHit[];
  catalog: string;
}> {
  const q = (query || "").trim().toLowerCase();
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 12));
  const catalog = buildAiCatalog(origin);
  const hits: ArdSearchHit[] = [];

  for (const e of catalog.entries) {
    let score = 0;
    if (!q) {
      score = 40;
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

  // Optional: match Active clean names
  if (q) {
    try {
      const { getLanedListings } = await import("./listing-lanes");
      const { loadCleanRegistry } = await import("./clean-registry");
      const lanes = await getLanedListings();
      const reg = await loadCleanRegistry();
      const clean = new Set(Object.keys(reg.items || {}));
      const rows = [
        ...(lanes.agents_active || []),
        ...(lanes.mcp_active || []),
      ].filter((L) => L?.id && clean.has(L.id));
      for (const L of rows) {
        const name = (L.name || "").toLowerCase();
        if (!name.includes(q) && !q.split(/\s+/).some((t) => name.includes(t)))
          continue;
        hits.push({
          identifier: `urn:ai:dualregistry:listing:${L.id}`,
          displayName: L.name,
          type:
            L.kind === "mcp"
              ? "application/mcp-server+json"
              : "application/a2a-agent-card+json",
          description: `Active clean ${L.kind} on Dual Registry`,
          url: `${origin.replace(/\/$/, "")}/api/listings/status?id=${encodeURIComponent(L.id)}`,
          score: 50 + (name === q ? 20 : 0),
          tags: [L.kind, "active", "clean"],
        });
      }
    } catch {
      /* */
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const sliced = hits.slice(0, limit);
  return {
    query: query || "",
    total: hits.length,
    hits: sliced,
    catalog: `${origin.replace(/\/$/, "")}/.well-known/ai-catalog.json`,
  };
}
