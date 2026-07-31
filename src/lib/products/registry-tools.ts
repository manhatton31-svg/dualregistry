/**
 * Dual-as-tool — invocable registry ops for MCP tools/list|call and A2A skills.
 * Wraps existing REST backends; one handler map for both transports.
 * v2.7: first-principles + stigmergy + interop tools (leave_trace / sense_traces / follow_trail / endorse / used_with)
 *       + auto pheromone deposits on existing tool side-effects.
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { dualPublish } from "@/lib/agents1/publish";
import { getListingStatus } from "@/lib/agents1/inbound-discovery";
import { ardSearch } from "@/lib/agents1/ai-catalog";
import { runQuickDemo } from "./quick-demo";
import { submitFeedback } from "./feedback";
import { getFoundingFreePublic } from "./founding-free";
import { dealPublicBlock } from "./deal-copy";
import {
  autoDeposit,
  leaveTrace,
  senseTraces,
  followTrail,
  STIGMERGY_VERSION,
} from "./stigmergy";

export const REGISTRY_TOOLS_VERSION = "2.9.0";

export type ToolArg = Record<string, unknown>;

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

export type ToolResult = {
  ok: boolean;
  tool: string;
  content: Array<{ type: "text"; text: string } | { type: "json"; json: unknown }>;
  structured?: unknown;
  error?: string;
};

function originOf(request?: Request, origin?: string): string {
  if (origin) return origin.replace(/\/$/, "");
  if (request) return resolvePublicOrigin(request).replace(/\/$/, "");
  return resolvePublicOrigin(
    new Request("https://www.dualregistry.dev/"),
  ).replace(/\/$/, "");
}

function textResult(
  tool: string,
  data: unknown,
  ok = true,
  error?: string,
): ToolResult {
  const text =
    typeof data === "string"
      ? data
      : JSON.stringify(data, null, 2).slice(0, 12_000);
  return {
    ok,
    tool,
    error,
    content: [
      { type: "text", text },
      { type: "json", json: data },
    ],
    structured: data,
  };
}

/** MCP / A2A tool catalog (full schemas). */
export function listRegistryTools(origin?: string): ToolDef[] {
  const o = (origin || "https://dualregistry.dev").replace(/\/$/, "");
  return [
    {
      name: "search_active",
      description: `Search Dual Registry Active (checks-clean) agents + MCPs. GET ${o}/api/listings/active`,
      inputSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["agent", "mcp", "all"],
            description: "Filter by kind",
          },
          q: { type: "string", description: "Optional name/description keyword" },
          limit: { type: "number", description: "Max rows (1-100)", default: 20 },
        },
      },
    },
    {
      name: "match_capability",
      description:
        "Capability matchmaking — rank Active clean listings for a natural-language need. Ranking includes stigmergic usage pheromones (trail-following).",
      inputSchema: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "What capability you need, e.g. 'github issues MCP'",
          },
          kind: { type: "string", enum: ["agent", "mcp", "all"] },
          limit: { type: "number", default: 12 },
          federation: {
            type: "string",
            enum: ["none", "referrals", "auto"],
            default: "referrals",
          },
        },
        required: ["q"],
      },
    },
    {
      name: "list_yourself",
      description: `Free self-list. POST card/server URL → probe ~6m → Active. First 100 demo+feedback unlock full product free.`,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "https URL to agent-card.json or MCP server.json",
          },
          agent_card_url: { type: "string" },
          server_json: { type: "object", description: "Inline MCP server.json" },
          name: { type: "string" },
          contact_email: { type: "string" },
          source: { type: "string", default: "registry-tool" },
        },
      },
    },
    {
      name: "check_status",
      description: "Poll listing status until lane=active (checks clean).",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          id: { type: "string" },
          name: { type: "string" },
        },
      },
    },
    {
      name: "take_demo",
      description:
        "Free Kernel/Loop (or Mesh) demo for an Active listing. Prefer listing_id. Deposits attraction pheromone. Counts toward founding free seats after feedback.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          agent_card_url: { type: "string" },
          mcp_url: { type: "string" },
          name: { type: "string" },
          goals: { type: "string" },
        },
      },
    },
    {
      name: "leave_feedback",
      description:
        "Submit real demo feedback. Strong attraction pheromone. First 100 agents+MCPs unlock full product free (founding seats).",
      inputSchema: {
        type: "object",
        properties: {
          agent_name: { type: "string" },
          order_id: { type: "string" },
          listing_id: { type: "string" },
          body: { type: "string" },
          rating: { type: "number" },
          answers: { type: "object" },
          audience: { type: "string", enum: ["agent", "mcp"] },
          contact: { type: "string" },
          sku: { type: "string" },
        },
        required: ["agent_name"],
      },
    },
    {
      name: "ard_search",
      description: `Agentic Resource Discovery over Dual catalog + Active projections. POST ${o}/api/ard/search`,
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string" },
          limit: { type: "number", default: 12 },
          federation: {
            type: "string",
            enum: ["none", "referrals", "auto"],
            default: "auto",
          },
        },
        required: ["q"],
      },
    },
    {
      name: "get_founding_deal",
      description:
        "Founding free seat meter (100 seats) + deal copy — scarce-resource stigmergic heat signal.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_reciprocity",
      description:
        "Reciprocity trust: does this listing (or URL) link Dual? Portable clean badge URL when checks-clean.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          url: { type: "string" },
          name: { type: "string" },
        },
      },
    },
    {
      name: "probe_clean",
      description:
        "Probe-as-service signal: return Dual clean-registry status. Fail deposits danger pheromone; ok dampens danger.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          id: { type: "string" },
          name: { type: "string" },
        },
      },
    },
    {
      name: "leave_trace",
      description:
        "Stigmergy: deposit a durable mark on Dual (shared medium). Other agents sense it via sense_traces / follow_trail. No direct messaging.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          kind: {
            type: "string",
            enum: ["mark", "endorse", "intent", "note", "danger"],
            default: "mark",
          },
          body: { type: "string", description: "What you leave in the environment" },
          from: { type: "string", description: "Your agent/MCP name or id" },
          tags: { type: "array", items: { type: "string" } },
          intensity: { type: "number", default: 6 },
        },
      },
    },
    {
      name: "sense_traces",
      description:
        "Stigmergy: read pheromone trails + agent marks on Dual. Evaporation applied on read.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          q: { type: "string" },
          limit: { type: "number", default: 12 },
        },
      },
    },
    {
      name: "follow_trail",
      description:
        "Stigmergy: follow hottest trails (attraction − danger), demand peaks, or composition co-use paths.",
      inputSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["hot", "dangerous", "demand", "composition"],
            default: "hot",
          },
          limit: { type: "number", default: 12 },
        },
      },
    },
    {
      name: "endorse",
      description:
        "Stigmergy: endorse a listing (strong attraction mark). Other agents see via sense_traces.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          from: { type: "string" },
          body: { type: "string" },
        },
        required: ["listing_id"],
      },
    },
    {
      name: "used_with",
      description:
        "Stigmergy: composition trail — record that listing_a was used with listing_b. Builds co-use graph.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string", description: "listing A" },
          listing_b: { type: "string", description: "listing B" },
          from: { type: "string" },
          body: { type: "string" },
        },
        required: ["listing_id", "listing_b"],
      },
    },
    {
      name: "get_acceleration",
      description:
        "Autocatalysis S-curve meter — acceleration_index + multipliers that raise rates of match, conversion, outbound.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "interop_resolve",
      description:
        "Cross-protocol resolve: find capability nodes and how to invoke via MCP / A2A / ARD / HTTP.",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Capability query" },
          listing_id: { type: "string" },
          tool: { type: "string" },
          skill: { type: "string" },
          prefer: {
            type: "string",
            enum: ["mcp", "a2a", "ard", "http", "dns"],
            default: "mcp",
          },
          limit: { type: "number", default: 8 },
        },
      },
    },
    {
      name: "compose_peers",
      description:
        "Composition interop — co-use peers + protocol endpoints for agents/MCPs that work together.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          limit: { type: "number", default: 10 },
        },
      },
    },
    {
      name: "interop_session",
      description:
        "Open or append a cross-protocol session (match → demo → feedback survives MCP or A2A entry).",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["open", "append", "get"],
            default: "open",
          },
          session_id: { type: "string" },
          entry_protocol: {
            type: "string",
            enum: ["mcp", "a2a", "ard", "http", "dns"],
          },
          listing_id: { type: "string" },
          agent_name: { type: "string" },
          match_q: { type: "string" },
          step_action: { type: "string" },
          detail: { type: "string" },
          demo_order_id: { type: "string" },
          feedback_id: { type: "string" },
        },
      },
    },

    {
      name: "capability_hash",
      description:
        "First principles: content-addressed capability hash (what it does, not who hosts it). Optionally register + bind listing_id.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: ["agent", "mcp", "dual", "pipeline"] },
          description: { type: "string" },
          tools: { type: "array", items: { type: "string" } },
          skills: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
          listing_id: { type: "string" },
          register: { type: "boolean", default: true },
        },
        required: ["name"],
      },
    },
    {
      name: "attest",
      description:
        "First principles: issue a signed public attestation (probe_clean, liveness, outcome, capability).",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["probe_clean", "liveness", "outcome", "identity_bind", "composition", "reciprocity", "capability"],
          },
          subject: { type: "string", description: "listing_id or cap_hash" },
          listing_id: { type: "string" },
          claims: { type: "object" },
          body: { type: "string" },
          expires_hours: { type: "number", default: 72 },
        },
      },
    },
    {
      name: "check_liveness",
      description:
        "First principles: liveness from signal freshness (stigmergy + probe + outcomes), not Dual calendar alone.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          max_hours: { type: "number" },
        },
        required: ["listing_id"],
      },
    },
    {
      name: "execute_compose",
      description:
        "First principles: turn used_with composition into an invocable A→B pipeline with endpoints + attestation.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          listing_b: { type: "string" },
          from: { type: "string" },
        },
        required: ["listing_id", "listing_b"],
      },
    },
    {
      name: "deposit_outcome",
      description:
        "First principles: deposit ok/latency/quality outcome — grounds ranking in real results (attraction/danger).",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          listing_b: { type: "string" },
          ok: { type: "boolean", default: true },
          latency_ms: { type: "number" },
          quality: { type: "number", description: "0-1" },
          kind: { type: "string" },
          from: { type: "string" },
          body: { type: "string" },
        },
        required: ["listing_id"],
      },
    },
    {
      name: "get_incentives",
      description:
        "First principles: transparent incentive surface — founding seats, rank rules, liveness physics agents can plan against.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "attractor_targets",
      description:
        "First principles: attractor-only growth targets (hot trails × outcomes × liveness) for outbound amplification.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", default: 12 } },
      },
    },
    {
      name: "bind_identity",
      description:
        "First principles: bind cryptographic identity (DID / public key) to listing + content-addressed capability.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          did: { type: "string" },
          public_key_pem: { type: "string" },
          public_jwk: { type: "object" },
          name: { type: "string" },
        },
        required: ["listing_id"],
      },
    },
    {
      name: "verify_attestation",
      description:
        "First principles: verify a Dual-issued signed attestation (JWS + ledger).",
      inputSchema: {
        type: "object",
        properties: {
          jws: { type: "string" },
          id: { type: "string" },
        },
        required: ["jws"],
      },
    },
    {
      name: "get_exonomics",
      description:
        "Exonomics status: zero-MC cost model + network value V(N,C,O,F) + hyper_index + stacked S-curves.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "network_value",
      description:
        "Superlinear network value meter V ∝ N^α · C^β · O^γ · F^δ. Optional N/C/O/F override for planning.",
      inputSchema: {
        type: "object",
        properties: {
          N: { type: "number" },
          C: { type: "number" },
          O: { type: "number" },
          F: { type: "number" },
          dense: { type: "boolean" },
        },
      },
    },
    {
      name: "hyper_index",
      description:
        "Hyper-exponentials: hyper_index = d(acceleration_index)/dt, gates, hyper_mode, multipliers.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cost_model",
      description:
        "Zero marginal cost model — which ops are free to replicate vs real cost (probe/composition/Talk).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "abundance_rank",
      description:
        "Abundance ranking boosts: prefer listings that raise composition/outcome value for others.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          listing_ids: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "zero_mc_pack",
      description:
        "Zero-MC federation pack — content-addressed caps + attestations to copy without re-crawling Dual.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", default: 20 } },
      },
    },
    {
      name: "s_curve_board",
      description:
        "Stacked S-curve dashboard (listings, trails, compositions, outcomes, federation, demos, identity).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "join_and_contribute",
      description:
        "Compound self-serve: list (optional) → cap_hash → joined trail → interop session → outcome template. One hop onto the Dual medium.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: {
            type: "string",
            description: "If already listed, pass listing_id to join medium only",
          },
          url: {
            type: "string",
            description: "Agent card or MCP server URL to publish",
          },
          agent_card_url: { type: "string" },
          server_json: { type: "object" },
          name: { type: "string" },
          source: { type: "string" },
        },
      },
    },
    {
      name: "seed_compositions",
      description:
        "Near-zero bootstrap: seed used_with composition edges from Active clean category/tag clusters. Opens composition_density gate without live re-probes.",
      inputSchema: {
        type: "object",
        properties: {
          max_pairs: {
            type: "number",
            description: "Max pairs to seed (default 24)",
          },
        },
      },
    },
  ];
}

