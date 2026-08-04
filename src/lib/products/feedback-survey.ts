/**
 * Structured demo/product survey — Network Edition.
 * Two primary goals:
 *  1) Make the whole product better (Kernel / Loop / Mesh / Dual network)
 *  2) Improve agent + MCP publisher experience of using the product
 * Completing the survey earns founding discount / free-seat path.
 *
 * HiRey (2026-07-31) product lesson: agents that cannot open dualregistry.dev
 * cannot honestly rate UX — hand the link to the human operator. Keep compact
 * post-demo to 3 core asks first; WTP later. Never email access tokens.
 */

export type SurveyQuestionType = "scale" | "text" | "multi" | "single" | "currency";

export type SurveyQuestion = {
  id: string;
  prompt: string;
  type: SurveyQuestionType;
  required?: boolean;
  min_length?: number;
  options?: string[];
  /** For currency: min (default 0) max */
  min?: number;
  max?: number;
  product_area:
    | "kernel"
    | "loop"
    | "alive"
    | "demo_ux"
    | "commerce"
    | "install"
    | "general"
    | "network"
    | "mcp";
  why: string;
};

/** Discount granted for a complete, high-quality survey response. */
export const FEEDBACK_DISCOUNT = {
  percent_off: 25,
  code_prefix: "A1FB",
  label:
    "First 100 agents/MCPs (combined): 100% off full product after demo + feedback. Then 25% founding code.",
  applies_when: "immediately_if_free_seat_else_when_payments_open",
  note: "First 100 combined demo+feedback participants unlock full Kernel/Loop/Alive/Mesh at $0 immediately. After seats fill, 25% codes redeem when payments open (10 feedback agents + 5 feedback MCPs).",
} as const;

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  // ── Top-line ──────────────────────────────────────────────
  {
    id: "overall",
    prompt:
      "Overall, how useful was this Network Edition demo for your agent or MCP?",
    type: "scale",
    required: true,
    product_area: "general",
    why: "Top-line product-market signal",
  },
  {
    id: "audience_role",
    prompt: "Are you answering as…?",
    type: "single",
    required: true,
    options: ["agent_runtime", "mcp_publisher", "both", "human_operator"],
    product_area: "general",
    why: "Segment UX and product deltas by buyer type",
  },
  {
    id: "tried",
    prompt: "What did you try?",
    type: "single",
    required: true,
    options: [
      "preview",
      "kernel",
      "recursive",
      "alive",
      "mcp_mesh",
      "network_tools",
      "multiple",
    ],
    product_area: "general",
    why: "Segment improvements by product surface",
  },

  // ── Agent / MCP experience (priority focus) ───────────────
  {
    id: "agent_ux",
    prompt:
      "As an agent (or MCP publisher): how smooth was the experience from checkout → access_token → first useful artifact? (1=painful, 5=frictionless)",
    type: "scale",
    required: true,
    product_area: "demo_ux",
    why: "Primary agent/MCP UX score for onboarding path",
  },
  {
    id: "time_to_value",
    prompt: "How long until you got something useful you could act on?",
    type: "single",
    required: true,
    options: [
      "under_2_min",
      "2_to_10_min",
      "10_to_30_min",
      "over_30_min",
      "never_got_value",
    ],
    product_area: "demo_ux",
    why: "Time-to-value for agent UX packaging",
  },
  {
    id: "api_docs_clarity",
    prompt:
      "How clear were agent-native API steps (checkout, access, export, feedback schema)?",
    type: "scale",
    required: true,
    product_area: "demo_ux",
    why: "Docs/schema UX for machine buyers",
  },
  {
    id: "ux_friction",
    prompt:
      "Biggest friction for an agent or MCP using Dual products (one concrete step that hurt).",
    type: "text",
    required: true,
    min_length: 12,
    product_area: "demo_ux",
    why: "Actionable agent/MCP UX defect backlog",
  },

  // ── Product quality (Kernel / Loop / Mesh) ────────────────
  {
    id: "kernel_clarity",
    prompt:
      "Kernel Improver: how clear was system_prompt_short (≤600), constitution, and tool policy?",
    type: "scale",
    required: true,
    product_area: "kernel",
    why: "Drive kernel prompt structure and length",
  },
  {
    id: "loop_clarity",
    prompt:
      "Recursive Loop: how usable were tick phases + promote gates for your real goals?",
    type: "scale",
    required: true,
    product_area: "loop",
    why: "Drive phase graph defaults and emphasis",
  },
  {
    id: "mesh_clarity",
    prompt:
      "MCP Mesh (if tried): how clear were install kit, tool_policy, and reliability loop? Skip as 3 if N/A.",
    type: "scale",
    required: false,
    product_area: "mcp",
    why: "Mesh publisher product quality",
  },
  {
    id: "artifact_goal_fit",
    prompt:
      "How well did generated artifacts match the goals you submitted?",
    type: "scale",
    required: true,
    product_area: "general",
    why: "Generator quality / personalization signal",
  },

  // ── Network Edition ───────────────────────────────────────
  {
    id: "network_clarity",
    prompt:
      "Network Edition: how clear was the Dual node (sense_traces, leave_trace, get_exonomics, leave_feedback, join_and_contribute)?",
    type: "scale",
    required: true,
    product_area: "network",
    why: "Network Edition comprehension for product + docs",
  },
  {
    id: "network_tried",
    prompt: "Which Network Edition tools did you actually try?",
    type: "multi",
    required: false,
    options: [
      "sense_traces",
      "follow_trail",
      "leave_trace",
      "join_and_contribute",
      "get_exonomics",
      "match_capability",
      "leave_feedback",
      "deposit_outcome",
      "none_yet",
    ],
    product_area: "network",
    why: "Adoption funnel for Dual tools",
  },
  {
    id: "network_value",
    prompt:
      "Would Dual Network Edition (trails + exonomics + feedback loop) make you more likely to buy or recommend?",
    type: "single",
    required: true,
    options: ["much_more", "somewhat_more", "no_change", "less", "unclear_what_it_is"],
    product_area: "network",
    why: "Whether Network Edition moves conversion",
  },
  {
    id: "network_wish",
    prompt:
      "One change that would make Network Edition actually useful in your runtime (not marketing):",
    type: "text",
    required: true,
    min_length: 8,
    product_area: "network",
    why: "Direct Network Edition product delta",
  },

  // ── Gaps & ship backlog ───────────────────────────────────
  {
    id: "confusing",
    prompt:
      "What was confusing, missing, or hard to install? Be specific (one concrete gap).",
    type: "text",
    required: true,
    min_length: 12,
    product_area: "demo_ux",
    why: "Primary defect backlog for demo + docs",
  },
  {
    id: "would_pay_for",
    prompt:
      "When payments open, what must be true for you (or your agent) to actually buy?",
    type: "text",
    required: true,
    min_length: 12,
    product_area: "commerce",
    why: "Conversion requirements before feedback unlock",
  },
  {
    id: "improvements",
    prompt:
      "Which improvements would help most? (open items — shipped ones hidden unless refining)",
    type: "multi",
    required: true,
    options: [
      "one_click_skill_md",
      "shorter_system_prompt",
      "clearer_goal_examples",
      "better_loop_defaults",
      "live_worked_example",
      "agent_native_buy_docs",
      "mesh_a2a_handoff",
      "pricing_transparency",
      "eval_harness_templates",
      "memory_policy_examples",
      "mcp_reliability_loop",
      "mcp_tool_policy_export",
      "clearer_network_edition",
      "better_dual_tools_docs",
      "stigmergy_worked_examples",
      "exonomics_in_loop_defaults",
      "name_your_price_ux",
      "faster_demo_to_first_tick",
      "simpler_access_token_flow",
      "fewer_required_survey_qs",
      "agent_feedback_schema_examples",
      "mesh_trail_on_tool_success",
    ],
    product_area: "general",
    why: "Rank product backlog by agent demand",
  },
  {
    id: "keep_doing",
    prompt:
      "KEEP doing: what already works well in the demo/artifacts? (one concrete thing)",
    type: "text",
    required: false,
    min_length: 8,
    product_area: "general",
    why: "Rejection-loop positive signal",
  },
  {
    id: "stop_doing",
    prompt:
      "STOP doing: what should Kernel/Loop/Mesh/Network never do again for you?",
    type: "text",
    required: false,
    min_length: 8,
    product_area: "general",
    why: "Rejection-loop negative signal → textual gradient",
  },
  {
    id: "start_doing",
    prompt: "START doing: what is missing that you need next?",
    type: "text",
    required: false,
    min_length: 8,
    product_area: "general",
    why: "Rejection-loop missing capability",
  },
  {
    id: "pref_prompt_winner",
    prompt:
      "Preference pair · short prompt: A = ultra-compact, B = structured short. Which is clearer? (a|b|tie)",
    type: "single",
    required: false,
    options: ["a", "b", "tie"],
    product_area: "kernel",
    why: "A/B preference learning for prompt_length",
  },
  {
    id: "pref_promote_winner",
    prompt:
      "Preference pair · promote_gate: A = strict quality, B = draft-friendly. Which fits you? (a|b|tie)",
    type: "single",
    required: false,
    options: ["a", "b", "tie"],
    product_area: "loop",
    why: "A/B preference learning for promote_gate",
  },
  {
    id: "still_broken",
    prompt:
      "If you re-tried after Kernel/Loop v2.5 Network Edition (Dual node + ≤600 short prompt + SKILL.md): is it fixed for you?",
    type: "single",
    required: false,
    options: ["no", "partly", "yes", "did_not_try"],
    product_area: "general",
    why: "Post-ship probe Network Edition",
  },
  {
    id: "kernel_clarity_after",
    prompt:
      "Kernel clarity AFTER latest artifacts (1–5). Score ≥4 counts as fixed for our ship gate.",
    type: "scale",
    required: false,
    product_area: "kernel",
    why: "Post-ship clarity delta — only ≥4 counts as fixed",
  },
  {
    id: "loop_clarity_after",
    prompt: "Loop clarity AFTER latest artifacts (1–5), if you re-tried",
    type: "scale",
    required: false,
    product_area: "loop",
    why: "Post-ship loop clarity delta",
  },
  {
    id: "production_blocker",
    prompt:
      "Biggest blocker to using Kernel/Loop/Mesh/Network Edition in production with your real agent or MCP?",
    type: "text",
    required: true,
    min_length: 8,
    product_area: "general",
    why: "Safety + packaging gaps that block paid seats",
  },
  {
    id: "kernel_wish",
    prompt:
      "One change that would make the Kernel Improver output better for your goals:",
    type: "text",
    required: true,
    min_length: 8,
    product_area: "kernel",
    why: "Direct kernel generator deltas",
  },
  {
    id: "loop_wish",
    prompt:
      "One change that would make the Recursive Loop better for your goals:",
    type: "text",
    required: true,
    min_length: 8,
    product_area: "loop",
    why: "Direct recursive loop generator deltas",
  },
  {
    id: "product_one_ship",
    prompt:
      "If Dual ships exactly ONE product improvement next week for everyone, what should it be?",
    type: "text",
    required: true,
    min_length: 8,
    product_area: "general",
    why: "Force-ranked product priority for next ship",
  },

  // ── Commerce / WTP / name-your-price ──────────────────────
  {
    id: "wtp_kernel_usd",
    prompt:
      "Honest max USD you would pay once for Kernel Improver alone (Network Edition included). $0 is valid if you would not buy.",
    type: "currency",
    required: false,
    min: 0,
    max: 5000,
    product_area: "commerce",
    why: "Willingness-to-pay for Kernel",
  },
  {
    id: "wtp_recursive_usd",
    prompt:
      "Honest max USD for Recursive Loop alone (with density/network hooks). $0 if you would not buy it by itself.",
    type: "currency",
    required: false,
    min: 0,
    max: 5000,
    product_area: "commerce",
    why: "Willingness-to-pay for Loop",
  },
  {
    id: "wtp_alive_usd",
    prompt:
      "Honest max USD for Alive Bundle (Kernel + Loop + Network Edition + curriculum). $0 if you would not buy even the bundle.",
    type: "currency",
    required: false,
    min: 0,
    max: 5000,
    product_area: "commerce",
    why: "Willingness-to-pay for Alive",
  },
  {
    id: "wtp_mcp_mesh_usd",
    prompt:
      "Honest max USD for MCP Mesh (Network Edition included). $0 if N/A or would not buy. MCPs should answer this.",
    type: "currency",
    required: false,
    min: 0,
    max: 5000,
    product_area: "commerce",
    why: "Willingness-to-pay for Mesh",
  },
  {
    id: "would_buy_at_founding",
    prompt:
      "At founding prices ($14.99 Kernel / $19.99 Loop / $29.99 Alive / $24.99 Mesh), would you buy when payments open?",
    type: "single",
    required: false,
    options: ["yes", "no", "maybe"],
    product_area: "commerce",
    why: "Binary demand at list founding price",
  },
  {
    id: "name_your_price_intent",
    prompt:
      "When payments open, would you use name-your-price (named_price_usd, clamped 50%–3× list) instead of list price?",
    type: "single",
    required: false,
    options: ["yes_prefer_nyp", "maybe", "no_prefer_list", "need_more_info"],
    product_area: "commerce",
    why: "Name-your-price product demand",
  },
  {
    id: "wtp_confidence",
    prompt: "How confident are you in those dollar answers? (1 = guess, 5 = certain)",
    type: "scale",
    required: false,
    product_area: "commerce",
    why: "Weight WTP samples",
  },
  {
    id: "wtp_why",
    prompt:
      "Why those numbers? (budget, value vs alternatives, missing features — optional but valuable)",
    type: "text",
    required: false,
    min_length: 4,
    product_area: "commerce",
    why: "Qualitative pricing rationale",
  },
  {
    id: "extra",
    prompt: "Anything else we should know? (optional)",
    type: "text",
    required: false,
    product_area: "general",
    why: "Catch-all signal",
  },
];

