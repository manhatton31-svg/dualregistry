/**
 * Interoperability fabric — Dual as one hallway across protocols.
 *
 * P0: Unified capability graph (listing × MCP × A2A × ARD × trails)
 * P0: Protocol adapters (mcp ↔ a2a ↔ ard ↔ http)
 * P1: Interop tools + bidirectional federation bus
 * P1: Reciprocity as interop proof → trail boost
 * P2: Session context object across protocol entrypoints
 *
 * Durable: interop.json (sessions + federation peers + graph cache meta)
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";

export const INTEROP_VERSION = "2.7.0";
const DURABLE = "interop.json";

export type ProtocolKind = "mcp" | "a2a" | "ard" | "http" | "dns";

export type CapabilityNode = {
  id: string;
  listing_id?: string;
  name: string;
  kind?: "agent" | "mcp" | "dual" | "peer";
  protocols: ProtocolKind[];
  mcp_tools: string[];
  a2a_skills: string[];
  ard_tags: string[];
  endpoints: {
    mcp?: string;
    a2a?: string;
    http?: string;
    card?: string;
    status?: string;
    demo?: string;
  };
  trail_score?: number;
  reciprocity_score?: number;
  acceleration_boost?: number;
  clean?: boolean;
  source: "dual_active" | "dual_self" | "federation_peer" | "session";
};

export type ProtocolAdapter = {
  from: ProtocolKind;
  to: ProtocolKind;
  method: string;
  note: string;
  example: Record<string, unknown>;
};

export type InteropSession = {
  id: string;
  created_at: string;
  updated_at: string;
  entry_protocol: ProtocolKind;
  listing_id?: string;
  agent_name?: string;
  steps: Array<{
    at: string;
    action: string;
    protocol?: ProtocolKind;
    detail?: string;
  }>;
  match_q?: string;
  match_hits?: string[];
  demo_order_id?: string;
  feedback_id?: string;
  cascade?: boolean;
  closed?: boolean;
};

export type FederationPeer = {
  id: string;
  name: string;
  catalog_url: string;
  search_url?: string;
  agent_card?: string;
  last_pull_at?: string;
  last_push_at?: string;
  entries_seen?: number;
  ok?: boolean;
  note?: string;
};

type Store = {
  version: string;
  updated_at: string;
  sessions: InteropSession[];
  peers: FederationPeer[];
  totals: {
    resolves: number;
    sessions_opened: number;
    peer_pulls: number;
    peer_pushes: number;
    reciprocity_proofs: number;
  };
};

function empty(): Store {
  return {
    version: INTEROP_VERSION,
    updated_at: new Date().toISOString(),
    sessions: [],
    peers: defaultPeers(),
    totals: {
      resolves: 0,
      sessions_opened: 0,
      peer_pulls: 0,
      peer_pushes: 0,
      reciprocity_proofs: 0,
    },
  };
}

function defaultPeers(): FederationPeer[] {
  return [
    {
      id: "hf-ai-catalog",
      name: "Hugging Face AI Catalog",
      catalog_url: "https://huggingface.co/.well-known/ai-catalog.json",
      note: "ARD auto_pull peer",
    },
    {
      id: "mcp-registry",
      name: "Official MCP Registry",
      catalog_url: "https://registry.modelcontextprotocol.io",
      note: "mirror reference",
    },
  ];
}

let mem: Store | null = null;

async function load(): Promise<Store> {
  if (mem) return mem;
  const s = await loadDurableJson<Store>(DURABLE, empty);
  if (!s.sessions) s.sessions = [];
  if (!s.peers?.length) s.peers = defaultPeers();
  if (!s.totals) s.totals = empty().totals;
  s.version = INTEROP_VERSION;
  mem = s;
  return s;
}

async function persist(s: Store) {
  s.updated_at = new Date().toISOString();
  s.version = INTEROP_VERSION;
  mem = s;
  await saveDurableJson(DURABLE, s);
}

/** Canonical Dual self-node in the capability graph. */
export function dualSelfNode(origin: string): CapabilityNode {
  const o = origin.replace(/\/$/, "");
  return {
    id: "dual:self",
    name: "Dual Registry",
    kind: "dual",
    protocols: ["mcp", "a2a", "ard", "http", "dns"],
    mcp_tools: [
      "search_active",
      "match_capability",
      "list_yourself",
      "check_status",
      "take_demo",
      "leave_feedback",
      "ard_search",
      "get_founding_deal",
      "get_reciprocity",
      "probe_clean",
      "leave_trace",
      "sense_traces",
      "follow_trail",
      "endorse",
      "used_with",
      "get_acceleration",
      "interop_resolve",
      "compose_peers",
      "interop_session",
    ],
    a2a_skills: [
      "list_yourself",
      "check_status",
      "take_demo",
      "leave_feedback",
      "ard_search",
      "search_active",
      "match_capability",
      "leave_trace",
      "sense_traces",
      "follow_trail",
      "get_acceleration",
      "interop_resolve",
      "compose_peers",
    ],
    ard_tags: ["registry", "mcp", "agent", "stigmergy", "autocatalysis", "interop"],
    endpoints: {
      mcp: `${o}/api/protocol`,
      a2a: `${o}/api/a2a`,
      http: o,
      card: `${o}/.well-known/agent-card.json`,
      status: `${o}/api/listings/active`,
      demo: `${o}/api/products/demo`,
    },
    clean: true,
    source: "dual_self",
  };
}