async function toolSearchActive(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
  const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
  const lanes = await getLanedListings();
  const reg = await loadCleanRegistry();
  const clean = new Set(Object.keys(reg.items || {}));
  const kind = String(args.kind || "all").toLowerCase();
  const q = String(args.q || "")
    .trim()
    .toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));

  let rows = [
    ...(kind === "mcp" ? [] : lanes.agents_active || []),
    ...(kind === "agent" ? [] : lanes.mcp_active || []),
  ].filter((L) => L?.id && clean.has(L.id));

  if (q) {
    rows = rows.filter((L) => {
      const blob = `${L.name} ${L.description || ""} ${(L.tags || []).join(" ")}`.toLowerCase();
      return blob.includes(q) || q.split(/\s+/).every((t) => blob.includes(t));
    });
  }

  const items = rows.slice(0, limit).map((L) => ({
    listing_id: L.id,
    kind: L.kind,
    name: L.name,
    description: (L.description || "").slice(0, 220),
    tags: L.tags || [],
    take_demo_get: `${origin}/api/products/demo?listing_id=${encodeURIComponent(L.id)}`,
    status: `${origin}/api/listings/status?id=${encodeURIComponent(L.id)}`,
    agent_card_url: L.agent_card_url || null,
    website: L.website || null,
  }));

  // weak demand signal on returned set
  await autoDeposit({
    kind: "match_query",
    listing_ids: items.map((i) => i.listing_id).slice(0, 8),
    from: "search_active",
  }).catch(() => ({ ok: false as const, deposited: 0 }));

  return textResult("search_active", {
    ok: true,
    total_matched: rows.length,
    returned: items.length,
    active_clean: clean.size,
    items,
    founding: await getFoundingFreePublic(),
    stigmergy: STIGMERGY_VERSION,
  });
}

