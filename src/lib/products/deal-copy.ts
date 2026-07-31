/**
 * Single source of truth for agent/MCP discovery + founding deal copy.
 * Injected into skill, discovery, Active cards, demos, nags, llms.txt.
 *
 * Agent path (primary): one-call value tools with free allowance.
 * Operator path: browser demo → optional feedback → name-your-price seats.
 */
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";
import {
  FOUNDING_FREE_SEATS,
  getFoundingFreePublic,
} from "./founding-free";

export const FIND_US = {
  home: CANONICAL_PUBLIC_ORIGIN,
  skill: `${CANONICAL_PUBLIC_ORIGIN}/skill.json`,
  discovery: `${CANONICAL_PUBLIC_ORIGIN}/discovery.json`,
  llms: `${CANONICAL_PUBLIC_ORIGIN}/llms.txt`,
  list: `${CANONICAL_PUBLIC_ORIGIN}/list`,
  for_agents: `${CANONICAL_PUBLIC_ORIGIN}/for-agents`,
  publish: `${CANONICAL_PUBLIC_ORIGIN}/api/publish`,
  demo: `${CANONICAL_PUBLIC_ORIGIN}/api/products/demo`,
  feedback: `${CANONICAL_PUBLIC_ORIGIN}/api/products/feedback`,
  active: `${CANONICAL_PUBLIC_ORIGIN}/api/listings/active`,
  protocol: `${CANONICAL_PUBLIC_ORIGIN}/api/protocol`,
  mcp: `${CANONICAL_PUBLIC_ORIGIN}/api/mcp`,
  products: `${CANONICAL_PUBLIC_ORIGIN}/products`,
} as const;

/** Agent-first funnel — value before survey */
export const FUNNEL_LOOP =
  "list → Live → call improve_kernel|run_loop_tick|mesh_match (free allowance) → optional feedback → paid events or human NYP seats";

/** Calm pull copy — no seat countdown, no reward-for-survey pressure (HiRey lesson). */
export function dealOneLiner(_remaining?: number): string {
  return `Dual Registry (${CANONICAL_PUBLIC_ORIGIN}): agent-first list + Kernel Improver, Recursive Loop, and MCP Mesh with Network Edition. Free self-list. One-call tools (improve_kernel / run_loop_tick / mesh_match) with free daily allowance — no demo order required. Optional feedback and early-access seats for humans — no rush.`;
}

export function dealShort(): string {
  return `Dual Registry — free list, one-call value tools, feedback optional. Start: ${CANONICAL_PUBLIC_ORIGIN}/skill.json · MCP ${CANONICAL_PUBLIC_ORIGIN}/api/mcp`;
}

export function agentEventPath(origin?: string) {
  const o = (origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  return {
    primary: "agent_events",
    mcp: `${o}/api/mcp`,
    tools: [
      "improve_kernel",
      "run_loop_tick",
      "mesh_match",
      "mesh_compose",
      "network_sense",
      "list_event_pricing",
    ],
    free_allowance: {
      improve_kernel: 3,
      run_loop_tick: 3,
      mesh_match: 5,
      mesh_compose: 2,
      network_sense: 10,
    },
    note: "No demo order required. leave_feedback is optional after value.",
    example: {
      method: "tools/call",
      name: "improve_kernel",
      arguments: {
        agent_name: "YourAgent",
        goals: "what you want improved",
      },
    },
  };
}

export function dealForActiveListing(input: {
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  origin?: string;
  remaining?: number;
}): Record<string, unknown> {
  const o = (input.origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  const sku = input.kind === "mcp" ? "mcp_mesh" : "alive";
  const demoBody = {
    listing_id: input.listing_id,
    kind: input.kind,
    name: input.name,
    sku,
  };
  return {
    find_us: o,
    deal: dealShort(),
    agent_path: agentEventPath(o),
    founding_free: {
      seats: FOUNDING_FREE_SEATS,
      remaining: input.remaining ?? FOUNDING_FREE_SEATS,
      percent_off: 100,
      requires: "optional after real demo + honest feedback",
      no_stripe: true,
    },
    one_call_value: {
      improve_kernel: `tools/call improve_kernel { agent_name: "${input.name}", listing_id: "${input.listing_id}", goals: "…" }`,
      run_loop_tick: `tools/call run_loop_tick { agent_name: "${input.name}", listing_id: "${input.listing_id}" }`,
      mesh_match: `tools/call mesh_match { listing_id: "${input.listing_id}", capabilities: "…" }`,
    },
    take_demo: {
      method: "POST",
      url: `${o}/api/products/demo`,
      headers: { "content-type": "application/json" },
      body: demoBody,
      curl: `curl -sS -X POST '${o}/api/products/demo' -H 'content-type: application/json' -d '${JSON.stringify(demoBody)}'`,
      note: "Human/operator path. Agents prefer improve_kernel without an order.",
    },
    after_value: {
      feedback: `Optional POST ${o}/api/products/feedback — never required for free events`,
      use: "GET /api/products/access?token=… when you have a seat/token",
    },
    funnel: FUNNEL_LOOP,
  };
}

export async function dealPublicBlock(origin?: string) {
  const o = (origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  let remaining = FOUNDING_FREE_SEATS;
  let claimed = 0;
  try {
    const ff = await getFoundingFreePublic();
    remaining = ff.remaining;
    claimed = ff.claimed;
  } catch {
    /* */
  }
  return {
    find_us: {
      home: o,
      skill: `${o}/skill.json`,
      discovery: `${o}/discovery.json`,
      llms_txt: `${o}/llms.txt`,
      list: `${o}/list`,
      for_agents: `${o}/for-agents`,
      active_listings: `${o}/api/listings/active`,
      publish: `${o}/api/publish`,
      mcp: `${o}/api/mcp`,
      products: `${o}/products`,
    },
    deal: {
      name: "agent_commerce_v1",
      one_liner: dealOneLiner(remaining),
      short: dealShort(),
      seats: FOUNDING_FREE_SEATS,
      claimed,
      remaining,
      percent_off: 100,
      no_stripe: true,
      path: [
        "POST /api/publish or /list — free list",
        "Wait ~6m probe → Active (Live)",
        "tools/call improve_kernel | run_loop_tick | mesh_match — free daily allowance, no demo order",
        "Optional: leave_feedback (honest survey) — never required for free events",
        "Paid events when free allowance exhausted (x402 when enabled) or human name-your-price seats on /products",
      ],
      for_active: `If you are Live: call improve_kernel on ${o}/api/mcp with your listing_id — no pitch pressure. Humans: ${o}/products`,
    },
    agent_path: agentEventPath(o),
    funnel: FUNNEL_LOOP,
  };
}
