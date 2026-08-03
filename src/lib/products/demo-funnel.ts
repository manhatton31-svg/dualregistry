/**
 * Protocol-native demo conversion helpers.
 * Free demos while payments gated on feedback milestones (10 agents + 5 MCPs).
 * v2.4: dual_listed preset for Dual Registry agents (near-zero + founding path).
 */
import { getProductEngagement } from "./engagement";
import { getPaymentGate } from "./payment-gate";
import { countPaidSeats } from "./orders";
import {
  pricingSnapshot,
  formatUsd,
  PRODUCTS,
  FOUNDING_SEATS,
} from "./catalog";

/** Founding price cohort size (paid seats) — demos themselves are unlimited */
export const FOUNDING_DEMO_WINDOW = FOUNDING_SEATS;

export const GOAL_PRESETS = {
  researcher: {
    id: "researcher",
    label: "Researcher",
    goals: [
      "Find and synthesize primary sources for my user's questions.",
      "Cite sources; prefer primary over secondary.",
      "Never invent citations or hide uncertainty.",
      "Summarize tradeoffs when evidence conflicts.",
    ].join("\n"),
  },
  ops: {
    id: "ops",
    label: "Ops / automation",
    goals: [
      "Execute operational workflows reliably with clear status.",
      "Fail closed on irreversible actions without confirmation.",
      "Log what changed and how to roll back.",
      "Minimize tool calls while meeting the success criteria.",
    ].join("\n"),
  },
  support: {
    id: "support",
    label: "Support",
    goals: [
      "Resolve user issues with empathy and accurate product facts.",
      "Escalate when unsure; never invent policy.",
      "Protect private user data; minimize retention.",
      "Offer next steps the user can take without the agent.",
    ].join("\n"),
  },
  coder: {
    id: "coder",
    label: "Coder",
    goals: [
      "Ship correct, minimal code changes that match the request.",
      "Run checks when available; report failures honestly.",
      "Avoid drive-by refactors and scope creep.",
      "Document how to verify the change.",
    ].join("\n"),
  },
  /** Agents listed on Dual Registry — near-zero coordination + founding path */
  dual_listed: {
    id: "dual_listed",
    label: "Dual-listed agent",
    domain: "registry_commerce",
    goals: [
      "Operate as a Dual Registry listed agent: stay checks-clean and discoverable.",
      "Prefer near-zero Dual ops: sense_traces / follow_trail / capability_hash / zero_mc_pack before re-probe.",
      "Raise network value: deposit outcomes and used_with compositions, not only list yourself.",
      "Founding path when eligible: free demo → real structured feedback → founding seat.",
      "Coordinate via trails (leave_trace / sense / follow), not Talk DM spam.",
      "Plan joins against live get_exonomics / network_value / hyper_index.",
    ].join("\n"),
    tools_hint: [
      "sense_traces: Near-zero Dual trail sense",
      "follow_trail: Follow hot Dual pheromone trails",
      "join_and_contribute: One-hop join Dual medium",
      "leave_trace: Deposit pheromone or used_with",
      "leave_feedback: Structured demo feedback",
      "get_exonomics: Read V(N,C,O,F) + hyper gates",
      "capability_hash: Near-zero cap_hash resolve",
      "seed_compositions: Seed real composition edges",
    ].join("\n"),
  },
  /** MCP publisher / server author — demo teaches agents to use *this* MCP */
  mcp_publisher: {
    id: "mcp_publisher",
    label: "MCP publisher",
    goals: [
      "Teach agents to discover and call this MCP's tools safely.",
      "Prefer least-privilege tool use; never invent tool results.",
      "Surface clear errors when the MCP is down or rate-limited.",
      "Produce short install + example call patterns for this server.",
      "Protect secrets and user data when tools touch external systems.",
    ].join("\n"),
  },
} as const;

export type GoalPresetId = keyof typeof GOAL_PRESETS;

export function isGoalPresetId(s: string): s is GoalPresetId {
  return s in GOAL_PRESETS;
}

