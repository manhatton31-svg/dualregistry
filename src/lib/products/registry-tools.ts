/**
 * Dual-as-tool — invocable registry ops for MCP tools/list|call and A2A skills.
 * Wraps existing REST backends; one handler map for both transports.
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { dualPublish } from "@/lib/agents1/publish";
import { getListingStatus } from "@/lib/agents1/inbound-discovery";
import { ardSearch } from "@/lib/agents1/ai-catalog";
import { runQuickDemo } from "./quick-demo";
import { submitFeedback } from "./feedback";
import { getFoundingFreePublic } from "./founding-free";
import { dealPublicBlock } from "./deal-copy";

export const REGISTRY_TOOLS_VERSION = "2.3.0";

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
        "Capability matchmaking — rank Active clean listings for a natural-language need (demo available). Better than raw keyword for marketplace use.",
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
        "Free Kernel/Loop (or Mesh) demo for an Active listing. Prefer listing_id. Counts toward founding free seats after feedback.",
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
        "Submit real demo feedback. First 100 agents+MCPs unlock full product free (founding seats). After that: 25% founding code.",
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
        "Founding free seat meter (100 seats) + deal copy. Use after demo to claim free full product via leave_feedback.",
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
        "Probe-as-service signal: return Dual clean-registry status for a listing (portable trust).",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string" },
          id: { type: "string" },
          name: { type: "string" },
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

  return textResult("search_active", {
    ok: true,
    total_matched: rows.length,
    returned: items.length,
    active_clean: clean.size,
    items,
    founding: await getFoundingFreePublic(),
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
  return textResult("list_yourself", {
    ...result,
    next_tools: ["check_status", "take_demo", "leave_feedback"],
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
  return textResult("take_demo", {
    ...demo,
    founding: await getFoundingFreePublic(),
    next: "Call leave_feedback with agent_name + order_id from demo to claim founding free seat",
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
      listing_id:
        typeof args.listing_id === "string" ? args.listing_id : undefined,
      via: "dual-as-tool",
      origin,
    },
  });
  return textResult(
    "leave_feedback",
    {
      ...result,
      founding: await getFoundingFreePublic(),
      origin,
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
  return textResult("probe_clean", {
    ok: true,
    listing_id: lid || null,
    name: status?.name || name || null,
    checks_clean: Boolean(item),
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
    note: "checks_clean means Dual probe ok + Active lane. Portable trust for other registries.",
  });
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
    jsonrpc: "2.0" as const,
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
        "Dual Registry tools: list_yourself → check_status → take_demo → leave_feedback for founding free seats. search_active / match_capability / ard_search for discovery.",
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
    // MCP content format
    return ok({
      content: result.content
        .filter((c) => c.type === "text")
        .map((c) => ({ type: "text", text: (c as { text: string }).text })),
      structuredContent: result.structured,
      isError: !result.ok,
    });
  }

  // Also accept bare method names as tool calls (some clients)
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
    note: "POST JSON-RPC to /api/protocol. Dual is invocable — not just crawlable.",
  };
}
