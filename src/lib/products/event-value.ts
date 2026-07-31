/**
 * One-call value runners — no demo order required.
 * improve_kernel / run_loop_tick / mesh_match / mesh_compose / network_sense
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
} from "./event-pricing";
import {
  buildX402PaymentRequired,
  verifyPaymentProofScaffold,
  type PaymentProofInput,
} from "./x402-pay";
import { senseTraces, followTrail } from "./stigmergy";

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
        next: [
          "Retry with free allowance tomorrow (UTC day reset)",
          "Or send X-PAYMENT / payment_proof when X402_ENABLED=1",
          `Operator path: ${billing.payment.checkout_url}`,
          "Optional: leave_feedback after you try the free path",
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
    "Optional next: leave_feedback (not required for free events) · run_loop_tick · mesh_match",
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
    },
    markdown,
    next: [
      "Paste system_prompt_short into your agent runtime",
      "Optional tools/call run_loop_tick for one improvement cycle",
      "Optional tools/call leave_feedback — never required for free events",
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

  const markdown = [
    `# Loop tick for ${gi.agent_name}`,
    "",
    `## Next phase: ${nextPhase.name} (\`${nextPhase.id}\`)`,
    nextPhase.instruction || "",
    "",
    prior ? `## Prior state\n${prior}\n` : "",
    "## Measurable next actions",
    "1. Bind action to an active goal id",
    "2. Prefer reversible step; deposit outcome after promote",
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
    next: [
      "Execute the next phase instruction",
      "Optional: improve_kernel again after you learn",
      "Optional: leave_feedback",
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

  const hits = (match.hits || []).slice(0, 8).map((h) => {
    const row = h as Record<string, unknown>;
    return {
      name: String(row.name || row.title || row.identifier || "unknown"),
      kind: h.kind,
      listing_id: h.listing_id,
      score: h.capability_score,
      reasons: h.match_reasons?.slice(0, 4),
      take_demo_get: h.take_demo_get,
      url: row.url as string | undefined,
    };
  });

  const markdown = [
    `# Mesh match: ${q.slice(0, 80)}`,
    "",
    ...hits.map(
      (h, i) =>
        `${i + 1}. **${h.name}** (${h.kind || "?"}) score=${h.score} — ${(h.reasons || []).join("; ")}`,
    ),
    "",
    "Join: list_yourself / join_and_contribute · optional leave_trace after real work",
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
      note: match.note,
      order_required: false,
      feedback_optional: true,
    },
    markdown,
    next: [
      "Pick a partner listing_id and join_and_contribute",
      "Optional mesh_compose for used_with packs",
      "leave_trace after successful collab",
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
          "On tool success: leave_trace + used_with for co-called tools",
      },
      mesh_version: (mesh as { version?: string }).version,
      order_required: false,
      feedback_optional: true,
    },
    markdown: `# Mesh compose for ${gi.agent_name}\n\nTools: ${tools
      .slice(0, 8)
      .map((t) => t.name)
      .join(", ")}\n\nPrefer least-privilege tool_policy + Network Edition trails.`,
    next: [
      "Export tool_policy for installers",
      "used_with after successful multi-tool runs",
      "Optional leave_feedback",
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
    next: ["follow_trail on hot partners", "leave_trace after real work"],
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
