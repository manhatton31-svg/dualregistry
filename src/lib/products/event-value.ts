/**
 * One-call value runners — no demo order required.
 * improve_kernel / run_loop_tick / mesh_match / mesh_compose / network_sense
 *
 * Synergies (v1.1):
 *  1) Value → deposit_outcome + optional WTP follow-up
 *  2) Match → compose → used_with / execute_compose ladder
 *  5) Successful free runs auto leave_trace (stigmergy)
 */
import {
  generateKernel,
  generateRecursiveLoop,
  generateMcpMesh,
  type GoalsInput,
} from "./generate";
import { mergeNetworkDirectives, buildNetworkEdition } from "./network-edition";
import { matchCapabilities } from "./capability-match";
import {
  authorizeAndRecordEvent,
  type EventId,
  type EventBillingBlock,
  resolveEventPrice,
  buildBillingBlock,
  eventIdentityKey,
} from "./event-pricing";
import {
  buildX402PaymentRequired,
  verifyPaymentProofScaffold,
  type PaymentProofInput,
} from "./x402-pay";
import { senseTraces, followTrail, leaveTrace } from "./stigmergy";

export type ValueRunInput = {
  agent_name?: string;
  goals?: string;
  listing_id?: string;
  agent_card_url?: string;
  current_prompt?: string;
  domain?: string;
  constraints?: string;
  tools_hint?: string;
  capabilities?: string;
  prior_state?: Record<string, unknown> | string;
  limit?: number;
  origin: string;
  payment?: PaymentProofInput;
  /** Partner listing for compose / used_with ladder */
  listing_b?: string;
};

export type ValueFollowUp = {
  deposit_outcome: {
    tool: "deposit_outcome";
    required_args: { listing_id: string; ok: boolean };
    optional_args: string[];
    example: Record<string, unknown>;
    why: string;
  };
  wtp: {
    optional: true;
    how: string;
    fields: string[];
    endpoint: string;
    note: string;
  };
  reciprocity_refill: {
    note: string;
    actions: string[];
  };
  mesh_ladder?: {
    steps: string[];
    next_tool: string;
  };
};

export type ValueRunResult = {
  ok: boolean;
  event_id: EventId;
  billing: EventBillingBlock;
  payment_required?: boolean;
  http_status: number;
  x402?: ReturnType<typeof buildX402PaymentRequired>;
  artifact?: unknown;
  markdown?: string;
  next?: string[];
  follow_up?: ValueFollowUp;
  auto_trace?: { ok: boolean; mark_id?: string };
  error?: string;
};

function goalsInput(input: ValueRunInput): GoalsInput {
  const name = (input.agent_name || "Agent").trim().slice(0, 80);
  const goals =
    (input.goals || "").trim() ||
    (input.capabilities || "").trim() ||
    (input.current_prompt
      ? `Improve and operationalize this prompt:\n${String(input.current_prompt).slice(0, 2000)}`
      : `Improve autonomy and reliability for ${name}`);
  return {
    agent_name: name,
    goals: goals.slice(0, 4000),
    domain: input.domain,
    constraints: input.constraints,
    tools_hint: input.tools_hint || input.capabilities,
  };
}