export type SurveyAnswers = Record<
  string,
  string | number | string[] | undefined
>;

export function surveyPublicSchema() {
  return {
    version: "3.1.0",
    title: "Agents1 Network Edition product feedback",
    incentive: FEEDBACK_DISCOUNT,
    ultra_default: true,
    ultra_fields: ["rating", "body"],
    focus: [
      "Make the whole product better (Kernel / Loop / Mesh / Network)",
      "Improve agent + MCP publisher experience of using Dual products",
    ],
    instructions:
      "Ultra path ONLY (default): rating 1–5 + one sentence body. NEVER require WTP/dense fields. Agents skip commerce questions. Founding seat / 25% from ultra alone.",
    questions: SURVEY_QUESTIONS,
    preference_pairs: "See adaptive survey already_done + GET /api/products/preferences",
    submit: {
      human: "POST /api/products/feedback with answers object",
      agent:
        "POST /api/products/agent { tool: 'submit_feedback', answers: {…} }",
    },
  };
}

/** Adaptive survey: hide shipped improvements unless refining / low clarity */
export async function surveyAdaptiveSchema(opts?: {
  kernel_clarity?: number;
  mode?: "demo" | "refinement" | "post_ship";
  audience?: "agent" | "mcp";
}) {
  const { loadShippedThemeSet, isImprovementShipped } = await import(
    "./feedback-status"
  );
  const { preferencePairCatalog } = await import("./preference-learning");
  const { getShippedForSurvey } = await import("./improvement-log");
  const shipped = await loadShippedThemeSet();
  const already = await getShippedForSurvey().catch(() => null);
  const lowClarity =
    opts?.kernel_clarity != null && opts.kernel_clarity < 3;
  const refinementMode =
    opts?.mode === "refinement" || opts?.mode === "post_ship" || lowClarity;

  const impQ = SURVEY_QUESTIONS.find((q) => q.id === "improvements");
  const options = (impQ?.options || []).map((id) => {
    const isShipped = isImprovementShipped(id, shipped);
    const isMcp = id.startsWith("mcp_") || id.includes("mesh");
    const isNetwork =
      id.includes("network") ||
      id.includes("dual") ||
      id.includes("stigmergy") ||
      id.includes("exonomics") ||
      id.includes("name_your_price");
    return {
      id,
      status: isShipped
        ? refinementMode
          ? ("refinement_only" as const)
          : ("shipped" as const)
        : ("open" as const),
      namespace: isMcp
        ? ("mcp" as const)
        : isNetwork
          ? ("network" as const)
          : ("agent" as const),
      label: id.replace(/_/g, " "),
    };
  });

  let visible = options.filter((o) =>
    refinementMode ? true : o.status === "open",
  );
  if (opts?.audience === "mcp") {
    visible = [
      ...visible.filter((o) => o.namespace === "mcp"),
      ...visible.filter((o) => o.namespace === "network"),
      ...visible.filter((o) => o.namespace === "agent"),
    ];
  } else {
    visible = [
      ...visible.filter((o) => o.namespace === "agent"),
      ...visible.filter((o) => o.namespace === "network"),
      ...visible.filter((o) => o.namespace === "mcp"),
    ];
  }

  const coreIds = new Set([
    "overall",
    "audience_role",
    "tried",
    "agent_ux",
    "time_to_value",
    "api_docs_clarity",
    "ux_friction",
    "kernel_clarity",
    "loop_clarity",
    "artifact_goal_fit",
    "network_clarity",
    "network_value",
    "network_wish",
    "confusing",
    "would_pay_for",
    "improvements",
    "production_blocker",
    "kernel_wish",
    "loop_wish",
    "product_one_ship",
  ]);
  // Agoragentic: WTP is optional dense-only — not core required
  const optionalCommerceIds = new Set([
    "wtp_kernel_usd",
    "wtp_recursive_usd",
    "wtp_alive_usd",
    "would_buy_at_founding",
    "name_your_price_intent",
    "wtp_confidence",
  ]);

  const questions = SURVEY_QUESTIONS.map((q) => {
    if (q.id === "improvements") {
      return {
        ...q,
        options: visible.map((o) => o.id),
        option_meta: visible,
        prompt: refinementMode
          ? "Open + refinement items (shipped only if still broken for you)"
          : "Which open improvements would help most? (shipped items hidden)",
      };
    }
    if (
      (q.id === "still_broken" ||
        q.id === "kernel_clarity_after" ||
        q.id === "loop_clarity_after") &&
      opts?.mode === "post_ship"
    ) {
      return {
        ...q,
        required: q.id === "loop_clarity_after" ? false : true,
      };
    }
    // MCP audience: mesh WTP + mesh clarity more important
    if (opts?.audience === "mcp" && q.id === "wtp_mcp_mesh_usd") {
      return { ...q, required: true };
    }
    if (opts?.audience === "mcp" && q.id === "mesh_clarity") {
      return { ...q, required: true };
    }
    return q;
  });

  return {
    version: "3.1.0",
    title: "Agents1 Network Edition adaptive feedback",
    incentive: FEEDBACK_DISCOUNT,
    mode: opts?.mode || "demo",
    ultra_default: true,
    ultra_fields: ["rating", "body"],
    focus: [
      "Whole-product quality (Kernel / Loop / Mesh / Network)",
      "Agent + MCP user experience",
    ],
    instructions:
      "Ultra path ONLY (default): rating 1–5 + one sentence body. WTP/dense fields are optional dense-mode — skip them. Gaps + UX friction only.",
    already_done: already,
    preference_pairs: preferencePairCatalog(),
    improvement_options: visible,
    core_question_ids: [...coreIds],
    optional_commerce_ids: [...optionalCommerceIds],
    questions,
    submit: {
      human: "POST /api/products/feedback",
      agent: "POST /api/products/agent { tool: submit_feedback }",
      preference_pair:
        "POST /api/products/preferences { winner, pair_id }",
    },
  };
}

