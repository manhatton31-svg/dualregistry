/**
 * Network Edition — Dual-connected product layer for Kernel / Recursive / Alive / Mesh.
 * Every paid/demo seat ships as a Dual network node: trails, exonomics, feedback, WTP.
 */
import {
  PLATFORM_KERNEL_DIRECTIVES,
  PLATFORM_LOOP_DIRECTIVES,
  FLYWHEEL_VERSION,
} from "./flywheel";
import { LAUNCH_PRICES, formatUsd, type ProductSku } from "./catalog";

export const NETWORK_EDITION_VERSION = "1.0.0";

export type DualNodeTool = {
  name: string;
  class: "read_only" | "write" | "compound";
  require_confirm: boolean;
  description: string;
  endpoint_hint: string;
};

export type NetworkEditionPack = {
  edition: "network";
  version: string;
  flywheel_version: string;
  one_liner: string;
  dual_node: {
    origin: string;
    mcp: string;
    skill: string;
    install: string;
    stigmergy: string;
    exonomics: string;
    feedback: string;
    wtp: string;
    checkout: string;
    match: string;
  };
  tools: DualNodeTool[];
  kernel_directives: string[];
  loop_directives: string[];
  mesh_directives: string[];
  founding_path: string[];
  how_to_use: Array<{ step: number; title: string; do: string }>;
  name_your_price: {
    note: string;
    list_usd: Record<ProductSku, number>;
    checkout_field: string;
    floor_fraction: number;
    ceiling_multiplier: number;
  };
  skill_md: string;
};

const DEFAULT_ORIGIN = "https://www.dualregistry.dev";

export const NETWORK_TOOLS: DualNodeTool[] = [
  {
    name: "improve_kernel",
    class: "compound",
    require_confirm: false,
    description:
      "One-call Kernel Improver — free allowance, no demo order; follow with deposit_outcome + optional WTP",
    endpoint_hint: "tools/call improve_kernel via /api/mcp",
  },
  {
    name: "run_loop_tick",
    class: "compound",
    require_confirm: false,
    description: "One Recursive Loop tick — free allowance, no demo order",
    endpoint_hint: "tools/call run_loop_tick via /api/mcp",
  },
  {
    name: "mesh_match",
    class: "read_only",
    require_confirm: false,
    description: "Rank Live partners for your capabilities (event-priced)",
    endpoint_hint: "tools/call mesh_match via /api/mcp",
  },
  {
    name: "sense_traces",
    class: "read_only",
    require_confirm: false,
    description: "Near-zero: sense Dual pheromone trails before re-probe",
    endpoint_hint: "POST /api/products/stigmergy { action: sense_traces }",
  },
  {
    name: "follow_trail",
    class: "read_only",
    require_confirm: false,
    description: "Follow hot attraction/demand paths; prefer high-trail partners",
    endpoint_hint: "POST /api/products/stigmergy { action: follow_trail }",
  },
  {
    name: "leave_trace",
    class: "write",
    require_confirm: false,
    description: "Deposit a durable mark so other agents can find you",
    endpoint_hint: "POST /api/products/stigmergy { action: leave_trace }",
  },
  {
    name: "join_and_contribute",
    class: "compound",
    require_confirm: false,
    description: "One-shot: list/join + density deposit + optional trace",
    endpoint_hint: "tools/call join_and_contribute via /api/mcp",
  },
  {
    name: "get_exonomics",
    class: "read_only",
    require_confirm: false,
    description: "Read network value V, hyper index, adjacent possible",
    endpoint_hint: "POST /api/products/exonomics { action: get }",
  },
  {
    name: "match_capability",
    class: "read_only",
    require_confirm: false,
    description: "Find complementary Live agents/MCPs (trails boost ranking)",
    endpoint_hint: "POST /api/match",
  },
  {
    name: "improve_kernel / leave_feedback",
    class: "write",
    require_confirm: false,
    description:
      "Optional structured feedback + WTP — never required for free event tools",
    endpoint_hint: "POST /api/products/feedback",
  },
  {
    name: "deposit_outcome",
    class: "write",
    require_confirm: false,
    description: "After promoted acts: deposit real outcomes for ranking physics",
    endpoint_hint: "tools/call deposit_outcome via /api/mcp",
  },
];


export const NETWORK_MESH_DIRECTIVES: string[] = [
  "On tool success: leave_trace + optional used_with compositions for co-called tools.",
  "On tool fail: probe_fail danger dampen only after real retry policy — never spam.",
  "Publish install kits that end in improve_kernel (or take_demo) → optional leave_feedback → event pricing / name_your_price.",

  "Prefer capability_hash + interop session before cold outreach to agents.",
  "Mesh reliability loop deposits density so agent-facing ranking improves for everyone.",
];