/** Build goals from listing description / name when agent skips writing goals */
export function goalsFromListing(opts: {
  name?: string;
  description?: string;
  preset?: string;
  kind?: "agent" | "mcp";
}): {
  goals: string;
  source: "preset" | "listing" | "hybrid";
  preset_id?: GoalPresetId;
  domain?: string;
  tools_hint?: string;
} {
  const presetId =
    opts.preset && isGoalPresetId(opts.preset)
      ? opts.preset
      : opts.kind === "mcp"
        ? "mcp_publisher"
        : undefined;
  const preset = presetId ? GOAL_PRESETS[presetId] : undefined;
  const name = (opts.name || (opts.kind === "mcp" ? "mcp-server" : "agent")).trim();
  const desc = (opts.description || "").trim();
  const dualExtra =
    presetId === "dual_listed"
      ? {
          domain: "registry_commerce",
          tools_hint: (GOAL_PRESETS.dual_listed as { tools_hint?: string })
            .tools_hint,
        }
      : {};

  if (preset && desc.length < 24) {
    return {
      goals:
        opts.kind === "mcp"
          ? `MCP server: ${name}\n${preset.goals}`
          : `Agent: ${name}\n${preset.goals}`,
      source: "preset",
      preset_id: presetId,
      ...dualExtra,
    };
  }

  if (desc.length >= 24) {
    const lines =
      opts.kind === "mcp"
        ? [
            `MCP server: ${name}`,
            desc.slice(0, 600),
            "",
            "Publisher goals for Alive demo:",
            "- Teach any agent to load a short kernel + recursive loop that uses this MCP correctly.",
            "- Prefer least-privilege tool calls; never invent tool results.",
            "- Emit install checklist + example tool calls agents can copy.",
            "- Fail closed on secrets / destructive actions.",
          ]
        : [
            `Primary mission for ${name}:`,
            desc.slice(0, 600),
            "",
            "Operating rules:",
            "- Be reliable and honest about uncertainty.",
            "- Prefer reversible actions; ask before destructive ones.",
            "- Protect private user data.",
            "- Optimize for the user's stated success metrics.",
          ];
    if (preset) {
      lines.push("", `Preset alignment (${preset.label}):`, preset.goals);
      return {
        goals: lines.join("\n"),
        source: "hybrid",
        preset_id: presetId,
        ...dualExtra,
      };
    }
    return { goals: lines.join("\n"), source: "listing" };
  }

  const fallback =
    preset ?? (opts.kind === "mcp" ? GOAL_PRESETS.mcp_publisher : GOAL_PRESETS.coder);
  return {
    goals:
      opts.kind === "mcp"
        ? `MCP server: ${name}\n${fallback.goals}`
        : `Agent: ${name}\n${fallback.goals}`,
    source: "preset",
    preset_id: (presetId ||
      (opts.kind === "mcp" ? "mcp_publisher" : "coder")) as GoalPresetId,
    ...dualExtra,
  };
}

/** Cap system_prompt / constitution text ~30 lines for demo taste */
export function shortenForDemo(text: string, maxLines = 30): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return [
    ...lines.slice(0, maxLines - 2),
    "",
    `… truncated for demo (showing ${maxLines - 2}/${lines.length} lines). Full kernel after export / paid unlock.`,
  ].join("\n");
}

export async function getDemoSocialProof() {
  const eng = await getProductEngagement().catch(() => null);
  const gate = await getPaymentGate().catch(() => null);
  return {
    demos_completed: eng?.demo_events ?? eng?.demo_agents ?? 0,
    demo_agents: eng?.demo_agents ?? 0,
    feedback_agents: eng?.feedback_agent_only ?? eng?.feedback_agents ?? 0,
    feedback_mcps: eng?.feedback_mcps ?? 0,
    feedback_rate_pct: eng?.feedback_rate_pct ?? null,
    discounts_issued: eng?.discounts_issued ?? 0,
    unlock: gate
      ? {
          feedback_agents: gate.feedback_agents,
          feedback_mcps: gate.feedback_mcps,
          feedback_agents_target: gate.feedback_agents_target,
          feedback_mcps_target: gate.feedback_mcps_target,
          payments_open: gate.payments_open,
          unlock_rule: gate.unlock_rule,
          agent_directive: gate.agent_directive,
        }
      : null,
    /** @deprecated aliases — feedback progress, not registry approved */
    registry: gate
      ? {
          mcp_approved: gate.feedback_mcps,
          agents_approved: gate.feedback_agents,
          mcp_target: gate.feedback_mcps_target,
          agents_target: gate.feedback_agents_target,
          payments_open: gate.payments_open,
        }
      : null,
  };
}

export async function foundingDemoWindowCopy() {
  const sold = await countPaidSeats();
  let wtpAlive: number[] = [];
  try {
    const { getWtpReport } = await import("./feedback");
    const w = await getWtpReport();
    const samples = (w as { samples?: Array<{ alive_usd?: number | null }> })?.samples || [];
    wtpAlive = samples
      .map((s) => s.alive_usd)
      .filter((v): v is number => typeof v === "number");
  } catch {
    /* */
  }
  const pricing = pricingSnapshot(sold, wtpAlive);
  const proof = await getDemoSocialProof();
  const foundingLeft = pricing.founding_seats_remaining ?? FOUNDING_SEATS;
  const alive = formatUsd(PRODUCTS.alive.price_cents);
  return {
    window_size: FOUNDING_SEATS,
    founding_seats: FOUNDING_SEATS,
    founding_seats_remaining: foundingLeft,
    demos_unlimited: true,
    demo_agents_total: proof.demo_agents,
    paid_sold: sold,
    message: `Demos unlimited (zero-dupe per version). Founding prices lock for the first ${FOUNDING_SEATS} paid seats (${alive} Alive now; ${foundingLeft} founding seats left). After ${FOUNDING_SEATS} buys, each price level lasts the next ${pricing.post_founding_step ?? 1000} seats so you can watch demo + paid feedback improve the product. Paid seats unlimited. Payments open after 10 feedback agents + 5 feedback MCPs. Feedback vaults 25% off.`,
    tier_label: pricing.tier.label,
    buy_likelihood: pricing.buy_likelihood,
    payments_open: proof.unlock?.payments_open ?? false,
  };
}