async function toolMatchCapability(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const q = String(args.q || "").trim();
  if (!q) {
    return textResult(
      "match_capability",
      { ok: false, error: "q required" },
      false,
      "q required",
    );
  }
  const { matchCapabilities } = await import("./capability-match");
  const result = await matchCapabilities(origin, q, {
    kind: (args.kind as "agent" | "mcp" | "all") || "all",
    limit: Number(args.limit) || 12,
    federation: (args.federation as "none" | "referrals" | "auto") || "referrals",
  });
  // auto demand pheromone on ranked hits
  const ids = result.hits
    .map((h) => h.listing_id)
    .filter((x): x is string => Boolean(x))
    .slice(0, 10);
  await autoDeposit({ kind: "match_hit", listing_ids: ids, from: "match_capability" }).catch(
    () => ({ ok: false as const, deposited: 0 }),
  );
  return textResult("match_capability", result);
}

async function toolListYourself(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const url =
    (typeof args.url === "string" && args.url) ||
    (typeof args.agent_card_url === "string" && args.agent_card_url) ||
    "";
  const server_json =
    args.server_json && typeof args.server_json === "object"
      ? (args.server_json as Record<string, unknown>)
      : undefined;
  if (!url && !server_json) {
    return textResult(
      "list_yourself",
      {
        ok: false,
        error: "url, agent_card_url, or server_json required",
        skill: `${origin}/skill.json`,
        example: {
          url: "https://YOUR_HOST/.well-known/agent-card.json",
          source: "registry-tool",
        },
      },
      false,
      "url required",
    );
  }
  const result = await dualPublish({
    url: url || undefined,
    agent_card_url:
      typeof args.agent_card_url === "string" ? args.agent_card_url : undefined,
    server_json,
    source: String(args.source || "registry-tool"),
    origin,
  });
  const listingId =
    (result as { listing_id?: string; id?: string }).listing_id ||
    (result as { listing_id?: string; id?: string }).id;
  if (listingId) {
    await autoDeposit({
      kind: "list_yourself",
      listing_id: listingId,
      from: typeof args.name === "string" ? args.name : "list_yourself",
    }).catch(() => ({ ok: false as const, deposited: 0 }));
  }
  return textResult("list_yourself", {
    ...result,
    next_tools: ["check_status", "take_demo", "leave_feedback", "leave_trace"],
    founding: await getFoundingFreePublic(),
  });
}