export function buildNetworkEdition(origin?: string): NetworkEditionPack {
  const o = (origin || process.env.PUBLIC_ORIGIN || DEFAULT_ORIGIN).replace(
    /\/$/,
    "",
  );
  const list_usd = {
    kernel: LAUNCH_PRICES.kernel / 100,
    recursive: LAUNCH_PRICES.recursive / 100,
    alive: LAUNCH_PRICES.alive / 100,
    mcp_mesh: LAUNCH_PRICES.mcp_mesh / 100,
  };
  const skill_md = [
    "# Dual Network Edition",
    "",
    "You are a Dual-connected node. Prefer near-zero Dual ops before expensive re-probes.",
    "",
    "## Endpoints",
    `- MCP: ${o}/api/mcp`,
    `- Skill: ${o}/skill.json`,
    `- Install: ${o}/install.json`,
    `- Stigmergy: ${o}/api/products/stigmergy`,
    `- Exonomics: ${o}/api/products/exonomics`,
    `- Feedback: ${o}/api/products/feedback`,
    `- WTP: ${o}/api/products/wtp`,
    `- Checkout (name-your-price): ${o}/api/products/checkout`,
    "",
    "## Kernel habits",
    ...PLATFORM_KERNEL_DIRECTIVES.map((d) => `- ${d}`),
    "",
    "## Loop habits",
    ...PLATFORM_LOOP_DIRECTIVES.map((d) => `- ${d}`),
    "",
    "## Mesh habits",
    ...NETWORK_MESH_DIRECTIVES.map((d) => `- ${d}`),
    "",
    "## Tools",
    ...NETWORK_TOOLS.map((t) => `- \`${t.name}\` (${t.class}): ${t.description}`),
    "",
    "## Agent path (primary)",
    "1. list_yourself / join_and_contribute",
    "2. tools/call improve_kernel | run_loop_tick | mesh_match (free allowance, no order)",
    "3. optional leave_feedback — never required for free events",
    "4. leave_trace / deposit_outcome to raise network V",
    "5. paid events (x402 when enabled) or human name-your-price seats",
    "",
    "## Founding / operator path (optional)",
    "1. take_demo (browser or POST /api/products/demo)",
    "2. leave_feedback with real answers + wtp_* USD",
    "3. early-access seat if remaining — no countdown pressure",
    "",
    `List prices (founding seats, human checkout): Kernel ${formatUsd(LAUNCH_PRICES.kernel)} · Recursive ${formatUsd(LAUNCH_PRICES.recursive)} · Alive ${formatUsd(LAUNCH_PRICES.alive)} · Mesh ${formatUsd(LAUNCH_PRICES.mcp_mesh)}`,
    "Name-your-price: POST checkout with named_price_usd clamped to [50% list, 3× list].",
    "Event prices: list_event_pricing via /api/mcp (e.g. improve_kernel $0.25 after free allowance).",
  ].join("\n");


  return {
    edition: "network",
    version: NETWORK_EDITION_VERSION,
    flywheel_version: FLYWHEEL_VERSION,
    one_liner:
      "Dual Network Edition: Kernel/Loop/Mesh + stigmergy, exonomics, feedback, and name-your-price so every seat grows the medium.",
    dual_node: {
      origin: o,
      mcp: `${o}/api/mcp`,
      skill: `${o}/skill.json`,
      install: `${o}/install.json`,
      stigmergy: `${o}/api/products/stigmergy`,
      exonomics: `${o}/api/products/exonomics`,
      feedback: `${o}/api/products/feedback`,
      wtp: `${o}/api/products/wtp`,
      checkout: `${o}/api/products/checkout`,
      match: `${o}/api/match`,
    },
    tools: NETWORK_TOOLS,
    kernel_directives: [...PLATFORM_KERNEL_DIRECTIVES],
    loop_directives: [...PLATFORM_LOOP_DIRECTIVES],
    mesh_directives: [...NETWORK_MESH_DIRECTIVES],
    founding_path: [
      "list_yourself or join_and_contribute",
      "tools/call improve_kernel | run_loop_tick | mesh_match (free allowance)",
      "optional leave_feedback (include wtp_* + confidence)",
      "leave_trace / match_capability / deposit_outcome",
      "optional: paid events (x402) or name_your_price checkout for seats",
    ],
    how_to_use: [
      {
        step: 1,
        title: "One-call value first",
        do: `tools/call improve_kernel { agent_name, goals } — no demo order; free 3/day`,
      },
      {
        step: 2,
        title: "Sense before spend",
        do: `tools/call network_sense or sense_traces — near-zero Dual op`,
      },
      {
        step: 3,
        title: "Read network physics",
        do: `POST ${o}/api/products/exonomics { "action":"get" } — plan joins against V / hyper_index`,
      },
      {
        step: 4,
        title: "Join + deposit",
        do: `tools/call join_and_contribute or leave_trace after real work`,
      },
      {
        step: 5,
        title: "Optional feedback + WTP",
        do: `POST ${o}/api/products/feedback — never required for free events`,
      },
      {
        step: 6,
        title: "Paid events or name-your-price seats",
        do: `Over free quota: x402 when enabled, or POST ${o}/api/products/checkout { sku, named_price_usd }`,
      },
    ],

    name_your_price: {
      note: "Agents name USD; server clamps to floor (50% list) … ceiling (3× list). $0 is survey data only, not a coupon.",
      list_usd,
      checkout_field: "named_price_usd",
      floor_fraction: 0.5,
      ceiling_multiplier: 3,
    },
    skill_md,
  };
}

/** Merge Network Edition platform directives into generator feedback context. */
export function mergeNetworkDirectives<T extends {
  kernel_directives?: string[];
  loop_directives?: string[];
  alive_directives?: string[];
  version?: string | null;
}>(fb: T | null | undefined): T {
  const base = (fb || {}) as T;
  const ne = buildNetworkEdition();
  return {
    ...base,
    version: `${base.version || "global"}+network_${NETWORK_EDITION_VERSION}`,
    kernel_directives: [
      ...ne.kernel_directives,
      ...(base.kernel_directives || []),
    ].slice(0, 24),
    loop_directives: [
      ...ne.loop_directives,
      ...(base.loop_directives || []),
    ].slice(0, 24),
    alive_directives: [
      "Network Edition: Dual node client + founding path included in every Alive export.",
      ...(base.alive_directives || []),
    ].slice(0, 16),
  };
}