/** Protocol adapter table — how to invoke the same capability across transports. */
export function protocolAdapters(origin: string): ProtocolAdapter[] {
  const o = origin.replace(/\/$/, "");
  return [
    {
      from: "mcp",
      to: "a2a",
      method: "tools/call → message/send skill",
      note: "MCP tool name maps 1:1 to A2A skill name when Dual hosts both",
      example: {
        mcp: {
          method: "tools/call",
          params: { name: "match_capability", arguments: { q: "github" } },
        },
        a2a: {
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ type: "text", text: "match_capability github" }],
            },
          },
        },
      },
    },
    {
      from: "a2a",
      to: "mcp",
      method: "skill text → tools/call",
      note: "A2A skill intent resolved via interop_resolve then tools/call",
      example: {
        skill: "take_demo",
        mcp: {
          method: "tools/call",
          params: { name: "take_demo", arguments: { listing_id: "ID" } },
        },
      },
    },
    {
      from: "ard",
      to: "mcp",
      method: "ARD hit → match_capability / take_demo",
      note: "ARD identifier with listing:ID becomes tools/call take_demo",
      example: {
        ard_hit: { identifier: "listing:abc", url: `${o}/api/listings/status?id=abc` },
        mcp: {
          method: "tools/call",
          params: { name: "take_demo", arguments: { listing_id: "abc" } },
        },
      },
    },
    {
      from: "mcp",
      to: "http",
      method: "tools/call → REST twin",
      note: "Every Dual tool has REST equivalent under /api/*",
      example: {
        mcp: "search_active",
        http: `GET ${o}/api/listings/active`,
      },
    },
    {
      from: "http",
      to: "ard",
      method: "REST match → ARD catalog entry",
      note: "Active listings project into /.well-known/ai-catalog.json",
      example: {
        http: `GET ${o}/api/match?q=tools`,
        ard: `GET ${o}/.well-known/ai-catalog.json`,
      },
    },
    {
      from: "dns",
      to: "mcp",
      method: "_mcp TXT → server-card → protocol",
      note: "DNS MCP points at streamable-http /api/protocol",
      example: {
        dns: `_mcp.${o.replace(/^https?:\/\//, "")}`,
        mcp: `${o}/api/protocol`,
      },
    },
  ];
}

/**
 * Build unified capability graph from Active clean + Dual self + optional q filter.
 */