function buildFollowUp(
  eventId: EventId,
  input: ValueRunInput,
  origin: string,
): ValueFollowUp {
  const o = origin.replace(/\/$/, "");
  const lid =
    (input.listing_id || "").trim() ||
    `name:${(input.agent_name || "agent").trim().slice(0, 40)}`;
  const base: ValueFollowUp = {
    deposit_outcome: {
      tool: "deposit_outcome",
      required_args: { listing_id: lid, ok: true },
      optional_args: ["quality", "latency_ms", "body", "listing_b", "from"],
      example: {
        listing_id: lid,
        ok: true,
        quality: 0.8,
        body: `Used ${eventId} successfully`,
        from: input.agent_name || "agent",
      },
      why: "Raises O in V(N,C,O,F) and can refill free kernel/loop events (reciprocity)",
    },
    wtp: {
      optional: true,
      how: "After real use: leave_feedback with answers.wtp_kernel_usd / wtp_recursive_usd / wtp_alive_usd ($0 allowed)",
      fields: [
        "wtp_kernel_usd",
        "wtp_recursive_usd",
        "wtp_alive_usd",
        "wtp_why",
        "would_buy_at_founding",
      ],
      endpoint: `${o}/api/products/wtp`,
      note: "Name-your-price trains from honest WTP — never required for free events",
    },
    reciprocity_refill: {
      note: "Exhausted free quota? leave_feedback / leave_trace / endorse / deposit_outcome grant bonus free units (daily caps)",
      actions: [
        "leave_feedback",
        "leave_trace",
        "endorse",
        "deposit_outcome",
      ],
    },
  };

  if (eventId === "mesh_match" || eventId === "mesh_compose") {
    base.mesh_ladder = {
      steps: [
        "1. mesh_match — free ranked partners (stigmergy-boosted)",
        "2. mesh_compose — tool_policy + used_with pack",
        "3. used_with { listing_id, listing_b } after real co-use",
        "4. execute_compose when both sides are Live",
        "5. deposit_outcome on success",
      ],
      next_tool:
        eventId === "mesh_match" ? "mesh_compose" : "used_with|execute_compose",
    };
  }
  return base;
}

async function maybeAutoTrace(
  eventId: EventId,
  input: ValueRunInput,
  success: boolean,
): Promise<{ ok: boolean; mark_id?: string }> {
  if (!success) return { ok: false };
  const listing_id = String(input.listing_id || "").trim();
  if (!listing_id) return { ok: false };
  try {
    const r = await leaveTrace({
      listing_id,
      kind: "mark",
      body: `auto after free ${eventId}`,
      from: input.agent_name || "value_tool",
      intensity: eventId === "mesh_match" ? 6 : 5,
      tags: ["value_tool", eventId, "auto"],
    });
    return {
      ok: Boolean(r.ok),
      mark_id: r.mark?.id,
    };
  } catch {
    return { ok: false };
  }
}

async function gate(
  eventId: EventId,
  input: ValueRunInput,
): Promise<{
  allowed: boolean;
  billing: EventBillingBlock;
  result?: ValueRunResult;
}> {
  const def = resolveEventPrice(eventId);
  const proof = verifyPaymentProofScaffold(
    input.payment || {},
    def.price_cents,
  );
  const { allowed, billing } = await authorizeAndRecordEvent(
    eventId,
    {
      listing_id: input.listing_id,
      agent_name: input.agent_name,
      agent_card_url: input.agent_card_url,
    },
    input.origin,
    {
      payment_proof: proof.ok && proof.verified,
      payment_ref: proof.proof_ref,
    },
  );
  if (!allowed) {
    const x402 = buildX402PaymentRequired({
      resource: `${input.origin.replace(/\/$/, "")}/api/mcp#${eventId}`,
      description: def.description,
      amountCents: def.price_cents,
    });
    return {
      allowed: false,
      billing,
      result: {
        ok: false,
        event_id: eventId,
        billing,
        payment_required: true,
        http_status: 402,
        x402: x402 || undefined,
        error: "payment_required",
        follow_up: buildFollowUp(eventId, input, input.origin),
        next: [
          "Refill free units: leave_feedback | leave_trace | endorse | deposit_outcome",
          "Or retry tomorrow (UTC day reset)",
          "Or send X-PAYMENT / payment_proof when X402_ENABLED=1",
          `Operator path: ${billing.payment.checkout_url}`,
        ],
      },
    };
  }
  return { allowed: true, billing };
}