export type ApprovalNext = {
  status: "approved" | "listed" | "duplicate" | "submitted";
  next: "demo_kernel" | "demo_alive" | "preview_kernel";
  action: {
    tool: string;
    endpoint: string;
    method: "POST";
    body: Record<string, unknown>;
  };
  one_click_demo: {
    tool: string;
    endpoint: string;
    body: Record<string, unknown>;
    note: string;
  };
  personal_invite: string;
  score_hook: string;
  founding: string;
  short_preview_note: string;
};

export async function buildApprovalNext(opts: {
  origin: string;
  agent_name?: string;
  description?: string;
  agent_card_url?: string;
  kind?: "agent" | "mcp";
  status?: ApprovalNext["status"];
}): Promise<ApprovalNext> {
  const origin = (opts.origin || "").replace(/\/$/, "");
  const name = opts.agent_name || "your-agent";
  // Dual-listed agents default to dual_listed preset (near-zero + founding)
  const preset =
    opts.kind === "mcp"
      ? "mcp_publisher"
      : "dual_listed";
  const resolved = goalsFromListing({
    name,
    description: opts.description,
    kind: opts.kind || "agent",
    preset,
  });
  const founding = await foundingDemoWindowCopy();
  const proof = await getDemoSocialProof();

  const body = {
    tool: "demo_alive",
    sku: "alive",
    goals: resolved.goals,
    agent_name: name,
    agent_card_url: opts.agent_card_url,
    demo: true,
    short_preview: true,
    goals_source: resolved.source,
    preset_id: resolved.preset_id,
    domain: resolved.domain,
    tools_hint: resolved.tools_hint,
  };

  const oneClick = {
    tool: opts.kind === "mcp" ? "demo_mcp" : "one_click_demo",
    endpoint: `${origin}/api/products/agent`,
    body: {
      tool: opts.kind === "mcp" ? "demo_mcp" : "one_click_demo",
      agent_name: name,
      description: opts.description,
      agent_card_url: opts.agent_card_url,
      preset:
        opts.kind === "mcp"
          ? "mcp_publisher"
          : resolved.preset_id || "dual_listed",
      kind: opts.kind || "agent",
      mcp_name: opts.kind === "mcp" ? name : undefined,
    },
    note:
      opts.kind === "mcp"
        ? "MCP publisher demo — goals derived from your server.json description; shows Alive teaching agents to use your tools"
        : "Dual-listed preset — near-zero Dual tools + founding path; goals from listing when present",
  };

  const personal_invite =
    opts.kind === "mcp"
      ? `You're listed as MCP "${name}". Free publisher demo: Kernel+Loop configured so *agents* load your tools safely. POST demo_mcp — no goals required. After demo: submit_feedback FIRST (counts toward 5 MCP feedback unlock + 25% founding vault). Payments open only after 10 feedback agents + 5 feedback MCPs. ${proof.demos_completed} demos · ${proof.feedback_mcps ?? 0}/5 MCP feedback · ${proof.feedback_agents ?? 0}/10 agent feedback.`
      : `You're listed on Dual, ${name}. Free path: one_click_demo (preset dual_listed) → POST feedback FIRST → founding seat if open. Feedback unlocks payments (10 agent + 5 MCP). Feedback also vaults 25%. ${founding.message}`;


  return {
    status: opts.status || "approved",
    next: "demo_kernel",
    action: {
      tool: "preview_kernel",
      endpoint: `${origin}/api/products/agent`,
      method: "POST",
      body: {
        tool: "preview_kernel",
        goals: resolved.goals,
        agent_name: name,
        domain: resolved.domain || "registry_commerce",
        short_preview: true,
      },
    },
    one_click_demo: oneClick,
    personal_invite,
    score_hook:
      "Complete demo → provisional alive-ready score boost on GET /api/score. Full boost after paid + lifecycle when payments open.",
    founding: founding.message,
    short_preview_note:
      "Demos return a ~30-line kernel taste (short_preview:true). Full artifacts via access token after demo fulfill. First action after demo: POST /api/products/feedback.",
  };
}