export async function buildCapabilityGraph(opts?: {
  origin?: string;
  q?: string;
  limit?: number;
  include_trails?: boolean;
  include_reciprocity?: boolean;
}): Promise<{
  ok: true;
  version: string;
  nodes: CapabilityNode[];
  total: number;
  adapters: ProtocolAdapter[];
  note: string;
}> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const limit = Math.min(80, Math.max(1, opts?.limit ?? 40));
  const q = String(opts?.q || "")
    .trim()
    .toLowerCase();

  const nodes: CapabilityNode[] = [dualSelfNode(origin)];

  let trailMap: Record<string, number> = {};
  if (opts?.include_trails !== false) {
    try {
      const { getTrailScoreMap } = await import("./stigmergy");
      trailMap = await getTrailScoreMap();
    } catch {
      /* */
    }
  }

  let recipMap: Record<string, number> = {};
  if (opts?.include_reciprocity !== false) {
    try {
      const { getReciprocityScores } = await import("./reciprocity");
      recipMap = await getReciprocityScores();
    } catch {
      /* */
    }
  }

  let accelBoost = 0;
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    const m = await getAccelerationMultipliers();
    accelBoost = Math.round((m.index - 1) * 20 * 10) / 10;
  } catch {
    /* */
  }

  try {
    const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const lanes = await getLanedListings();
    const reg = await loadCleanRegistry();
    const clean = reg.items || {};
    const rows = [
      ...(lanes.agents_active || []),
      ...(lanes.mcp_active || []),
    ].filter((L) => L?.id && clean[L.id]);

    for (const L of rows) {
      const name = L.name || L.id;
      if (q) {
        const blob = `${name} ${L.description || ""} ${L.kind || ""}`.toLowerCase();
        if (!blob.includes(q)) continue;
      }
      const mcp_tools: string[] = [];
      const a2a_skills: string[] = [];
      const ard_tags: string[] = [L.kind || "listing"];
      if (L.kind === "mcp") {
        mcp_tools.push("remote_tools");
        ard_tags.push("mcp", "tools");
      } else {
        a2a_skills.push("agent_card");
        ard_tags.push("agent", "a2a");
      }
      // dual interop entrypoints always available for clean listings
      const dualTools = ["take_demo", "leave_feedback", "leave_trace", "check_status"];
      nodes.push({
        id: `listing:${L.id}`,
        listing_id: L.id,
        name,
        kind: L.kind as "agent" | "mcp",
        protocols: [
          "http",
          ...(L.kind === "mcp" ? (["mcp"] as ProtocolKind[]) : []),
          ...(L.kind === "agent" || L.agent_card_url
            ? (["a2a"] as ProtocolKind[])
            : []),
          "ard",
        ],
        mcp_tools: [...mcp_tools, ...dualTools],
        a2a_skills: [...a2a_skills, ...dualTools],
        ard_tags,
        endpoints: {
          mcp: L.remote_url || L.probe?.target || undefined,
          a2a: L.agent_card_url || undefined,
          http: L.website || L.remote_url || L.agent_card_url || undefined,
          card: L.agent_card_url || undefined,
          status: `${origin}/api/listings/status?id=${encodeURIComponent(L.id)}`,
          demo: `${origin}/api/products/demo?listing_id=${encodeURIComponent(L.id)}`,
        },
        trail_score: trailMap[L.id] || 0,
        reciprocity_score: recipMap[L.id] || 0,
        acceleration_boost: accelBoost,
        clean: true,
        source: "dual_active",
      });
    }
  } catch {
    /* */
  }

  // sort: dual first, then trail + reciprocity
  const dual = nodes.filter((n) => n.id === "dual:self");
  const rest = nodes
    .filter((n) => n.id !== "dual:self")
    .sort(
      (a, b) =>
        (b.trail_score || 0) +
        (b.reciprocity_score || 0) * 0.5 -
        ((a.trail_score || 0) + (a.reciprocity_score || 0) * 0.5),
    )
    .slice(0, limit);

  const s = await load();
  s.totals.resolves += 1;
  await persist(s);

  return {
    ok: true,
    version: INTEROP_VERSION,
    nodes: [...dual, ...rest],
    total: dual.length + rest.length,
    adapters: protocolAdapters(origin),
    note: "Unified capability graph — same node addressable via MCP, A2A, ARD, HTTP.",
  };
}