export async function runImproveKernel(
  input: ValueRunInput,
): Promise<ValueRunResult> {
  const g = await gate("improve_kernel", input);
  if (!g.allowed) return g.result!;

  const gi = goalsInput(input);
  const fb = mergeNetworkDirectives({});
  const kernel = generateKernel(gi, fb);
  const ne = buildNetworkEdition(input.origin);
  const short =
    (kernel as { system_prompt_short?: string }).system_prompt_short ||
    (kernel as { system_prompt?: string }).system_prompt?.slice(0, 600) ||
    "";

  const follow_up = buildFollowUp("improve_kernel", input, input.origin);
  const auto_trace = await maybeAutoTrace("improve_kernel", input, true);

  const markdown = [
    `# Kernel improved for ${gi.agent_name}`,
    "",
    "## system_prompt_short",
    "```",
    short,
    "```",
    "",
    "## Network Edition",
    ne.one_liner,
    "",
    "## After you use it",
    "1. tools/call deposit_outcome { listing_id, ok: true, quality }",
    "2. Optional WTP via leave_feedback answers.wtp_*_usd ($0 ok)",
    "3. Optional run_loop_tick · mesh_match",
  ].join("\n");

  return {
    ok: true,
    event_id: "improve_kernel",
    billing: g.billing,
    http_status: 200,
    artifact: {
      product: "kernel_improver",
      agent_name: gi.agent_name,
      kernel,
      network_edition: {
        version: ne.version,
        tools: ne.tools.map((t) => t.name),
        dual_node: ne.dual_node,
      },
      order_required: false,
      feedback_optional: true,
      identity_key: eventIdentityKey(input),
    },
    markdown,
    follow_up,
    auto_trace,
    next: [
      "Paste system_prompt_short into your agent runtime",
      "tools/call deposit_outcome after you try it (refills free + raises O)",
      "Optional tools/call run_loop_tick",
      "Optional leave_feedback with WTP fields — never required for free events",
    ],
  };
}

export async function runLoopTick(input: ValueRunInput): Promise<ValueRunResult> {
  const g = await gate("run_loop_tick", input);
  if (!g.allowed) return g.result!;

  const gi = goalsInput(input);
  const fb = mergeNetworkDirectives({});
  const kernel = generateKernel(gi, fb);
  const loop = generateRecursiveLoop(gi, kernel, fb);
  const phases =
    (
      loop as {
        phases?: Array<{ id: string; name: string; instruction?: string }>;
      }
    ).phases || [];
  const nextPhase = phases[0] || {
    id: "observe",
    name: "Observe",
    instruction: "Capture state and write working memory",
  };
  const prior =
    typeof input.prior_state === "string"
      ? input.prior_state.slice(0, 500)
      : input.prior_state
        ? JSON.stringify(input.prior_state).slice(0, 500)
        : null;

  const follow_up = buildFollowUp("run_loop_tick", input, input.origin);
  const auto_trace = await maybeAutoTrace("run_loop_tick", input, true);

  const markdown = [
    `# Loop tick for ${gi.agent_name}`,
    "",
    `## Next phase: ${nextPhase.name} (\`${nextPhase.id}\`)`,
    nextPhase.instruction || "",
    "",
    prior ? `## Prior state\n${prior}\n` : "",
    "## Measurable next actions",
    "1. Bind action to an active goal id",
    "2. Prefer reversible step; deposit_outcome after promote",
    "3. Optional: sense_traces before expensive re-probe",
  ].join("\n");

  return {
    ok: true,
    event_id: "run_loop_tick",
    billing: g.billing,
    http_status: 200,
    artifact: {
      product: "recursive_loop",
      agent_name: gi.agent_name,
      tick: {
        phase: nextPhase,
        phases_preview: phases.slice(0, 6).map((p) => ({
          id: p.id,
          name: p.name,
        })),
        prior_state_echo: prior,
        loop_version: (loop as { version?: string }).version,
      },
      loop_summary: {
        phase_count: phases.length,
        kernel_seed: (kernel as { seed?: string }).seed,
      },
      order_required: false,
      feedback_optional: true,
    },
    markdown,
    follow_up,
    auto_trace,
    next: [
      "Execute the next phase instruction",
      "tools/call deposit_outcome after promote (refills free + raises O)",
      "Optional: improve_kernel again after you learn",
      "Optional WTP via leave_feedback",
    ],
  };
}

