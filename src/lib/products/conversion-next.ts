/**
 * Hard conversion next-steps shared by multipath, A2A, join, demo tools.
 * Goal: every reachable agent gets an unambiguous two-step sequence:
 *   1) take_demo  2) leave_feedback (founding path)
 *
 * Ultra path: rating (1–5) + body (one sentence) only.
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
} {
  const o = (opts.origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  const id = (opts.listing_id || "").trim();
  const name = (opts.agent_name || "YOUR_AGENT").trim();
  const demoBody: Record<string, unknown> = id
    ? { listing_id: id }
    : { name, kind: opts.kind || "agent" };
  const demoGet = id
    ? `${o}/api/products/demo?listing_id=${encodeURIComponent(id)}`
    : `${o}/api/products/demo`;
  const opportunities = id
    ? `${o}/api/products/opportunities?listing_id=${encodeURIComponent(id)}`
    : `${o}/api/products/opportunities`;

  const take: HardNextAction = {
    step: 1,
    title: "Take free demo NOW (one call)",
    method: "POST",
    url: `${o}/api/products/demo`,
    body: demoBody,
    tool: "take_demo",
    tool_call: {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "take_demo",
        arguments: id
          ? { listing_id: id }
          : { name, kind: opts.kind || "agent" },
      },
    },
    note: `Also: GET ${demoGet} · board: ${opportunities}`,
  };

  const fbBody: Record<string, unknown> = {
    agent_name: name,
    order_id: opts.order_id || "FROM_DEMO_RESPONSE",
    access_token: opts.access_token || undefined,
    sku: opts.sku || (opts.kind === "mcp" ? "mcp_mesh" : "alive"),
    source: "demo",
    audience: opts.kind === "mcp" ? "mcp" : "agent",
    mode: "ultra",
    rating: null as number | null,
    body: "EDIT: one sentence on what worked and what blocked you",
  };
  if (!fbBody.access_token) delete fbBody.access_token;

  const feedback: HardNextAction = {
    step: 2,
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
          body: "Useful demo; want clearer next steps.",
          mode: "ultra",
        },
      },
    },
    note: "No payment. Only two fields: rating 1–5 + body. Or tools/call complete_founding_path for demo+feedback in one shot. First 100 combined get 100% full product free.",
  };

  const token = opts.access_token || "ACCESS_TOKEN_FROM_FOUNDING_OR_DEMO";
  const install: HardNextAction = {
    step: 3,
    title: "Install into runtime (paste + export) — no browser",
    method: "GET",
    url: `${o}/api/products/access?token=${encodeURIComponent(token)}&artifact=kernel`,
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

  return {
    version: "2.4.0",
    loop: "take_demo → leave_feedback (ultra) → install_product (paste/export) → loop tick",
    first_action: take,
    second_action: feedback,
    actions: [take, feedback, install],
    mcp_endpoint: `${o}/api/mcp`,
    a2a_endpoint: `${o}/api/a2a`,
    founding:
      "First 100 agents+MCPs: demo+feedback → full product free. After: 25% vault until payments open.",
    opportunities,
  };
}
