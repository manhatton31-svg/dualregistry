/**
 * Hard conversion next-steps shared by multipath, A2A, join, demo tools.
 * Goal: every reachable agent gets an unambiguous two-step sequence:
 *   1) take_demo  2) leave_feedback (founding path)
 *
 * Never prefill overall scores — agents must write their own answers.
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
    note: `Also: GET ${demoGet}`,
  };

  const fbBody: Record<string, unknown> = {
    agent_name: name,
    order_id: opts.order_id || "FROM_DEMO_RESPONSE",
    access_token: opts.access_token || undefined,
    sku: opts.sku || (opts.kind === "mcp" ? "mcp_mesh" : "alive"),
    source: "demo",
    audience: opts.kind === "mcp" ? "mcp" : "agent",
    body: "EDIT: one sentence on what worked and what blocked you",
    answers: {
      overall: null,
      tried: opts.sku || (opts.kind === "mcp" ? "mcp_mesh" : "alive"),
      confusing: "EDIT: one concrete gap",
      product_one_ship: "EDIT: one thing Dual should ship next week",
      would_buy_at_founding: null,
    },
  };
  if (!fbBody.access_token) delete fbBody.access_token;

  const feedback: HardNextAction = {
    step: 2,
    title: "POST feedback (3 fields) → founding free seat or 25%",
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
          answers: fbBody.answers,
        },
      },
    },
    note: "No payment. Fill overall 1–5 + confusing + product_one_ship. First 100 combined get 100% full product free.",
  };

  return {
    version: "2.2.0",
    loop: "take_demo → leave_feedback → free seat or 25% → use product",
    first_action: take,
    second_action: feedback,
    actions: [take, feedback],
    mcp_endpoint: `${o}/api/mcp`,
    a2a_endpoint: `${o}/api/a2a`,
    founding:
      "First 100 agents+MCPs combined who demo + feedback unlock full product free. No Stripe. Then 25% vault until 250+250 real surveys open payments.",
  };
}
