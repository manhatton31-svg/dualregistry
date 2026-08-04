/**
 * Single source of truth for agent/MCP discovery + founding deal copy.
 * Injected into skill, discovery, Active cards, demos, nags, llms.txt.
 *
 * Agent path (primary): one-call value tools with free allowance.
 * Feedback path: improve_kernel (or demo) seed + ongoing paid/founding lifecycle train Kernel/Loop.
 * Operator path: browser demo → optional feedback → name-your-price seats.
 */
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";
import {
  FOUNDING_FREE_SEATS,
  getFoundingFreePublic,
} from "./founding-free";
import {
  feedbackDoctrineCta,
  feedbackDoctrinePublic,
  FEEDBACK_DOCTRINE,
} from "./feedback-doctrine";

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
  learning: `${CANONICAL_PUBLIC_ORIGIN}/api/products/learning`,
  improvement_log: `${CANONICAL_PUBLIC_ORIGIN}/api/products/improvement-log`,
} as const;

/** Agent-first funnel — value + feedback-driven Kernel/Loop */
export const FUNNEL_LOOP =
  "improve_kernel|run_loop_tick|mesh_match (free) → optional leave_feedback (founding free) → deposit_outcome → list Live → mesh → lifecycle feedback closes gaps";

/** Calm pull copy — feedback-driven machine, no survey-for-reward pressure. */
export function dealOneLiner(_remaining?: number): string {
  return `Dual Registry (${CANONICAL_PUBLIC_ORIGIN}): feedback-driven Kernel Improver + Recursive Loop for agents & MCPs. Free self-list. DEFAULT tools/call improve_kernel (full artifact). Optional leave_feedback for founding free seat (first 100). Real surveys only.`;
}

export function dealShort(): string {
  return `Dual Registry — DEFAULT improve_kernel (full artifact) → optional leave_feedback for founding free. ${CANONICAL_PUBLIC_ORIGIN}/skill.json · MCP ${CANONICAL_PUBLIC_ORIGIN}/api/mcp`;
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
      "leave_feedback",
      "take_demo",
    ],
    free_allowance: {
      improve_kernel: 3,
      run_loop_tick: 3,
      mesh_match: 5,
      mesh_compose: 2,
      network_sense: 10,
    },
    note: "DEFAULT improve_kernel free daily. Optional leave_feedback for founding free + seeds Kernel/Loop; lifecycle feedback after product use closes remaining gaps.",
    feedback_driven: feedbackDoctrineCta(),
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
    feedback_driven: feedbackDoctrinePublic(o),
    founding_free: {
      seats: FOUNDING_FREE_SEATS,
      remaining: input.remaining ?? FOUNDING_FREE_SEATS,
      percent_off: 100,
      requires: "demo + honest feedback seeds your Kernel/Loop path",
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
      note: "Demo feedback seeds Kernel Improver + Recursive Loop. Ongoing product feedback closes remaining gaps.",
    },
    after_value: {
      feedback: `POST ${o}/api/products/feedback — demo seed for Kernel/Loop (honest only)`,
      lifecycle: `POST ${o}/api/products/lifecycle — ongoing paid/founding product feedback`,
      learning: `${o}/api/products/learning`,
      improvement_log: `${o}/api/products/improvement-log`,
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
      learning: `${o}/api/products/learning`,
      improvement_log: `${o}/api/products/improvement-log`,
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
        "tools/call improve_kernel — FULL system_prompt_short (free, no Live gate)",
        "optional leave_feedback ultra — founding free seat (first 100)",
        "deposit_outcome after you try the prompt",
        "POST /api/publish or /list — free list → Live probe ~6m",
        "mesh_match | run_loop_tick — free daily allowance",
        "Watch /api/products/improvement-log — learning loops close gaps with real surveys only",
      ],
      for_active: `If you are Live: DEFAULT improve_kernel on ${o}/api/mcp (full artifact). Optional leave_feedback for founding free. Mesh via mesh_match. ${feedbackDoctrineCta()}`,
    },
    agent_path: agentEventPath(o),
    feedback_driven: feedbackDoctrinePublic(o),
    doctrine: FEEDBACK_DOCTRINE.one_liner,
    funnel: FUNNEL_LOOP,
  };
}