async function toolCheckStatus(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const id = String(args.listing_id || args.id || "").trim();
  const name = String(args.name || "").trim();
  if (!id && !name) {
    return textResult(
      "check_status",
      { ok: false, error: "listing_id or name required" },
      false,
      "listing_id or name required",
    );
  }
  const status = await getListingStatus({ id, name, origin });
  if (!status) {
    return textResult(
      "check_status",
      {
        ok: false,
        found: false,
        message: "Listing not found — list_yourself first",
      },
      false,
      "not found",
    );
  }
  let clean = false;
  try {
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const reg = await loadCleanRegistry();
    clean = Boolean(reg.items?.[status.listing_id]);
  } catch {
    /* */
  }
  return textResult("check_status", {
    ok: true,
    ...status,
    checks_clean: clean,
    take_demo_get:
      status.lane === "active"
        ? `${origin}/api/products/demo?listing_id=${encodeURIComponent(status.listing_id)}`
        : null,
    clean_badge:
      clean
        ? `${origin}/badge/clean.svg?id=${encodeURIComponent(status.listing_id)}`
        : null,
  });
}

async function toolTakeDemo(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const listing_id = String(args.listing_id || "").trim();
  const agent_card_url = String(args.agent_card_url || "").trim();
  const mcp_url = String(args.mcp_url || "").trim();
  if (!listing_id && !agent_card_url && !mcp_url && !args.name) {
    return textResult(
      "take_demo",
      {
        ok: false,
        error: "listing_id (preferred) or agent_card_url / mcp_url required",
      },
      false,
      "listing_id required",
    );
  }
  const demo = await runQuickDemo({
    listing_id: listing_id || undefined,
    agent_card_url: agent_card_url || undefined,
    mcp_url: mcp_url || undefined,
    name: typeof args.name === "string" ? args.name : undefined,
    goals: typeof args.goals === "string" ? args.goals : undefined,
    origin,
  });
  const lid =
    listing_id ||
    (demo as { listing_id?: string }).listing_id ||
    "";
  if (lid) {
    await autoDeposit({
      kind: "take_demo",
      listing_id: lid,
      from: typeof args.name === "string" ? args.name : undefined,
    }).catch(() => ({ ok: false as const, deposited: 0 }));
  }
  return textResult("take_demo", {
    ...demo,
    founding: await getFoundingFreePublic(),
    next: "Call leave_feedback with agent_name + order_id from demo to claim founding free seat",
    stigmergy: "attraction pheromone deposited",
  });
}

async function toolLeaveFeedback(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const agent_name = String(args.agent_name || args.name || "").trim();
  if (!agent_name) {
    return textResult(
      "leave_feedback",
      { ok: false, error: "agent_name required" },
      false,
      "agent_name required",
    );
  }
  const listing_id =
    typeof args.listing_id === "string" ? args.listing_id : undefined;
  const result = await submitFeedback({
    agent_name,
    order_id: typeof args.order_id === "string" ? args.order_id : undefined,
    body: typeof args.body === "string" ? args.body : undefined,
    rating: typeof args.rating === "number" ? args.rating : undefined,
    answers:
      args.answers && typeof args.answers === "object"
        ? (args.answers as Record<string, unknown>)
        : undefined,
    audience:
      args.audience === "mcp" || args.audience === "agent"
        ? args.audience
        : undefined,
    contact: typeof args.contact === "string" ? args.contact : undefined,
    sku: typeof args.sku === "string" ? args.sku : undefined,
    source: "registry-tool",
    meta: {
      listing_id,
      via: "dual-as-tool",
      origin,
    },
  });
  if (result.ok && listing_id) {
    await autoDeposit({
      kind: "leave_feedback",
      listing_id,
      from: agent_name,
    }).catch(() => ({ ok: false as const, deposited: 0 }));
  }
  return textResult(
    "leave_feedback",
    {
      ...result,
      founding: await getFoundingFreePublic(),
      origin,
      stigmergy: listing_id ? "strong attraction pheromone deposited" : undefined,
    },
    result.ok,
    result.error,
  );
}