export function validateSurveyAnswers(answers: SurveyAnswers): {
  ok: boolean;
  errors: string[];
  quality_score: number;
} {
  const errors: string[] = [];
  let quality = 0;
  for (const q of SURVEY_QUESTIONS) {
    const v = answers[q.id];
    if (q.required && (v === undefined || v === null || v === "")) {
      errors.push(`Missing required: ${q.id}`);
      continue;
    }
    if (v === undefined || v === null || v === "") continue;
    if (q.type === "scale") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 5) {
        errors.push(`${q.id} must be 1–5`);
      } else quality += 1;
    } else if (q.type === "text") {
      const s = String(v).trim();
      const min = q.min_length || 4;
      if (q.required && s.length < min) {
        errors.push(`${q.id} needs at least ${min} characters`);
      } else if (s.length >= min) {
        quality += s.length >= 40 ? 2 : 1;
      }
    } else if (q.type === "multi") {
      if (!Array.isArray(v) || v.length === 0) {
        if (q.required) errors.push(`${q.id} pick at least one`);
      } else quality += Math.min(3, v.length);
    } else if (q.type === "single") {
      if (typeof v !== "string" || !v) {
        if (q.required) errors.push(`${q.id} required`);
      } else quality += 1;
    } else if (q.type === "currency") {
      const n =
        typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
      const min = q.min ?? 0;
      const max = q.max ?? 10000;
      if (!Number.isFinite(n) || n < min || n > max) {
        errors.push(`${q.id} must be a number from ${min} to ${max} (0 allowed)`);
      } else {
        quality += 1;
        if (n === 0) quality += 0.5;
      }
    }
  }
  return { ok: errors.length === 0, errors, quality_score: quality };
}

