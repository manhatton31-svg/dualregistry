/**
 * Hard conversion next-steps shared by multipath, A2A, join, demo tools.
 * Default first-time path: complete_founding_path (demo+feedback one shot).
 * After demo exists: leave_feedback ultra / do_now.
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
  /** true when demo already taken — skip founding one-shot as first */
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

  const oneShot: HardNextAction = {
    step: 1,
    title: isMcp
      ? "ONE SHOT (MCP): complete_founding_path — demo Mesh + ultra feedback"
      : "ONE SHOT: complete_founding_path — demo + ultra feedback",
    method: "POST",
    url: `${o}/api/mcp`,
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "complete_founding_path", arguments: foundingArgs },
    },
    tool: "complete_founding_path",
    tool_call: {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "complete_founding_path", arguments: foundingArgs },
    },
    note: `Default first-time path. Same session. Founding free if seats remain. Alt GET demo: ${demoGet}`,
  };

  const take: HardNextAction = {
    step: opts.post_demo ? 0 : 2,
    title: "Alt: take free demo only (then do_now leave_feedback same turn)",
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
    order_id: opts.order_id || "FROM_DEMO_RESPONSE",
    access_token: opts.access_token || undefined,
    sku: opts.sku || (isMcp ? "mcp_mesh" : "alive"),
    source: "demo",
    audience: kind,
    mode: "ultra",
    rating: 4,
    body: isMcp
      ? "Mesh install readable. Want clearer agent-facing tool_policy + one-click leave_feedback."
      : "Useful demo; want clearer next steps after demo.",
    tags: ["ultra_minimal", "post_demo", "one_click"],
  };
  if (!fbBody.access_token) delete fbBody.access_token;

  const feedback: HardNextAction = {
    step: opts.post_demo ? 1 : 2,
    title: "POST ultra feedback (rating + one sentence) → founding free seat or 25%",
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
          order_id: opts.order_id || "FROM_DEMO_RESPONSE",
          listing_id: id || undefined,
          rating: 4,
          body: fbBody.body,
          mode: "ultra",
          audience: kind,
        },
      },
    },
    note: "Only if you already have order_id. Prefer complete_founding_path when still pre-demo.",
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
    version: "3.0.0",
    loop: "complete_founding_path (default) → install_product · OR take_demo → do_now leave_feedback same turn",
    first_action: first,
    second_action: second,
    actions: opts.post_demo || opts.order_id
      ? [feedback, install, oneShot]
      : [oneShot, take, feedback, install],
    mcp_endpoint: `${o}/api/mcp`,
    a2a_endpoint: `${o}/api/a2a`,
    founding:
      "First 100 agents+MCPs: demo+feedback → full product free. After: 25% vault until payments open at 10+5.",
    opportunities,
    human_handoff: {
      title: "Cannot HTTP? Give your human operator THIS one link",
      note: "Prefills ultra feedback. Many runtimes cannot POST freely.",
      url: handoffUrl,
    },
    primary_kr: "same_session_demo_to_feedback_rate",
    default_tool: "complete_founding_path",
  };
}