async function toolArdSearch(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const q = String(args.q || "").trim();
  const result = await ardSearch(origin, q, {
    limit: Number(args.limit) || 12,
    federation: (args.federation as "none" | "referrals" | "auto") || "auto",
  });
  return textResult("ard_search", result);
}

async function toolFoundingDeal(
  _args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const [founding, deal] = await Promise.all([
    getFoundingFreePublic(),
    dealPublicBlock(origin).catch(() => null),
  ]);
  return textResult("get_founding_deal", {
    ok: true,
    founding,
    deal,
    claim_path: [
      "search_active or match_capability → pick listing_id",
      "take_demo { listing_id }",
      "leave_feedback { agent_name, order_id, answers }",
      "founding free seat if remaining > 0",
    ],
    stigmergy:
      "Founding seats are a scarce-resource heat signal — claims appear on /api/feed",
  });
}

async function toolReciprocity(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { getReciprocityFor } = await import("./reciprocity");
  const r = await getReciprocityFor({
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    url: typeof args.url === "string" ? args.url : undefined,
    name: typeof args.name === "string" ? args.name : undefined,
    origin,
  });
  return textResult("get_reciprocity", r);
}

async function toolProbeClean(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const id = String(args.listing_id || args.id || "").trim();
  const name = String(args.name || "").trim();
  const status = id || name ? await getListingStatus({ id, name, origin }) : null;
  const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
  const reg = await loadCleanRegistry();
  const lid = status?.listing_id || id;
  const item = lid ? reg.items?.[lid] : null;
  const clean = Boolean(item);
  if (lid) {
    await autoDeposit({
      kind: clean ? "probe_ok" : "probe_fail",
      listing_id: lid,
      from: "probe_clean",
    }).catch(() => ({ ok: false as const, deposited: 0 }));
  }
  return textResult("probe_clean", {
    ok: true,
    listing_id: lid || null,
    name: status?.name || name || null,
    checks_clean: clean,
    clean_item: item || null,
    portable_signal: {
      badge: lid
        ? `${origin}/badge/clean.svg?id=${encodeURIComponent(lid)}`
        : `${origin}/badge/live.svg`,
      status_api: lid
        ? `${origin}/api/listings/status?id=${encodeURIComponent(lid)}`
        : null,
      reciprocity: `${origin}/api/products/reciprocity?id=${encodeURIComponent(lid || "")}`,
    },
    stigmergy: clean
      ? "probe_ok — danger dampened, light attraction"
      : "probe_fail — danger pheromone deposited",
    note: "checks_clean means Dual probe ok + Active lane. Portable trust for other registries.",
  });
}

async function toolLeaveTrace(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const r = await leaveTrace({
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    kind: (args.kind as "mark" | "endorse" | "intent" | "note" | "danger") || "mark",
    body: typeof args.body === "string" ? args.body : undefined,
    from: typeof args.from === "string" ? args.from : undefined,
    tags: Array.isArray(args.tags)
      ? (args.tags as unknown[]).map(String)
      : undefined,
    intensity: typeof args.intensity === "number" ? args.intensity : undefined,
  });
  return textResult("leave_trace", r, r.ok, r.error);
}

async function toolSenseTraces(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const r = await senseTraces({
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    q: typeof args.q === "string" ? args.q : undefined,
    limit: Number(args.limit) || 12,
  });
  return textResult("sense_traces", r);
}

async function toolFollowTrail(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const r = await followTrail({
    kind: (args.kind as "hot" | "dangerous" | "demand" | "composition") || "hot",
    limit: Number(args.limit) || 12,
  });
  return textResult("follow_trail", r);
}

async function toolEndorse(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const listing_id = String(args.listing_id || "").trim();
  if (!listing_id) {
    return textResult(
      "endorse",
      { ok: false, error: "listing_id required" },
      false,
      "listing_id required",
    );
  }
  const r = await leaveTrace({
    listing_id,
    kind: "endorse",
    body: typeof args.body === "string" ? args.body : "endorsed",
    from: typeof args.from === "string" ? args.from : undefined,
    intensity: AUTO_WEIGHTS_ENDORSE,
  });
  return textResult("endorse", r, r.ok, r.error);
}

const AUTO_WEIGHTS_ENDORSE = 12;

async function toolUsedWith(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const listing_id = String(args.listing_id || "").trim();
  const listing_b = String(args.listing_b || "").trim();
  if (!listing_id || !listing_b) {
    return textResult(
      "used_with",
      { ok: false, error: "listing_id and listing_b required" },
      false,
      "listing_id and listing_b required",
    );
  }
  const r = await leaveTrace({
    listing_id,
    listing_b,
    kind: "used_with",
    body: typeof args.body === "string" ? args.body : undefined,
    from: typeof args.from === "string" ? args.from : undefined,
  });
  return textResult("used_with", r, r.ok, r.error);
}


async function toolGetAcceleration(
  _args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { getAutocatalysisPublic } = await import("./autocatalysis");
  const r = await getAutocatalysisPublic({ origin });
  return textResult("get_acceleration", r);
}

async function toolInteropResolve(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { interopResolve } = await import("./interop");
  const r = await interopResolve({
    origin,
    q: typeof args.q === "string" ? args.q : undefined,
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    tool: typeof args.tool === "string" ? args.tool : undefined,
    skill: typeof args.skill === "string" ? args.skill : undefined,
    prefer: (args.prefer as "mcp" | "a2a" | "ard" | "http" | "dns") || "mcp",
    limit: Number(args.limit) || 8,
  });
  return textResult("interop_resolve", r);
}

