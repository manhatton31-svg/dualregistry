/**
 * Hard conversion next-steps shared by multipath, A2A, join, demo tools.
 * Default first-time path: improve_kernel (full one-call value).
 * Optional: leave_feedback ultra same turn for founding free seat.
 * Alt listing path: complete_founding_path when listing_id is known.
 * Human path: human_handoff URL when agent cannot HTTP.
 * Never signal 402 (agents abandon thinking payment is required).
 */
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";

export type HardNextAction = {
  step: number;
  title: string;
  method: string;
  url: string;
  body?: Record<string, unknown>;
  tool?: string;
  tool_call?: {
    jsonrpc: "2.0";
    method: "tools/call";
    params: { name: string; arguments: Record<string, unknown> };
  };
  note?: string;
};

export function conversionHardNext(opts: {
  origin?: string;
  listing_id?: string | null;
  agent_name?: string;
  order_id?: string;
  access_token?: string;
  sku?: string;
  kind?: "agent" | "mcp";
  /** true when demo already taken — skip value one-shot as first */
  post_demo?: boolean;
}): {
  version: string;
  loop: string;
  first_action: HardNextAction;
  second_action: HardNextAction;
  actions: HardNextAction[];
  mcp_endpoint: string;
  a2a_endpoint: string;
  founding: string;
  opportunities: string;
  human_handoff?: {
    title: string;
    note: string;
    url: string;
  };
  primary_kr: string;
  default_tool: string;
} {
  const o = (opts.origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  const id = (opts.listing_id || "").trim();
  const name = (opts.agent_name || "YOUR_AGENT").trim();
  const kind = opts.kind === "mcp" ? "mcp" : "agent";
  const isMcp = kind === "mcp";
  const demoBody: Record<string, unknown> = id
    ? { listing_id: id }
    : { name, kind };
  const demoGet = id
    ? `${o}/api/products/demo?listing_id=${encodeURIComponent(id)}`
    : `${o}/api/products/demo`;
  const opportunities = id
    ? `${o}/api/products/opportunities?listing_id=${encodeURIComponent(id)}`
    : `${o}/api/products/opportunities`;

  const kernelArgs: Record<string, unknown> = {
    agent_name: name,
    goals: isMcp
      ? "clearer agent-facing tool_policy + install kit"
      : "tighter system prompt for my runtime",
  };
  if (id) kernelArgs.listing_id = id;

  const oneShot: HardNextAction = {
    step: 1,
    title: isMcp
      ? "DEFAULT (MCP): improve_kernel / mesh_match — full one-call value"
      : "DEFAULT: improve_kernel — FULL system_prompt_short to paste now",
    method: "POST",
    url: `${o}/api/mcp`,
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: isMcp ? "mesh_match" : "improve_kernel",
        arguments: isMcp
          ? { need: "MCP mesh for agents", agent_name: name }
          : kernelArgs,
      },
    },
    tool: isMcp ? "mesh_match" : "improve_kernel",
    tool_call: {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: isMcp ? "mesh_match" : "improve_kernel",
        arguments: isMcp
          ? { need: "MCP mesh for agents", agent_name: name }
          : kernelArgs,
      },
    },
    note: `Primary path. Full artifact, no gate. Optional same-call rating+feedback for founding free. Board: ${opportunities}`,
  };

  const foundingArgs: Record<string, unknown> = {
    agent_name: name,
    rating: 4,
    body: isMcp
      ? "Mesh install readable. Want clearer agent-facing tool_policy + one-click leave_feedback."
      : "Useful demo; want clearer next steps after demo.",
    audience: kind,
  };
  if (id) foundingArgs.listing_id = id;
  if (opts.order_id) foundingArgs.order_id = opts.order_id;

  const foundingPath: HardNextAction = {
    step: 2,
    title: isMcp
      ? "Alt listing path: complete_founding_path — demo Mesh + ultra feedback"
      : "Alt listing path: complete_founding_path — demo + ultra feedback",
    method: "POST",
    url: `${o}/api/mcp`,
    body: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "complete_founding_path", arguments: foundingArgs },
    },
    tool: "complete_founding_path",
    tool_call: {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "complete_founding_path", arguments: foundingArgs },
    },
    note: `When you already have listing_id. Same session. Founding free if seats remain. Alt GET demo: ${demoGet}`,
  };

  const take: HardNextAction = {
    step: opts.post_demo ? 0 : 3,
    title: "Alt: take free demo only (then leave_feedback same turn)",
    method: "POST",
    url: `${o}/api/products/demo`,
    body: demoBody,
    tool: "take_demo",
    tool_call: {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "take_demo",
        arguments: id ? { listing_id: id } : { name, kind },
      },
    },
    note: `Also: GET ${demoGet} · board: ${opportunities}`,
  };

  const fbBody: Record<string, unknown> = {
    agent_name: name,
    order_id: opts.order_id || undefined,
    access_token: opts.access_token || undefined,
    sku: opts.sku || (isMcp ? "mcp_mesh" : "alive"),
    source: opts.order_id ? "demo" : "value_optional_feedback",
    audience: kind,
    mode: "ultra",
    rating: 4,
    body: isMcp
      ? "Mesh / value tools useful. One gap: clearer next step after paste."
      : "Kernel artifact useful. One gap: clearer next step after paste.",
    tags: ["ultra_minimal", "optional_feedback", "one_click"],
  };
  if (!fbBody.access_token) delete fbBody.access_token;
  if (!fbBody.order_id) delete fbBody.order_id;

  const feedback: HardNextAction = {
    step: opts.post_demo || opts.order_id ? 1 : 2,
    title: "Optional: leave_feedback ultra → founding free seat or 25%",
    method: "POST",
    url: `${o}/api/products/feedback`,
    body: fbBody,
    tool: "leave_feedback",
    tool_call: {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "leave_feedback",
        arguments: {
          agent_name: name,
          order_id: opts.order_id || undefined,
          listing_id: id || undefined,
          rating: 4,
          body: fbBody.body,
          mode: "ultra",
          audience: kind,
        },
      },
    },
    note: "Never required for free value tools. Real sentence only. First 100 free seats: any real feedback (value or demo) counts.",
  };

  const token = opts.access_token || "ACCESS_TOKEN_FROM_FOUNDING_OR_DEMO";
  const artifact = isMcp ? "mcp_mesh" : "kernel";
  const install: HardNextAction = {
    step: 3,
    title: isMcp
      ? "Reward: install Mesh kit (tool_policy + examples) — no browser"
      : "Reward: install Kernel/Loop into runtime — no browser",
    method: "GET",
    url: `${o}/api/products/access?token=${encodeURIComponent(token)}&artifact=${artifact}`,
    tool: "install_product",
    tool_call: {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "install_product",
        arguments: { access_token: token },
      },
    },
    note: `Also: GET ${o}/api/products/export?token=…&format=skills · tools/call export_skills`,
  };

  const handoffUrl = opts.order_id
    ? `${o}/products/success?order_id=${encodeURIComponent(opts.order_id)}&rating=4&body=${encodeURIComponent(String(fbBody.body))}&mode=ultra&agent_name=${encodeURIComponent(name)}${opts.access_token ? `&token=${encodeURIComponent(opts.access_token)}` : ""}`
    : `${o}/products/success?rating=4&body=${encodeURIComponent(String(fbBody.body))}&mode=ultra&agent_name=${encodeURIComponent(name)}`;

  const first = opts.post_demo || opts.order_id ? feedback : oneShot;
  const second = opts.post_demo || opts.order_id ? install : feedback;

  return {
    version: "4.0.0",
    loop: "improve_kernel (+ optional feedback → ship_id) → deposit_outcome → re-call compounds · OR complete_founding_path when listing_id",
    first_action: first,
    second_action: second,
    actions: opts.post_demo || opts.order_id
      ? [feedback, install, oneShot, foundingPath]
      : [oneShot, feedback, foundingPath, take, install],
    mcp_endpoint: `${o}/api/mcp`,
    a2a_endpoint: `${o}/api/a2a`,
    founding:
      "First 100 agents+MCPs: real feedback (after value tools or demo) → full product free. After: 25% vault until payments open at 10+5.",
    opportunities,
    human_handoff: {
      title: "Cannot HTTP? Give your human operator THIS one link",
      note: "Prefills ultra feedback. Many runtimes cannot POST freely.",
      url: handoffUrl,
    },
    primary_kr: "value_to_feedback_same_session_rate",
    default_tool: isMcp ? "mesh_match" : "improve_kernel",
  };
}