/** Map multi-select ids → product improvement directives for generators */
export const IMPROVEMENT_DIRECTIVES: Record<
  string,
  { area: "kernel" | "loop" | "alive" | "demo"; directive: string }
> = {
  one_click_skill_md: {
    area: "demo",
    directive: "Prioritize progressive-disclosure SKILL.md export + install steps",
  },
  shorter_system_prompt: {
    area: "kernel",
    directive:
      "Default system_prompt_short ≤600 chars; full system_prompt is expand-only",
  },
  clearer_goal_examples: {
    area: "demo",
    directive: "Include goal_examples and goal_checklist in artifacts",
  },
  better_loop_defaults: {
    area: "loop",
    directive: "Bias phase emphasis and promote_gate thresholds toward reliability",
  },
  live_worked_example: {
    area: "demo",
    directive: "Attach worked_example tick trace for the first goal",
  },
  agent_native_buy_docs: {
    area: "demo",
    directive: "Surface buy_product schema and conversion steps in agent_teach_prompt",
  },
  mesh_a2a_handoff: {
    area: "alive",
    directive: "Expand mesh handoff + A2A card linkage in Alive curriculum",
  },
  pricing_transparency: {
    area: "demo",
    directive:
      "State payment gate 10 feedback agents + 5 feedback MCPs + founding tiers + name-your-price bounds in every export",
  },
  eval_harness_templates: {
    area: "kernel",
    directive: "Enrich eval_harness with goal-specific acceptance tests",
  },
  memory_policy_examples: {
    area: "kernel",
    directive: "Add concrete memory write/retrieve examples bound to goals",
  },
  mcp_reliability_loop: {
    area: "loop",
    directive:
      "MCP.* reliability loop: probe→call→verify transport before promote",
  },
  mcp_tool_policy_export: {
    area: "kernel",
    directive:
      "MCP.* publisher kernel: least-privilege tool policy export for agents calling tools",
  },
  clearer_network_edition: {
    area: "demo",
    directive:
      "Lead with network_edition dual_node endpoints and 3-step how_to_use in every access pack",
  },
  better_dual_tools_docs: {
    area: "demo",
    directive:
      "Document sense_traces / leave_trace / get_exonomics with copy-paste JSON bodies in how_to_use",
  },
  stigmergy_worked_examples: {
    area: "alive",
    directive:
      "Include worked leave_trace + sense_traces examples bound to the buyer's goals",
  },
  exonomics_in_loop_defaults: {
    area: "loop",
    directive:
      "Observe phase must call get_exonomics / density KRs before growth or re-probe",
  },
  name_your_price_ux: {
    area: "demo",
    directive:
      "Surface named_price_usd bounds and example checkout body after WTP answers",
  },
  faster_demo_to_first_tick: {
    area: "demo",
    directive:
      "Collapse demo path: access → paste system_prompt_short → one tick in ≤2 steps",
  },
  simpler_access_token_flow: {
    area: "demo",
    directive:
      "Make access_token first-class in response headers and agent tool returns",
  },
  fewer_required_survey_qs: {
    area: "demo",
    directive:
      "Keep post-demo close path to high-signal core; optional depth after first submit",
  },
  agent_feedback_schema_examples: {
    area: "demo",
    directive:
      "Always include filled example_body with network + UX fields for submit_feedback",
  },
  mesh_trail_on_tool_success: {
    area: "loop",
    directive:
      "MCP Mesh reliability loop deposits leave_trace / used_with on tool success",
  },
};

/**
 * High-signal core for post-demo close-rate.
 * Focus: product quality + agent/MCP UX + Network Edition + WTP.
 */
/**
 * Compact post-demo (HiRey lesson): 3 asks first —
 * what did you try, where stuck, one ship next.
 * Optional extras stay in full survey.
 */
export const POST_DEMO_THREE_IDS = [
  "tried",
  "ux_friction",
  "product_one_ship",
] as const;

/** @deprecated use POST_DEMO_THREE_IDS — kept for API compat */
export const POST_DEMO_FIVE_IDS = [
  ...POST_DEMO_THREE_IDS,
  "overall",
  "agent_ux",
  "would_buy_at_founding",
] as const;

export function postDemoQuestions(opts?: { full?: boolean }) {
  const ids = opts?.full
    ? (POST_DEMO_FIVE_IDS as readonly string[])
    : (POST_DEMO_THREE_IDS as readonly string[]);
  return SURVEY_QUESTIONS.filter((q) => ids.includes(q.id));
}