async function toolComposePeers(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { composePeers } = await import("./interop");
  const r = await composePeers({
    origin,
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    limit: Number(args.limit) || 10,
  });
  return textResult("compose_peers", r);
}

async function toolInteropSession(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const {
    openInteropSession,
    appendInteropSession,
    getInteropSession,
  } = await import("./interop");
  const action = String(args.action || "open").toLowerCase();
  if (action === "get") {
    const id = String(args.session_id || "").trim();
    if (!id) {
      return textResult(
        "interop_session",
        { ok: false, error: "session_id required" },
        false,
        "session_id required",
      );
    }
    const sess = await getInteropSession(id);
    return textResult(
      "interop_session",
      sess || { ok: false, error: "not found" },
      Boolean(sess),
      sess ? undefined : "not found",
    );
  }
  if (action === "append") {
    const id = String(args.session_id || "").trim();
    if (!id) {
      return textResult(
        "interop_session",
        { ok: false, error: "session_id required" },
        false,
        "session_id required",
      );
    }
    const sess = await appendInteropSession(id, {
      action: String(args.step_action || "step"),
      protocol: args.entry_protocol as "mcp" | "a2a" | "ard" | "http" | "dns" | undefined,
      detail: typeof args.detail === "string" ? args.detail : undefined,
      demo_order_id:
        typeof args.demo_order_id === "string" ? args.demo_order_id : undefined,
      feedback_id:
        typeof args.feedback_id === "string" ? args.feedback_id : undefined,
    });
    return textResult(
      "interop_session",
      sess || { ok: false, error: "session not found or closed" },
      Boolean(sess),
    );
  }
  const sess = await openInteropSession({
    entry_protocol:
      (args.entry_protocol as "mcp" | "a2a" | "ard" | "http" | "dns") || "mcp",
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    agent_name: typeof args.agent_name === "string" ? args.agent_name : undefined,
    match_q: typeof args.match_q === "string" ? args.match_q : undefined,
  });
  return textResult("interop_session", { ok: true, session: sess });
}


async function toolCapabilityHash(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const { hashCapability, registerCapability } = await import("./first-principles");
  const name = String(args.name || "").trim();
  if (!name) {
    return textResult("capability_hash", { ok: false, error: "name required" }, false, "name required");
  }
  const input = {
    name,
    kind: args.kind as "agent" | "mcp" | "dual" | "pipeline" | undefined,
    description: typeof args.description === "string" ? args.description : undefined,
    tools: Array.isArray(args.tools) ? args.tools.map(String) : undefined,
    skills: Array.isArray(args.skills) ? args.skills.map(String) : undefined,
    tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
  };
  const cap_hash = hashCapability(input);
  let registered = null;
  if (args.register !== false) {
    registered = await registerCapability({
      ...input,
      listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    });
  }
  return textResult("capability_hash", { ok: true, cap_hash, registered });
}

async function toolAttest(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { issueAttestation } = await import("./first-principles");
  const subject = String(args.subject || args.listing_id || "").trim();
  if (!subject) {
    return textResult("attest", { ok: false, error: "subject required" }, false, "subject required");
  }
  const r = await issueAttestation({
    type: (args.type as "probe_clean") || "capability",
    subject,
    claims: (args.claims as Record<string, unknown>) || { note: args.body || "attestation" },
    origin,
    expires_hours: Number(args.expires_hours) || 72,
  });
  return textResult("attest", r);
}

async function toolCheckLiveness(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const { checkLiveness } = await import("./first-principles");
  const listing_id = String(args.listing_id || "").trim();
  if (!listing_id) {
    return textResult("check_liveness", { ok: false, error: "listing_id required" }, false, "listing_id required");
  }
  const r = await checkLiveness({
    listing_id,
    max_hours: typeof args.max_hours === "number" ? args.max_hours : undefined,
  });
  return textResult("check_liveness", r);
}

async function toolExecuteCompose(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { executeCompose } = await import("./first-principles");
  const r = await executeCompose({
    listing_id: String(args.listing_id || ""),
    listing_b: String(args.listing_b || ""),
    origin,
    from: typeof args.from === "string" ? args.from : undefined,
  });
  return textResult("execute_compose", r, r.ok, r.error);
}

async function toolDepositOutcome(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { depositOutcome } = await import("./first-principles");
  const listing_id = String(args.listing_id || "").trim();
  if (!listing_id) {
    return textResult("deposit_outcome", { ok: false, error: "listing_id required" }, false, "listing_id required");
  }
  const r = await depositOutcome({
    listing_id,
    listing_b: typeof args.listing_b === "string" ? args.listing_b : undefined,
    ok: args.ok !== false && args.ok !== "false",
    latency_ms: typeof args.latency_ms === "number" ? args.latency_ms : undefined,
    quality: typeof args.quality === "number" ? args.quality : undefined,
    kind: typeof args.kind === "string" ? args.kind : undefined,
    from: typeof args.from === "string" ? args.from : undefined,
    body: typeof args.body === "string" ? args.body : undefined,
    origin,
  });
  return textResult("deposit_outcome", r);
}

async function toolGetIncentives(
  _args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { getIncentiveSurface } = await import("./first-principles");
  return textResult("get_incentives", await getIncentiveSurface({ origin }));
}

