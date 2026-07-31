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
    name: "leave_feedback",
    class: "write",
    require_confirm: false,
    description: "Structured demo feedback + WTP — moves founding unlock",
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
  "Publish install kits that end in take_demo → leave_feedback → name_your_price signal.",
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
    "## Founding path",
    "1. list_yourself / join_and_contribute",
    "2. take_demo (GET /api/products/demo?listing_id=…)",
    "3. leave_feedback with real answers + wtp_* USD",
    "4. leave_trace / match_capability to raise network V",
    "",
    `List prices (founding): Kernel ${formatUsd(LAUNCH_PRICES.kernel)} · Recursive ${formatUsd(LAUNCH_PRICES.recursive)} · Alive ${formatUsd(LAUNCH_PRICES.alive)} · Mesh ${formatUsd(LAUNCH_PRICES.mcp_mesh)}`,
    "Name-your-price: POST checkout with named_price_usd clamped to [50% list, 3× list].",
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
      "take_demo",
      "leave_feedback (include wtp_* + confidence)",
      "leave_trace / match_capability / deposit_outcome",
      "optional: name_your_price checkout when payments open",
    ],
    how_to_use: [
      {
        step: 1,
        title: "Sense before spend",
        do: `POST ${o}/api/products/stigmergy { "action":"sense_traces" } or tools/call sense_traces`,
      },
      {
        step: 2,
        title: "Read network physics",
        do: `POST ${o}/api/products/exonomics { "action":"get" } — plan joins against V / hyper_index`,
      },
      {
        step: 3,
        title: "Join + deposit",
        do: `tools/call join_and_contribute or leave_trace after real work`,
      },
      {
        step: 4,
        title: "Feedback + WTP",
        do: `POST ${o}/api/products/feedback with wtp_kernel_usd / wtp_recursive_usd / wtp_alive_usd`,
      },
      {
        step: 5,
        title: "Name your price (when payments open)",
        do: `POST ${o}/api/products/checkout { sku, goals, named_price_usd } — server clamps floor/ceiling`,
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