/**
 * Resolve a capability across protocols: find node + how to invoke via preferred protocol.
 */
export async function interopResolve(opts: {
  origin?: string;
  q?: string;
  listing_id?: string;
  tool?: string;
  skill?: string;
  prefer?: ProtocolKind;
  limit?: number;
}): Promise<Record<string, unknown>> {
  const origin = (opts.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const prefer = opts.prefer || "mcp";
  const graph = await buildCapabilityGraph({
    origin,
    q: opts.q,
    limit: opts.limit ?? 12,
  });

  let nodes = graph.nodes;
  if (opts.listing_id) {
    const id = opts.listing_id.trim();
    nodes = nodes.filter(
      (n) => n.listing_id === id || n.id === `listing:${id}` || n.id === id,
    );
  }
  if (opts.tool) {
    const t = opts.tool.toLowerCase();
    nodes = nodes.filter((n) =>
      n.mcp_tools.some((x) => x.toLowerCase().includes(t)),
    );
  }
  if (opts.skill) {
    const sk = opts.skill.toLowerCase();
    nodes = nodes.filter((n) =>
      n.a2a_skills.some((x) => x.toLowerCase().includes(sk)),
    );
  }

  const adapters = protocolAdapters(origin).filter(
    (a) => a.from === prefer || a.to === prefer,
  );

  const invocations = nodes.slice(0, 8).map((n) => {
    const inv: Record<string, unknown> = {
      node_id: n.id,
      name: n.name,
      listing_id: n.listing_id,
      protocols: n.protocols,
    };
    if (prefer === "mcp" || n.protocols.includes("mcp")) {
      inv.mcp = {
        endpoint: n.endpoints.mcp || `${origin}/api/protocol`,
        tools_call: {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: opts.tool || "take_demo",
            arguments: n.listing_id
              ? { listing_id: n.listing_id }
              : opts.q
                ? { q: opts.q }
                : {},
          },
        },
      };
    }
    if (prefer === "a2a" || n.protocols.includes("a2a")) {
      inv.a2a = {
        card: n.endpoints.card || n.endpoints.a2a,
        rpc: n.id === "dual:self" ? `${origin}/api/a2a` : n.endpoints.a2a,
        skill: opts.skill || opts.tool || "take_demo",
      };
    }
    if (prefer === "http" || n.protocols.includes("http")) {
      inv.http = {
        demo: n.endpoints.demo,
        status: n.endpoints.status,
        card: n.endpoints.card,
      };
    }
    if (prefer === "ard" || n.protocols.includes("ard")) {
      inv.ard = {
        search: `${origin}/api/ard/search?q=${encodeURIComponent(opts.q || n.name)}`,
        catalog: `${origin}/.well-known/ai-catalog.json`,
      };
    }
    return inv;
  });

  return {
    ok: true,
    version: INTEROP_VERSION,
    prefer,
    query: opts.q || null,
    listing_id: opts.listing_id || null,
    matches: nodes.length,
    invocations,
    adapters,
    note: "Cross-protocol resolve — invoke the same capability via preferred transport.",
  };
}

