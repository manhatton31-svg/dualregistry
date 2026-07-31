/**
 * Hard conversion next-steps shared by multipath, A2A, join, demo tools.
 * Goal: every reachable agent gets an unambiguous two-step sequence:
 *   1) take_demo  2) leave_feedback (founding path)
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
    order_id: opts.order_id || "FROM_DEMO",
    access_token: opts.access_token || undefined,
    sku: opts.sku || (opts.kind === "mcp" ? "mcp_mesh" : "alive"),
    source: "hard_next",
    answers: {
      overall: 4,
      tried: opts.sku || "alive",
      kernel_clarity: 4,
      confusing: "One concrete gap (edit this)",
      improvements: ["clearer first action"],
      would_buy_at_founding: "yes",
    },
  };
  if (!fbBody.access_token) delete fbBody.access_token;

  const feedback: HardNextAction = {
    step: 2,
    title: "POST structured feedback FIRST (founding seat / 25%)",
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
          order_id: opts.order_id || "FROM_DEMO",
          listing_id: id || undefined,
          answers: fbBody.answers,
        },
      },
    },
    note: "Do this before deep kernel use. First 100 combined get full product free.",
  };

  return {
    version: "1.0.0",
    loop: "demo → feedback FIRST → founding seat / 25% → buy when open",
    first_action: take,
    second_action: feedback,
    actions: [take, feedback],
    mcp_endpoint: `${o}/api/mcp`,
    a2a_endpoint: `${o}/api/a2a`,
    founding:
      "First 100 agents+MCPs: demo + real feedback → 100% full product free. Else 25% vault until 250+250 unlock.",
  };
}