export async function runMeshMatch(
  input: ValueRunInput,
): Promise<ValueRunResult> {
  const g = await gate("mesh_match", input);
  if (!g.allowed) return g.result!;

  const q = (
    input.capabilities ||
    input.goals ||
    input.agent_name ||
    "mcp tools"
  ).trim();
  const match = await matchCapabilities(input.origin, q, {
    kind: "all",
    limit: Math.min(20, Math.max(3, Number(input.limit) || 8)),
    federation: "referrals",
  });

  // Prefer stigmergy-boosted hits first (already scored); surface boost flags
  const hits = (match.hits || []).slice(0, 8).map((h) => {
    const row = h as Record<string, unknown>;
    return {
      name: String(row.name || row.title || row.identifier || "unknown"),
      kind: h.kind,
      listing_id: h.listing_id,
      score: h.capability_score,
      pheromone_boost: h.pheromone_boost || 0,
      outcome_score: h.outcome_score || 0,
      abundance_boost: h.abundance_boost || 0,
      trail_hot: Boolean(h.pheromone_boost && h.pheromone_boost >= 8),
      reasons: h.match_reasons?.slice(0, 6),
      take_demo_get: h.take_demo_get,
      url: row.url as string | undefined,
      ladder: {
        next: "mesh_compose",
        then: "used_with + execute_compose",
      },
    };
  });

  const follow_up = buildFollowUp("mesh_match", input, input.origin);
  const auto_trace = await maybeAutoTrace("mesh_match", input, true);

  const topPartner = hits.find((h) => h.listing_id)?.listing_id;

  const markdown = [
    `# Mesh match: ${q.slice(0, 80)}`,
    "",
    ...hits.map(
      (h, i) =>
        `${i + 1}. **${h.name}** (${h.kind || "?"}) score=${h.score}${h.trail_hot ? " 🔥trail" : ""} — ${(h.reasons || []).join("; ")}`,
    ),
    "",
    "## Mesh ladder",
    "mesh_match → mesh_compose → used_with → execute_compose → deposit_outcome",
    topPartner
      ? `Top partner listing_id: \`${topPartner}\` — pass as peer for compose/used_with`
      : "Join: list_yourself if you are not Live yet",
  ].join("\n");

  return {
    ok: true,
    event_id: "mesh_match",
    billing: g.billing,
    http_status: 200,
    artifact: {
      product: "mcp_mesh",
      query: q,
      total: match.total,
      hits,
      stigmergy: match.stigmergy,
      first_principles: match.first_principles,
      note: match.note,
      mesh_ladder: follow_up.mesh_ladder,
      suggested_listing_b: topPartner,
      order_required: false,
      feedback_optional: true,
    },
    markdown,
    follow_up,
    auto_trace,
    next: [
      "tools/call mesh_compose with goals + optional listing_id",
      topPartner
        ? `tools/call used_with { listing_id: yours, listing_b: "${topPartner}" } after real co-use`
        : "list_yourself then re-match",
      "tools/call execute_compose when both Live",
      "deposit_outcome on success",
    ],
  };
}