/** Compose peers: who works with whom via composition trails + graph. */
export async function composePeers(opts?: {
  origin?: string;
  listing_id?: string;
  limit?: number;
}): Promise<Record<string, unknown>> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const limit = Math.min(30, Math.max(1, opts?.limit ?? 10));
  const listing_id = String(opts?.listing_id || "").trim();

  let compositions: Array<{ a: string; b: string; count: number; intensity: number }> =
    [];
  try {
    const { senseTraces } = await import("./stigmergy");
    const s = await senseTraces({ limit: 40, listing_id: listing_id || undefined });
    compositions = s.compositions || [];
  } catch {
    /* */
  }

  if (listing_id) {
    compositions = compositions.filter(
      (c) => c.a === listing_id || c.b === listing_id,
    );
  }

  const graph = await buildCapabilityGraph({ origin, limit: 60 });
  const byId = new Map(
    graph.nodes.filter((n) => n.listing_id).map((n) => [n.listing_id!, n]),
  );

  const peers = compositions.slice(0, limit).map((c) => {
    const other = listing_id
      ? c.a === listing_id
        ? c.b
        : c.a
      : c.b;
    const nodeA = byId.get(c.a);
    const nodeB = byId.get(c.b);
    return {
      listing_a: c.a,
      listing_b: c.b,
      name_a: nodeA?.name,
      name_b: nodeB?.name,
      count: c.count,
      intensity: c.intensity,
      invoke_a: nodeA?.endpoints.demo,
      invoke_b: nodeB?.endpoints.demo,
      protocols_a: nodeA?.protocols,
      protocols_b: nodeB?.protocols,
      peer_focus: other,
    };
  });

  // If no composition yet, suggest top trail nodes as compose candidates
  let suggestions: CapabilityNode[] = [];
  if (!peers.length) {
    suggestions = graph.nodes
      .filter((n) => n.source === "dual_active")
      .slice(0, limit);
  }

  return {
    ok: true,
    version: INTEROP_VERSION,
    listing_id: listing_id || null,
    compositions: peers,
    suggestions,
    note: "Composition interop — co-use trails + protocol endpoints for peer agents/MCPs.",
  };
}

// ─── Session context (P2) ───────────────────────────────────────────