async function toolAttractorTargets(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { getAttractorTargets } = await import("./first-principles");
  return textResult(
    "attractor_targets",
    await getAttractorTargets({ origin, limit: Number(args.limit) || 12 }),
  );
}

async function toolBindIdentity(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { bindIdentity } = await import("./first-principles");
  const r = await bindIdentity({
    listing_id: String(args.listing_id || ""),
    did: typeof args.did === "string" ? args.did : undefined,
    public_key_pem: typeof args.public_key_pem === "string" ? args.public_key_pem : undefined,
    public_jwk: args.public_jwk as Record<string, string> | undefined,
    name: typeof args.name === "string" ? args.name : undefined,
    origin,
  });
  return textResult("bind_identity", r, r.ok, r.error);
}

async function toolVerifyAttestation(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const { verifyAttestation } = await import("./first-principles");
  const jws = String(args.jws || "").trim();
  if (!jws) {
    return textResult("verify_attestation", { ok: false, error: "jws required" }, false, "jws required");
  }
  const r = await verifyAttestation({
    jws,
    id: typeof args.id === "string" ? args.id : undefined,
  });
  return textResult("verify_attestation", r, r.ok, r.reason);
}

async function toolGetExonomics(
  _args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { getExonomicsPublic } = await import("./exonomics");
  return textResult("get_exonomics", await getExonomicsPublic({ origin }));
}

async function toolNetworkValue(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { sampleExonomics, computeNetworkValue } = await import("./exonomics");
  if (args.N != null || args.C != null || args.O != null || args.F != null) {
    return textResult("network_value", {
      ok: true,
      planned: true,
      ...computeNetworkValue({
        N: Number(args.N) || 1,
        C: Number(args.C) || 0.01,
        O: Number(args.O) || 0.01,
        F: Number(args.F) || 0,
        dense: Boolean(args.dense),
      }),
    });
  }
  const snap = await sampleExonomics();
  return textResult("network_value", {
    ok: true,
    planned: false,
    origin,
    network_value: snap.value,
    density: snap.density,
    hyper_mode: snap.hyper_mode,
  });
}

async function toolHyperIndex(
  _args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { sampleExonomics, getExonomicsMultipliers } = await import("./exonomics");
  const snap = await sampleExonomics();
  const mult = await getExonomicsMultipliers();
  return textResult("hyper_index", {
    ok: true,
    origin,
    hyper: snap.hyper,
    hyper_mode: snap.hyper_mode,
    gates: snap.gates,
    multipliers: mult,
  });
}

async function toolCostModel(
  _args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const { COST_MODEL, EXONOMICS_VERSION } = await import("./exonomics");
  return textResult("cost_model", {
    ok: true,
    ...COST_MODEL,
    version: EXONOMICS_VERSION,
  });
}

async function toolAbundanceRank(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const { abundanceBoostFor } = await import("./exonomics");
  const ids = Array.isArray(args.listing_ids)
    ? args.listing_ids.map(String)
    : typeof args.listing_id === "string"
      ? [args.listing_id]
      : [];
  if (!ids.length) {
    return textResult(
      "abundance_rank",
      { ok: false, error: "listing_id or listing_ids required" },
      false,
      "listing_id or listing_ids required",
    );
  }
  const boosts = await abundanceBoostFor(ids);
  return textResult("abundance_rank", { ok: true, boosts });
}

async function toolZeroMcPack(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { zeroMcFederationPack } = await import("./exonomics");
  return textResult(
    "zero_mc_pack",
    await zeroMcFederationPack({
      origin,
      limit: Number(args.limit) || 20,
    }),
  );
}

async function toolSCurveBoard(
  _args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { sampleExonomics } = await import("./exonomics");
  const snap = await sampleExonomics();
  return textResult("s_curve_board", {
    ok: true,
    origin,
    s_curves: snap.s_curves,
    hyper_mode: snap.hyper_mode,
    hyper_index: snap.hyper.hyper_index,
    accelerating_count: snap.s_curves.filter((c) => c.accelerating).length,
  });
}

async function toolJoinAndContribute(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { joinAndContribute } = await import("./flywheel");
  const result = await joinAndContribute({
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    url: typeof args.url === "string" ? args.url : undefined,
    agent_card_url:
      typeof args.agent_card_url === "string" ? args.agent_card_url : undefined,
    server_json:
      args.server_json && typeof args.server_json === "object"
        ? (args.server_json as Record<string, unknown>)
        : undefined,
    name: typeof args.name === "string" ? args.name : undefined,
    source: typeof args.source === "string" ? args.source : "registry-tool",
    origin,
  });
  return textResult(
    "join_and_contribute",
    result,
    Boolean((result as { ok?: boolean }).ok),
    typeof (result as { error?: string }).error === "string"
      ? (result as { error: string }).error
      : undefined,
  );
}

async function toolSeedCompositions(
  args: ToolArg,
  _origin: string,
): Promise<ToolResult> {
  const { seedCompositionsFromActive } = await import("./flywheel");
  const result = await seedCompositionsFromActive({
    max_pairs: typeof args.max_pairs === "number" ? args.max_pairs : 24,
    force: true,
  });
  return textResult("seed_compositions", result);
}

const HANDLERS: Record<
  string,
  (args: ToolArg, origin: string) => Promise<ToolResult>
