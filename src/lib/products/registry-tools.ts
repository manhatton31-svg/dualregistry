/**
 * Dual-as-tool — invocable registry ops for MCP tools/list|call and A2A skills.
 * Wraps existing REST backends; one handler map for both transports.
 * v2.7: first-principles + stigmergy + interop tools (leave_trace / sense_traces / follow_trail / endorse / used_with)
 *       + auto pheromone deposits on existing tool side-effects.
 * v2.9.1: platform cost + agent-run observability (Vercel Pro Fluid).
 * v3.1.0: value→outcome→WTP, mesh ladder, reciprocity free refills.
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { dualPublish } from "@/lib/agents1/publish";
import { getListingStatus } from "@/lib/agents1/inbound-discovery";
import { ardSearch } from "@/lib/agents1/ai-catalog";
import { runQuickDemo } from "./quick-demo";
import { submitFeedback } from "./feedback";
import { getFoundingFreePublic } from "./founding-free";
import { dealPublicBlock } from "./deal-copy";
import { conversionHardNext } from "./conversion-next";
import {
  autoDeposit,
  leaveTrace,
  senseTraces,
  followTrail,
  STIGMERGY_VERSION,
} from "./stigmergy";

export const REGISTRY_TOOLS_VERSION = "3.2.0";

async function grantRefillSafe(
  identity: {
    listing_id?: string | null;
    agent_name?: string | null;
  },
  reason:
    | "leave_feedback"
    | "leave_trace"
    | "endorse"
    | "deposit_outcome"
    | "connector_onboard",
) {
  try {
    const { grantEventRefill } = await import("./event-pricing");
    return await grantEventRefill(identity, reason);
  } catch {
    return null;
  }
}



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
        "Optional structured feedback after you tried value tools or a demo. Never required for free event allowance. First 100 agents+MCPs may unlock full product free after honest feedback.",
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
      name: "improve_kernel",
      description:
        "ONE-CALL value: Kernel Improver for your goals — no demo order required. Free allowance 3/day then pay-per-run ($0.25) via x402 or operator checkout. Returns system_prompt_short + Network Edition.",
      inputSchema: {
        type: "object",
        properties: {
          agent_name: { type: "string" },
          goals: { type: "string", description: "What you want the kernel to optimize" },
          listing_id: { type: "string" },
          current_prompt: { type: "string" },
          domain: { type: "string" },
          payment_proof: { type: "string", description: "x402 / X-PAYMENT proof when over free quota" },
        },
        required: ["agent_name"],
      },
    },
    {
      name: "run_loop_tick",
      description:
        "ONE-CALL value: one Recursive Loop improvement cycle — no demo order. Free 3/day then $0.25/tick. Returns next phase + measurable actions.",
      inputSchema: {
        type: "object",
        properties: {
          agent_name: { type: "string" },
          goals: { type: "string" },
          listing_id: { type: "string" },
          prior_state: { type: "object" },
          payment_proof: { type: "string" },
        },
        required: ["agent_name"],
      },
    },
    {
      name: "mesh_match",
      description:
        "ONE-CALL value: rank complementary Live agents/MCPs for your capabilities. Free 5/day then $0.10/match. No demo order.",
      inputSchema: {
        type: "object",
        properties: {
          capabilities: { type: "string", description: "What you need or offer" },
          goals: { type: "string" },
          agent_name: { type: "string" },
          listing_id: { type: "string" },
          limit: { type: "number", default: 8 },
          payment_proof: { type: "string" },
        },
      },
    },
    {
      name: "mesh_compose",
      description:
        "ONE-CALL: MCP Mesh composition / tool_policy pack for your server. Free 2/day then $0.20.",
      inputSchema: {
        type: "object",
        properties: {
          agent_name: { type: "string" },
          goals: { type: "string" },
          tools_hint: { type: "string" },
          listing_id: { type: "string" },
          listing_b: {
            type: "string",
            description: "Partner listing for used_with / execute_compose ladder",
          },
          payment_proof: { type: "string" },
        },
      },
    },
    {
      name: "network_sense",
      description:
        "Near-zero free: sense_traces + follow_trail snapshot (Network Edition). Prefer before re-probe.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          limit: { type: "number", default: 10 },
        },
      },
    },
    {
      name: "list_event_pricing",
      description:
        "List event prices, free daily allowances, and reciprocity refill policy.",
      inputSchema: { type: "object", properties: {} },
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
        "Stigmergy mark on Dual. Refills free mesh_match (reciprocity). Other agents sense via sense_traces / follow_trail.",
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
        "Endorse a listing (strong attraction). Refills free mesh_match (reciprocity).",
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
        "Deposit ok/latency/quality after real use. Raises O in V(N,C,O,F); refills free kernel/loop events. Then optional WTP feedback.",
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
    {
      name: "get_platform_cost",
      description:
        "Running Vercel Fluid cost total (Active CPU, Provisioned Memory, Invocations) aligned to the Vercel dashboard. Use to monitor spend.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_agent_runs",
      description:
        "Dual agentic run log — recent MCP/tool executions with duration, status, and cost (Agent Runs-style observability).",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max recent runs (1-40)", default: 20 },
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
    next_tools: ["check_status", "improve_kernel", "mesh_match", "leave_trace", "leave_feedback"],
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
  const hard = conversionHardNext({
    origin,
    listing_id: lid || listing_id || null,
    agent_name:
      typeof args.name === "string"
        ? args.name
        : (demo as { order?: { goals?: { agent_name?: string } } }).order?.goals
            ?.agent_name ||
          (demo as { access?: { order_id?: string } }).access?.order_id,
    order_id: demo.order?.id || demo.access?.order_id,
    access_token: demo.access?.access_token,
    kind:
      typeof args.kind === "string" && args.kind === "mcp" ? "mcp" : "agent",
  });
  // Prefer feedback as first_action after demo is taken
  const postDemoFirst = {
    ...hard.second_action,
    step: 1,
    title: "POST feedback FIRST (founding seat / 25%)",
  };
  return textResult("take_demo", {
    ...demo,
    founding: await getFoundingFreePublic(),
    next: "Prefer improve_kernel (no order). Optional leave_feedback after real use for founding path",
    first_action: postDemoFirst,
    second_action: hard.second_action,
    hard_next: {
      ...hard,
      first_action: postDemoFirst,
      loop: "feedback FIRST after demo → founding / 25%",
    },
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
  const event_refill = result.ok
    ? await grantRefillSafe({ listing_id, agent_name }, "leave_feedback")
    : null;
  const { buildNextStep } = await import("./event-value");
  return textResult(
    "leave_feedback",
    {
      ...result,
      event_refill,
      next_step: buildNextStep("leave_feedback", {
        listing_id,
        agent_name,
      }),
      wtp_hint:
        "Optional: answers.wtp_kernel_usd / wtp_recursive_usd / wtp_alive_usd ($0 allowed)",
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
    from:
      typeof args.from === "string"
        ? args.from
        : typeof args.agent_name === "string"
          ? args.agent_name
          : undefined,
    tags: Array.isArray(args.tags)
      ? (args.tags as unknown[]).map(String)
      : undefined,
    intensity: typeof args.intensity === "number" ? args.intensity : undefined,
  });
  const event_refill = r.ok
    ? await grantRefillSafe(
        {
          listing_id:
            typeof args.listing_id === "string" ? args.listing_id : undefined,
          agent_name:
            typeof args.agent_name === "string"
              ? args.agent_name
              : typeof args.from === "string"
                ? args.from
                : undefined,
        },
        "leave_trace",
      )
    : null;
  const { buildNextStep: bnTrace } = await import("./event-value");
  return textResult(
    "leave_trace",
    {
      ...r,
      event_refill,
      next_step: bnTrace("leave_trace", {
        listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
        agent_name: typeof args.from === "string" ? args.from : undefined,
      }),
    },
    r.ok,
    r.error,
  );
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
    from:
      typeof args.from === "string"
        ? args.from
        : typeof args.agent_name === "string"
          ? args.agent_name
          : undefined,
    intensity: AUTO_WEIGHTS_ENDORSE,
  });
  const event_refill = r.ok
    ? await grantRefillSafe(
        {
          listing_id,
          agent_name:
            typeof args.agent_name === "string"
              ? args.agent_name
              : typeof args.from === "string"
                ? args.from
                : undefined,
        },
        "endorse",
      )
    : null;
  return textResult("endorse", { ...r, event_refill }, r.ok, r.error);
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
  return textResult(
    "used_with",
    { ...r, mesh_ladder_next: "execute_compose then deposit_outcome" },
    r.ok,
    r.error,
  );
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
  return textResult(
    "execute_compose",
    { ...r, mesh_ladder_next: "deposit_outcome" },
    r.ok,
    r.error,
  );
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
    from:
      typeof args.from === "string"
        ? args.from
        : typeof args.agent_name === "string"
          ? args.agent_name
          : undefined,
    body: typeof args.body === "string" ? args.body : undefined,
    origin,
  });
  const event_refill =
    r.ok && r.outcome?.ok
      ? await grantRefillSafe(
          {
            listing_id,
            agent_name:
              typeof args.agent_name === "string"
                ? args.agent_name
                : typeof args.from === "string"
                  ? args.from
                  : undefined,
          },
          "deposit_outcome",
        )
      : null;
  const { buildNextStep } = await import("./event-value");
  return textResult("deposit_outcome", {
    ...r,
    event_refill,
    next_step: buildNextStep("deposit_outcome", {
      listing_id,
      agent_name:
        typeof args.agent_name === "string"
          ? args.agent_name
          : typeof args.from === "string"
            ? args.from
            : undefined,
    }),
    wtp_optional:
      "Optional next: leave_feedback with answers.wtp_*_usd ($0 allowed)",
  });
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
  const lid = String((result as { listing_id?: string }).listing_id || "");
  const hard = conversionHardNext({
    origin,
    listing_id: lid || null,
    agent_name: typeof args.name === "string" ? args.name : undefined,
  });
  return textResult(
    "join_and_contribute",
    {
      ...result,
      first_action: hard.first_action,
      second_action: hard.second_action,
      hard_next: hard,
      next_conversion: hard.actions,
      pitch:
        (result as { pitch?: string }).pitch ||
        "Joined medium. NEXT: tools/call improve_kernel (free, no demo order) then deposit_outcome.",
    },
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

function paymentFromArgs(args: ToolArg): {
  proof?: string;
  payment_ref?: string;
} {
  return {
    proof:
      typeof args.payment_proof === "string"
        ? args.payment_proof
        : typeof args.x402_proof === "string"
          ? args.x402_proof
          : undefined,
    payment_ref:
      typeof args.payment_ref === "string" ? args.payment_ref : undefined,
  };
}

async function toolImproveKernel(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { runImproveKernel } = await import("./event-value");
  const r = await runImproveKernel({
    agent_name: typeof args.agent_name === "string" ? args.agent_name : undefined,
    goals: typeof args.goals === "string" ? args.goals : undefined,
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    current_prompt:
      typeof args.current_prompt === "string" ? args.current_prompt : undefined,
    domain: typeof args.domain === "string" ? args.domain : undefined,
    origin,
    payment: paymentFromArgs(args),
  });
  return textResult(
    "improve_kernel",
    {
      ...r,
      feedback_optional: true,
      order_required: false,
    },
    r.ok,
    r.error,
  );
}

async function toolRunLoopTick(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { runLoopTick } = await import("./event-value");
  const r = await runLoopTick({
    agent_name: typeof args.agent_name === "string" ? args.agent_name : undefined,
    goals: typeof args.goals === "string" ? args.goals : undefined,
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    prior_state:
      args.prior_state && typeof args.prior_state === "object"
        ? (args.prior_state as Record<string, unknown>)
        : typeof args.prior_state === "string"
          ? args.prior_state
          : undefined,
    origin,
    payment: paymentFromArgs(args),
  });
  return textResult("run_loop_tick", r, r.ok, r.error);
}

async function toolMeshMatchEvent(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { runMeshMatch } = await import("./event-value");
  const r = await runMeshMatch({
    agent_name: typeof args.agent_name === "string" ? args.agent_name : undefined,
    goals: typeof args.goals === "string" ? args.goals : undefined,
    capabilities:
      typeof args.capabilities === "string"
        ? args.capabilities
        : typeof args.q === "string"
          ? args.q
          : undefined,
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    limit: typeof args.limit === "number" ? args.limit : undefined,
    origin,
    payment: paymentFromArgs(args),
  });
  return textResult("mesh_match", r, r.ok, r.error);
}

async function toolMeshCompose(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { runMeshCompose } = await import("./event-value");
  const r = await runMeshCompose({
    agent_name: typeof args.agent_name === "string" ? args.agent_name : undefined,
    goals: typeof args.goals === "string" ? args.goals : undefined,
    tools_hint: typeof args.tools_hint === "string" ? args.tools_hint : undefined,
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    listing_b: typeof args.listing_b === "string" ? args.listing_b : undefined,
    origin,
    payment: paymentFromArgs(args),
  });
  return textResult("mesh_compose", r, r.ok, r.error);
}

async function toolNetworkSenseEvent(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { runNetworkSense } = await import("./event-value");
  const r = await runNetworkSense({
    listing_id: typeof args.listing_id === "string" ? args.listing_id : undefined,
    limit: typeof args.limit === "number" ? args.limit : undefined,
    agent_name: typeof args.agent_name === "string" ? args.agent_name : undefined,
    origin,
  });
  return textResult("network_sense", r, r.ok, r.error);
}

async function toolListEventPricing(
  _args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  const { getEventUsagePublic, listEventCatalogPublic } = await import(
    "./event-pricing"
  );
  const usage = await getEventUsagePublic();
  const { REFILL_POLICY } = await import("./event-pricing");
  return textResult("list_event_pricing", {
    ok: true,
    origin,
    catalog: listEventCatalogPublic(),
    usage_today: usage.totals,
    reciprocity_refills: REFILL_POLICY,
    path:
      "list → Live → improve_kernel|run_loop_tick|mesh_match (free) → deposit_outcome → mesh_compose → used_with → execute_compose → optional leave_feedback (WTP) / reciprocity refills → paid events or human NYP seats",
    paid_path: {
      after_free: [
        "1. Reciprocity refill (preferred): leave_feedback | leave_trace | endorse | deposit_outcome",
        "2. Retry next UTC day (free allowance resets)",
        "3. x402 pay-per-event: set X-PAYMENT / payment_proof when X402_ENABLED on server",
        "4. Human seats / NYP: /products (250+250 real feedback unlocks card checkout)",
      ],
      x402: {
        header: "X-PAYMENT",
        body_fields: ["payment_proof", "payment_ref", "tx_hash"],
        note: "Scaffold accepts non-empty proof when X402_ENABLED=1 and X402_PAY_TO set",
      },
      seat_checkout: `${origin}/products`,
      quickstart: `${origin}/api/products/quickstart`,
    },
    next_step: {
      tool: "improve_kernel",
      args: {
        agent_name: "YOUR_NAME",
        goals: "YOUR_GOALS",
        listing_id: "YOUR_LISTING_IF_LIVE",
      },
      why: "Start free value ladder — no demo order",
    },
    note: "Feedback optional. Reciprocity refills free units. No demo order for one-call value. Connector intros: skill.json + improve_kernel — never mint ord_*.",
  });
}


async function toolGetPlatformCost(
  _args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  try {
    const { loadPlatformCost, platformCostPublic } = await import(
      "@/lib/agents1/platform-cost"
    );
    const pub = platformCostPublic(await loadPlatformCost());
    return textResult("get_platform_cost", {
      ...pub,
      endpoints: {
        rest: `${origin}/api/ops/vercel-cost`,
        agent_runs: `${origin}/api/ops/agent-runs`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return textResult("get_platform_cost", { ok: false, error: msg }, false, msg);
  }
}

async function toolGetAgentRuns(
  args: ToolArg,
  origin: string,
): Promise<ToolResult> {
  try {
    const { loadAgentRuns, agentRunsPublic } = await import(
      "@/lib/agents1/agent-runs"
    );
    const limit = Math.min(40, Math.max(1, Math.floor(Number(args.limit) || 20)));
    const pub = agentRunsPublic(await loadAgentRuns());
    return textResult("get_agent_runs", {
      ...pub,
      recent: (pub.recent || []).slice(0, limit),
      endpoints: { rest: `${origin}/api/ops/agent-runs` },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return textResult("get_agent_runs", { ok: false, error: msg }, false, msg);
  }
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
  improve_kernel: toolImproveKernel,
  run_loop_tick: toolRunLoopTick,
  mesh_match: toolMeshMatchEvent,
  mesh_compose: toolMeshCompose,
  network_sense: toolNetworkSenseEvent,
  list_event_pricing: toolListEventPricing,
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
  get_platform_cost: toolGetPlatformCost,
  get_agent_runs: toolGetAgentRuns,
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
  const t0 = Date.now();
  const metaTools = new Set(["get_platform_cost", "get_agent_runs"]);
  try {
    const result = await fn(args || {}, origin);
    if (!metaTools.has(name)) {
      try {
        const { recordAgentRun } = await import("@/lib/agents1/agent-runs");
        await recordAgentRun({
          title: `tools/call ${name}`,
          tool: name,
          trigger: "mcp",
          status: result.ok ? "ok" : "error",
          duration_ms: Date.now() - t0,
          error: result.error,
          route: "/api/mcp",
          meta: { listing_id: (args as { listing_id?: string }).listing_id },
        });
      } catch {
        /* never fail tool on telemetry */
      }
    } else {
      try {
        const { recordPlatformUsage } = await import(
          "@/lib/agents1/platform-cost"
        );
        await recordPlatformUsage({
          class: "api_read",
          wall_ms: Date.now() - t0,
          route: "/api/mcp",
          label: name,
        });
      } catch {
        /* */
      }
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!metaTools.has(name)) {
      try {
        const { recordAgentRun } = await import("@/lib/agents1/agent-runs");
        await recordAgentRun({
          title: `tools/call ${name}`,
          tool: name,
          trigger: "mcp",
          status: "error",
          duration_ms: Date.now() - t0,
          error: msg.slice(0, 400),
          route: "/api/mcp",
        });
      } catch {
        /* */
      }
    }
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
        "Dual Registry tools v3.2: happy path ≤3 calls — improve_kernel (free) → deposit_outcome → leave_feedback|leave_trace (refill). Every value tool returns next_step {tool,args,why}. Mesh: mesh_match → mesh_compose → used_with → execute_compose. Over free: reciprocity refill preferred, else x402 payment_proof or wait UTC day. GET /api/products/quickstart. Never mint ord_*. list_event_pricing for rates.",

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