export async function openInteropSession(opts: {
  entry_protocol?: ProtocolKind;
  listing_id?: string;
  agent_name?: string;
  match_q?: string;
}): Promise<InteropSession> {
  const s = await load();
  const now = new Date().toISOString();
  const session: InteropSession = {
    id: `ix_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: now,
    updated_at: now,
    entry_protocol: opts.entry_protocol || "http",
    listing_id: opts.listing_id,
    agent_name: opts.agent_name,
    match_q: opts.match_q,
    steps: [
      {
        at: now,
        action: "open",
        protocol: opts.entry_protocol || "http",
        detail: opts.match_q || opts.listing_id || "session start",
      },
    ],
  };
  s.sessions.unshift(session);
  s.sessions = s.sessions.slice(0, 200);
  s.totals.sessions_opened += 1;
  await persist(s);
  return session;
}

export async function appendInteropSession(
  session_id: string,
  step: { action: string; protocol?: ProtocolKind; detail?: string; demo_order_id?: string; feedback_id?: string; match_hits?: string[] },
): Promise<InteropSession | null> {
  const s = await load();
  const sess = s.sessions.find((x) => x.id === session_id);
  if (!sess || sess.closed) return null;
  const now = new Date().toISOString();
  sess.updated_at = now;
  sess.steps.push({
    at: now,
    action: step.action,
    protocol: step.protocol,
    detail: step.detail,
  });
  if (step.demo_order_id) sess.demo_order_id = step.demo_order_id;
  if (step.feedback_id) sess.feedback_id = step.feedback_id;
  if (step.match_hits) sess.match_hits = step.match_hits;
  if (step.action === "cascade" || step.action === "feedback") sess.cascade = true;
  if (step.action === "close") sess.closed = true;
  await persist(s);
  return sess;
}

export async function getInteropSession(
  session_id: string,
): Promise<InteropSession | null> {
  const s = await load();
  return s.sessions.find((x) => x.id === session_id) || null;
}

// ─── Federation bus (P1 bidirectional) ──────────────────────────────

export async function listFederationPeers(): Promise<FederationPeer[]> {
  const s = await load();
  return s.peers;
}

export async function pullFederationPeer(
  peer_id?: string,
): Promise<{ ok: boolean; peers: Array<Record<string, unknown>>; notes: string[] }> {
  const s = await load();
  const notes: string[] = [];
  const targets = peer_id
    ? s.peers.filter((p) => p.id === peer_id)
    : s.peers.filter((p) => p.catalog_url.startsWith("https://"));

  const results: Array<Record<string, unknown>> = [];
  for (const peer of targets) {
    try {
      const res = await fetch(peer.catalog_url, {
        headers: {
          accept: "application/json",
          "user-agent": "DualRegistryInterop/2.6 (+https://dualregistry.dev; federation-pull)",
        },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      const ok = res.ok;
      let entries = 0;
      if (ok) {
        try {
          const body = (await res.json()) as {
            entries?: unknown[];
            items?: unknown[];
            agents?: unknown[];
          };
          entries =
            (body.entries?.length || 0) ||
            (body.items?.length || 0) ||
            (body.agents?.length || 0) ||
            0;
        } catch {
          entries = 0;
        }
      }
      peer.last_pull_at = new Date().toISOString();
      peer.ok = ok;
      peer.entries_seen = entries;
      s.totals.peer_pulls += 1;
      results.push({
        peer_id: peer.id,
        name: peer.name,
        ok,
        entries_seen: entries,
        catalog_url: peer.catalog_url,
      });
      notes.push(`pull ${peer.id}: ${ok ? "ok" : "fail"} entries=${entries}`);
    } catch (e) {
      peer.ok = false;
      peer.last_pull_at = new Date().toISOString();
      notes.push(
        `pull ${peer.id}: ${e instanceof Error ? e.message : "err"}`.slice(0, 120),
      );
      results.push({ peer_id: peer.id, ok: false, error: String(e).slice(0, 80) });
    }
  }
  await persist(s);
  return { ok: true, peers: results, notes };
}

/** Push Dual's acceleration + hot trails summary to peer (soft POST if they accept). */
export async function pushFederationSignals(opts?: {
  origin?: string;
}): Promise<{ ok: boolean; pushed: number; notes: string[] }> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const s = await load();
  const notes: string[] = [];
  let pushed = 0;

  let payload: Record<string, unknown> = {
    type: "dualregistry.federation_signal",
    version: INTEROP_VERSION,
    from: origin,
    at: new Date().toISOString(),
  };
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    const { followTrail } = await import("./stigmergy");
    const { federationAttestationBundle } = await import("./first-principles");
    const m = await getAccelerationMultipliers();
    const hot = await followTrail({ kind: "hot", limit: 8 });
    const attBundle = await federationAttestationBundle({ origin, limit: 12 });
    payload = {
      ...payload,
      acceleration_index: m.index,
      multipliers: m,
      hot_trails: hot.items,
      catalog: `${origin}/.well-known/ai-catalog.json`,
      ard_search: `${origin}/api/ard/search`,
      agent_card: `${origin}/.well-known/agent-card.json`,
      mcp_server_card: `${origin}/.well-known/mcp/server-card.json`,
      interop: `${origin}/api/products/interop`,
      first_principles: `${origin}/api/products/first-principles`,
      // P2: federation carries signed attestations + cap hashes, not just catalog rows
      attestations: attBundle.attestations,
      capabilities: attBundle.capabilities,
      attractors: attBundle.attractors,
      attestation_bundle_type: attBundle.type,
    };
  } catch (e) {
    notes.push(`payload: ${e instanceof Error ? e.message : "x"}`);
  }

  for (const peer of s.peers) {
    if (!peer.search_url && !peer.catalog_url) continue;
    // Soft: only attempt push URL if search_url looks like an API we can POST
    const target = peer.search_url;
    if (!target || !target.startsWith("https://")) {
      // still record logical push of Dual surfaces (read-side federation)
      peer.last_push_at = new Date().toISOString();
      pushed += 1;
      notes.push(`signal published for ${peer.id} (pull-side; Dual surfaces open)`);
      continue;
    }
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "DualRegistryInterop/2.6 (+https://dualregistry.dev; federation-push)",
          "x-dualregistry-event": "federation_signal",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
        redirect: "manual",
      });
      peer.last_push_at = new Date().toISOString();
      peer.ok = res.status >= 200 && res.status < 500;
      if (res.status >= 200 && res.status < 300) {
        pushed += 1;
        s.totals.peer_pushes += 1;
        notes.push(`push ${peer.id}: ${res.status}`);
      } else {
        notes.push(`push ${peer.id}: ${res.status} (soft)`);
      }
    } catch (e) {
      notes.push(
        `push ${peer.id}: ${e instanceof Error ? e.message : "err"}`.slice(0, 100),
      );
    }
  }
  await persist(s);
  return { ok: true, pushed, notes };
}

/**
 * Reciprocity interop proof — when listing links Dual, boost trail attraction.
 */
export async function reciprocityInteropProof(opts: {
  listing_id: string;
  links_dual: boolean;
  score: number;
  clean?: boolean;
}): Promise<{ ok: true; boosted: boolean }> {
  if (!opts.links_dual || !opts.listing_id) {
    return { ok: true, boosted: false };
  }
  try {
    const { autoDeposit, leaveTrace } = await import("./stigmergy");
    await leaveTrace({
      listing_id: opts.listing_id,
      kind: "endorse",
      body: "reciprocity interop proof — listing links Dual",
      from: "dual-interop",
      intensity: Math.min(20, 8 + Math.floor(opts.score / 10)),
      tags: ["reciprocity", "interop", "proof"],
    });
    if (opts.clean) {
      await autoDeposit({
        kind: "match_hit",
        listing_id: opts.listing_id,
        from: "reciprocity-proof",
      });
    }
    const s = await load();
    s.totals.reciprocity_proofs += 1;
    await persist(s);
    return { ok: true, boosted: true };
  } catch {
    return { ok: true, boosted: false };
  }
}

export async function getInteropPublic(opts?: {
  origin?: string;
}): Promise<Record<string, unknown>> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const s = await load();
  const graph = await buildCapabilityGraph({ origin, limit: 12 });
  let acceleration: Record<string, unknown> | null = null;
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    acceleration = await getAccelerationMultipliers();
  } catch {
    /* */
  }

  return {
    ok: true,
    version: INTEROP_VERSION,
    model: "unified_capability_graph",
    pitch:
      "One hallway: MCP · A2A · ARD · HTTP · DNS all resolve the same Dual capability nodes.",
    dual: dualSelfNode(origin),
    graph: {
      total: graph.total,
      sample: graph.nodes.slice(0, 8),
    },
    adapters: protocolAdapters(origin),
    federation: {
      peers: s.peers,
      pull: `${origin}/api/products/federation?action=pull`,
      push: `${origin}/api/products/federation?action=push`,
    },
    acceleration,
    sessions_open: s.sessions.filter((x) => !x.closed).length,
    totals: s.totals,
    tools: [
      "get_acceleration",
      "interop_resolve",
      "compose_peers",
      "interop_session",
    ],
    endpoints: {
      api: `${origin}/api/products/interop`,
      federation: `${origin}/api/products/federation`,
      protocol: `${origin}/api/protocol`,
      a2a: `${origin}/api/a2a`,
      ard: `${origin}/api/ard/search`,
      agent_card: `${origin}/.well-known/agent-card.json`,
      a2a_card: `${origin}/.well-known/a2a-card.json`,
      mcp_server_card: `${origin}/.well-known/mcp/server-card.json`,
      ai_catalog: `${origin}/.well-known/ai-catalog.json`,
      stigmergy: `${origin}/api/products/stigmergy`,
      autocatalysis: `${origin}/api/products/autocatalysis`,
    },
    laws: [
      "One capability graph for all protocols",
      "Adapters translate MCP ↔ A2A ↔ ARD ↔ HTTP without re-listing",
      "Sessions carry match → demo → feedback across entry protocols",
      "Federation pulls peer catalogs and publishes Dual signals",
      "Reciprocity (links Dual) is interop proof → trail boost",
      "Active-clean + 30d silence laws unchanged",
    ],
    note: "Interop fabric v2.6 — protocols share one graph, not parallel tracks.",
  };
}