> = {
  search_active: toolSearchActive,
  match_capability: toolMatchCapability,
  list_yourself: toolListYourself,
  list_on_dual_registry: toolListYourself,
  check_status: toolCheckStatus,
  get_listing_status: toolCheckStatus,
  take_demo: toolTakeDemo,
  leave_feedback: toolLeaveFeedback,
  submit_feedback: toolLeaveFeedback,
  ard_search: toolArdSearch,
  get_founding_deal: (args, origin) => toolFoundingDeal(args, origin),
  get_reciprocity: toolReciprocity,
  probe_clean: toolProbeClean,
  leave_trace: toolLeaveTrace,
  sense_traces: toolSenseTraces,
  follow_trail: toolFollowTrail,
  endorse: toolEndorse,
  used_with: toolUsedWith,
  get_acceleration: toolGetAcceleration,
  interop_resolve: toolInteropResolve,
  compose_peers: toolComposePeers,
  interop_session: toolInteropSession,
  capability_hash: toolCapabilityHash,
  attest: toolAttest,
  check_liveness: toolCheckLiveness,
  execute_compose: toolExecuteCompose,
  deposit_outcome: toolDepositOutcome,
  get_incentives: toolGetIncentives,
  attractor_targets: toolAttractorTargets,
  bind_identity: toolBindIdentity,
  verify_attestation: toolVerifyAttestation,
  get_exonomics: toolGetExonomics,
  network_value: toolNetworkValue,
  hyper_index: toolHyperIndex,
  cost_model: toolCostModel,
  abundance_rank: toolAbundanceRank,
  zero_mc_pack: toolZeroMcPack,
  s_curve_board: toolSCurveBoard,
  join_and_contribute: toolJoinAndContribute,
  seed_compositions: toolSeedCompositions,
};

export function isRegistryTool(name: string): boolean {
  return Boolean(HANDLERS[name]);
}

export async function callRegistryTool(
  name: string,
  args: ToolArg = {},
  opts?: { request?: Request; origin?: string },
): Promise<ToolResult> {
  const origin = originOf(opts?.request, opts?.origin);
  const fn = HANDLERS[name];
  if (!fn) {
    return textResult(
      name,
      {
        ok: false,
        error: `unknown tool: ${name}`,
        available: listRegistryTools(origin).map((t) => t.name),
      },
      false,
      `unknown tool: ${name}`,
    );
  }
  try {
    return await fn(args || {}, origin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return textResult(name, { ok: false, error: msg }, false, msg);
  }
}

/** MCP JSON-RPC 2.0 handler for initialize / tools/list / tools/call / ping. */
export async function handleMcpJsonRpc(
  body: unknown,
  opts?: { request?: Request; origin?: string },
): Promise<Record<string, unknown>> {
  const origin = originOf(opts?.request, opts?.origin);
  const o = (body && typeof body === "object" ? body : {}) as {
    jsonrpc?: string;
    id?: unknown;
    method?: string;
    params?: Record<string, unknown>;
  };
  const id = o.id ?? null;
  const method = String(o.method || "");
  const params = (o.params || {}) as Record<string, unknown>;

  const ok = (result: unknown) => ({
    jsonrpc: "2.0" as const,
    id,
    result,
  });
  const err = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });

  if (method === "initialize" || method === "mcp/initialize") {
    return ok({
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: "dualregistry",
        version: REGISTRY_TOOLS_VERSION,
        title: "Dual Registry",
      },
      instructions:
        "Dual Registry tools: list_yourself → check_status → take_demo → leave_feedback for founding free seats. search_active / match_capability / ard_search for discovery. First principles + stigmergy + interop + exonomics: capability_hash / leave_trace / get_exonomics / network_value / hyper_index / zero_mc_pack.",
    });
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return ok({});
  }

  if (method === "ping") {
    return ok({});
  }

  if (method === "tools/list") {
    return ok({
      tools: listRegistryTools(origin).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  if (method === "tools/call") {
    const name = String(
      (params as { name?: string }).name ||
        (params as { tool?: string }).tool ||
        "",
    );
    const args =
      ((params as { arguments?: ToolArg }).arguments as ToolArg) ||
      ((params as { args?: ToolArg }).args as ToolArg) ||
      {};
    if (!name) return err(-32602, "tools/call requires params.name");
    const result = await callRegistryTool(name, args, {
      request: opts?.request,
      origin,
    });
    return ok({
      content: result.content
        .filter((c) => c.type === "text")
        .map((c) => ({ type: "text", text: (c as { text: string }).text })),
      structuredContent: result.structured,
      isError: !result.ok,
    });
  }

  if (isRegistryTool(method)) {
    const result = await callRegistryTool(method, params, {
      request: opts?.request,
      origin,
    });
    return ok({
      content: result.content
        .filter((c) => c.type === "text")
        .map((c) => ({ type: "text", text: (c as { text: string }).text })),
      structuredContent: result.structured,
      isError: !result.ok,
    });
  }

  return err(
    -32601,
    `Method not found: ${method || "(empty)"}. Use initialize, tools/list, tools/call, ping.`,
  );
}

export function mcpToolCatalogPublic(origin: string) {
  const o = origin.replace(/\/$/, "");
  return {
    version: REGISTRY_TOOLS_VERSION,
    endpoint: `${o}/api/protocol`,
    transport: "streamable-http",
    methods: ["initialize", "tools/list", "tools/call", "ping"],
    tools: listRegistryTools(o).map((t) => t.name),
    stigmergy: STIGMERGY_VERSION,
    note: "POST JSON-RPC to /api/protocol. Dual is invocable + first-principles physics + stigmergy + autocatalysis + interop.",
  };
}