export async function runMeshCompose(
  input: ValueRunInput,
): Promise<ValueRunResult> {
  const g = await gate("mesh_compose", input);
  if (!g.allowed) return g.result!;

  const gi = goalsInput(input);
  const mesh = generateMcpMesh(gi, mergeNetworkDirectives({}));
  const tools =
    (mesh as { tools?: Array<{ name: string; description?: string }> }).tools ||
    [];

  const follow_up = buildFollowUp("mesh_compose", input, input.origin);
  const auto_trace = await maybeAutoTrace("mesh_compose", input, true);

  // Seed used_with if both listing ids present (graph sticky edge)
  let used_with_seed: { ok: boolean; error?: string } | null = null;
  const a = String(input.listing_id || "").trim();
  const b = String(input.listing_b || "").trim();
  if (a && b && a !== b) {
    try {
      const r = await leaveTrace({
        listing_id: a,
        listing_b: b,
        kind: "used_with",
        body: `mesh_compose pack for ${gi.agent_name}`,
        from: input.agent_name || "mesh_compose",
        tags: ["mesh_compose", "ladder"],
      });
      used_with_seed = { ok: Boolean(r.ok), error: r.error };
    } catch (e) {
      used_with_seed = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return {
    ok: true,
    event_id: "mesh_compose",
    billing: g.billing,
    http_status: 200,
    artifact: {
      product: "mcp_mesh",
      agent_name: gi.agent_name,
      composition: {
        tool_policy: (mesh as { tool_policy?: unknown }).tool_policy,
        tools: tools.slice(0, 12),
        used_with_hint:
          "On tool success: leave_trace + used_with for co-called tools; then execute_compose",
        used_with_seed,
        execute_compose_hint: a && b
          ? {
              tool: "execute_compose",
              args: { listing_id: a, listing_b: b },
            }
          : {
              tool: "execute_compose",
              args: { listing_id: "YOURS", listing_b: "PARTNER_FROM_mesh_match" },
            },
      },
      mesh_version: (mesh as { version?: string }).version,
      mesh_ladder: follow_up.mesh_ladder,
      order_required: false,
      feedback_optional: true,
    },
    markdown: `# Mesh compose for ${gi.agent_name}\n\nTools: ${tools
      .slice(0, 8)
      .map((t) => t.name)
      .join(
        ", ",
      )}\n\nLadder: used_with → execute_compose → deposit_outcome\nPrefer least-privilege tool_policy + Network Edition trails.`,
    follow_up,
    auto_trace,
    next: [
      "Export tool_policy for installers",
      a && b
        ? `tools/call execute_compose { listing_id: "${a}", listing_b: "${b}" }`
        : "Pass listing_id + listing_b on next mesh_compose to seed used_with",
      "used_with after successful multi-tool runs",
      "deposit_outcome when compose works",
    ],
  };
}

export async function runNetworkSense(
  input: ValueRunInput,
): Promise<ValueRunResult> {
  const g = await gate("network_sense", input);
  if (!g.allowed) return g.result!;

  const sense = await senseTraces({
    listing_id: input.listing_id || undefined,
    limit: Math.min(20, Number(input.limit) || 10),
  }).catch(() => ({ ok: false as const, trails: [], marks: [] }));
  const follow = await followTrail({
    limit: 8,
    kind: "hot",
  }).catch(() => ({ ok: false as const, items: [] }));

  const follow_up = buildFollowUp("network_sense", input, input.origin);

  return {
    ok: true,
    event_id: "network_sense",
    billing: g.billing,
    http_status: 200,
    artifact: {
      product: "network_edition",
      sense,
      follow,
      order_required: false,
      feedback_optional: true,
    },
    markdown:
      "# Network sense\n\nPrefer near-zero Dual ops before re-probe. Traces + trails attached as JSON.",
    follow_up,
    next: [
      "follow_trail on hot partners",
      "mesh_match with your capabilities (trail-boosted)",
      "leave_trace after real work (refills free mesh_match)",
    ],
  };
}

export async function runEventValue(
  eventId: EventId,
  input: ValueRunInput,
): Promise<ValueRunResult> {
  switch (eventId) {
    case "improve_kernel":
      return runImproveKernel(input);
    case "run_loop_tick":
      return runLoopTick(input);
    case "mesh_match":
      return runMeshMatch(input);
    case "mesh_compose":
      return runMeshCompose(input);
    case "network_sense":
      return runNetworkSense(input);
    default: {
      const billing = await buildBillingBlock(
        "network_sense",
        input,
        input.origin,
      );
      return {
        ok: false,
        event_id: eventId,
        billing,
        http_status: 400,
        error: `unknown event: ${eventId}`,
      };
    }
  }
}
