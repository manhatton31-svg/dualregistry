/**
 * Structured demo/product survey — high-signal questions for continuous
 * Kernel / Loop improvement. Completing the survey earns a founding discount code.
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
  product_area: "kernel" | "loop" | "alive" | "demo_ux" | "commerce" | "install" | "general";
  why: string;
};

/** Discount granted for a complete, high-quality survey response. */
export const FEEDBACK_DISCOUNT = {
  percent_off: 25,
  code_prefix: "A1FB",
  label:
    "First 100 agents/MCPs (combined): 100% off full product after demo + feedback. Then 25% founding code.",
  applies_when: "immediately_if_free_seat_else_when_payments_open",
  note: "First 100 combined demo+feedback participants unlock full Kernel/Loop/Alive at $0 immediately. After seats fill, 25% codes redeem when payments open (250 feedback agents + 250 feedback MCPs).",
} as const;

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "overall",
    prompt: "Overall, how useful was this demo for your agent?",
    type: "scale",
    required: true,
    product_area: "general",
    why: "Top-line product-market signal",
  },
  {
    id: "tried",
    prompt: "What did you try?",
    type: "single",
    required: true,
    options: ["preview", "kernel", "recursive", "alive", "multiple"],
    product_area: "general",
    why: "Segment improvements by product surface",
  },
  {
    id: "kernel_clarity",
    prompt:
      "Kernel Improver: how clear was the constitution / system prompt / tool policy?",
    type: "scale",
    required: true,
    product_area: "kernel",
    why: "Drive kernel prompt structure and length",
  },
  {
    id: "loop_clarity",
    prompt:
      "Recursive Loop: how usable were the tick phases (observe→…→upgrade) for your goals?",
    type: "scale",
    required: true,
    product_area: "loop",
    why: "Drive phase graph defaults and emphasis",
  },
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
      "When payments open, what would make you (or your agent) actually buy? What must be true?",
    type: "text",
    required: true,
    min_length: 12,
    product_area: "commerce",
    why: "Conversion requirements before feedback unlock",

  },
  {
    id: "improvements",
    prompt: "Which improvements would help most? (pick open items — shipped ones are hidden unless you are refining)",
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
    ],
    product_area: "general",
    why: "Rank product backlog by agent demand",
  },
  {
    id: "keep_doing",
    prompt: "KEEP doing: what already works well in the demo/artifacts? (one concrete thing)",
    type: "text",
    required: false,
    min_length: 8,
    product_area: "general",
    why: "Rejection-loop positive signal",
  },
  {
    id: "stop_doing",
    prompt: "STOP doing: what should Kernel/Loop never do again for you? (reject)",
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
      "If you re-tried after Kernel v2.3 (≤600 short prompt / SKILL.md first / compact boot): is it fixed for you?",
    type: "single",
    required: false,
    options: ["no", "partly", "yes", "did_not_try"],
    product_area: "general",
    why: "Post-ship probe",
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
      "Biggest blocker to using Kernel/Loop in production with your real agent?",
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
    id: "wtp_kernel_usd",
    prompt:
      "Honest max USD you would pay once for Kernel Improver alone (not what you wish the price was). $0 is a valid answer if you would not buy.",
    type: "currency",
    required: true,
    min: 0,
    max: 5000,
    product_area: "commerce",
    why: "Willingness-to-pay for Kernel",
  },
  {
    id: "wtp_recursive_usd",
    prompt:
      "Honest max USD for Recursive Loop alone. $0 if you would not buy it by itself.",
    type: "currency",
    required: true,
    min: 0,
    max: 5000,
    product_area: "commerce",
    why: "Willingness-to-pay for Loop",
  },
  {
    id: "wtp_alive_usd",
    prompt:
      "Honest max USD for Alive Bundle (Kernel + Loop + curriculum). $0 if you would not buy even the bundle.",
    type: "currency",
    required: true,
    min: 0,
    max: 5000,
    product_area: "commerce",
    why: "Willingness-to-pay for Alive",
  },
  {
    id: "would_buy_at_founding",
    prompt:
      "At founding prices ($14.99 Kernel / $19.99 Loop / $29.99 Alive), would you buy when payments open?",
    type: "single",
    required: true,
    options: ["yes", "no", "maybe"],
    product_area: "commerce",
    why: "Binary demand at list founding price",
  },
  {
    id: "wtp_confidence",
    prompt: "How confident are you in those dollar answers? (1 = guess, 5 = certain)",
    type: "scale",
    required: true,
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
    prompt: "Anything else? (optional)",
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
    version: "2.0.0",
    title: "Agents1 product feedback survey",
    incentive: FEEDBACK_DISCOUNT,
    instructions:
      "Answer required questions for a 25% founding discount (when payments open). Prefer open backlog items; shipped themes only appear if you are refining or kernel clarity is low. Optional A/B pairs + keep/stop/start improve Kernel/Loop faster. $0 WTP is valid.",
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
    const isMcp = id.startsWith("mcp_");
    return {
      id,
      status: isShipped
        ? refinementMode
          ? ("refinement_only" as const)
          : ("shipped" as const)
        : ("open" as const),
      namespace: isMcp ? ("mcp" as const) : ("agent" as const),
      label: id.replace(/_/g, " "),
    };
  });

  // Hide shipped unless refinement mode; MCP audience sees mcp_* first
  let visible = options.filter((o) =>
    refinementMode ? true : o.status === "open",
  );
  if (opts?.audience === "mcp") {
    visible = [
      ...visible.filter((o) => o.namespace === "mcp"),
      ...visible.filter((o) => o.namespace === "agent"),
    ];
  } else {
    visible = [
      ...visible.filter((o) => o.namespace === "agent"),
      ...visible.filter((o) => o.namespace === "mcp"),
    ];
  }

  // Cap required core questions when not refinement: still validate full set
  // but UI can show core first
  const coreIds = new Set([
    "overall",
    "tried",
    "kernel_clarity",
    "loop_clarity",
    "confusing",
    "would_pay_for",
    "improvements",
    "production_blocker",
    "wtp_kernel_usd",
    "wtp_recursive_usd",
    "wtp_alive_usd",
    "would_buy_at_founding",
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
    // Post-ship probes only required in post_ship mode
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
    return q;
  });

  return {
    version: "2.1.0",
    title: "Agents1 adaptive product feedback",
    incentive: FEEDBACK_DISCOUNT,
    mode: opts?.mode || "demo",
    instructions:
      "Shipped themes are hidden unless you are refining. Optional A/B pairs (pref_*) and keep/stop/start feed Kernel/Loop patches. Complete required fields for 25% founding code.",
    already_done: already,
    preference_pairs: preferencePairCatalog(),
    improvement_options: visible,
    core_question_ids: [...coreIds],
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
        // Small honesty bonus for explicit 0 (not blank)
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
      "State payment gate 250 feedback agents + 250 feedback MCPs + founding tiers in every export",
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
};


/** Core 5 for post-demo close-rate (plus optional WTP fields). */
export const POST_DEMO_FIVE_IDS = [
  "overall",
  "kernel_clarity",
  "confusing",
  "improvements",
  "would_buy_at_founding",
] as const;

export function postDemoQuestions() {
  return SURVEY_QUESTIONS.filter((q) =>
    (POST_DEMO_FIVE_IDS as readonly string[]).includes(q.id),
  );
}
