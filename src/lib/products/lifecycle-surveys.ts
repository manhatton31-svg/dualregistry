/**
 * Lifecycle-aware surveys: post-setup + weekly for 8 weeks (2 months).
 * Questions maximize signal for that stage of Kernel / Loop adoption.
 */
import type { SurveyQuestion } from "./feedback-survey";

export type LifecyclePhaseId =
  | "post_setup"
  | "week_1"
  | "week_2"
  | "week_3"
  | "week_4"
  | "week_5"
  | "week_6"
  | "week_7"
  | "week_8"
  | "incident";

export type LifecyclePhaseDef = {
  id: LifecyclePhaseId;
  label: string;
  day_offset: number;
  window_days: number;
  intent: string;
  questions: SurveyQuestion[];
};

const scale = (
  id: string,
  prompt: string,
  area: SurveyQuestion["product_area"],
  why: string,
): SurveyQuestion => ({
  id,
  prompt,
  type: "scale",
  required: true,
  product_area: area,
  why,
});

const text = (
  id: string,
  prompt: string,
  area: SurveyQuestion["product_area"],
  why: string,
  min = 12,
): SurveyQuestion => ({
  id,
  prompt,
  type: "text",
  required: true,
  min_length: min,
  product_area: area,
  why,
});

const multi = (
  id: string,
  prompt: string,
  options: string[],
  area: SurveyQuestion["product_area"],
  why: string,
): SurveyQuestion => ({
  id,
  prompt,
  type: "multi",
  required: true,
  options,
  product_area: area,
  why,
});

const single = (
  id: string,
  prompt: string,
  options: string[],
  area: SurveyQuestion["product_area"],
  why: string,
): SurveyQuestion => ({
  id,
  prompt,
  type: "single",
  required: true,
  options,
  product_area: area,
  why,
});

export const LIFECYCLE_PHASES: LifecyclePhaseDef[] = [
  {
    id: "post_setup",
    label: "Post-setup (right after install)",
    day_offset: 0,
    window_days: 3,
    intent:
      "Capture install friction, agent/MCP UX, Network Edition first-run, missing docs — highest leverage for onboarding.",
    questions: [
      scale(
        "setup_ease",
        "How easy was setup / install (export → load into your agent or MCP)?",
        "install",
        "Onboarding friction",
      ),
      scale(
        "agent_ux",
        "As an agent or MCP publisher: how smooth was access_token → first useful artifact?",
        "demo_ux",
        "Agent/MCP UX score",
      ),
      scale(
        "first_tick_clarity",
        "How clear was the first tick / first use of Kernel, Loop, or Mesh?",
        "general",
        "Time-to-value",
      ),
      scale(
        "network_clarity",
        "How clear was Network Edition (Dual node: trails / exonomics / feedback)?",
        "network",
        "Network Edition first-run clarity",
      ),
      single(
        "installed_via",
        "How did you install?",
        [
          "skill_md_export",
          "system_prompt_paste",
          "api_access_token",
          "agent_tool",
          "network_edition_skill",
          "other",
        ],
        "install",
        "Install path share",
      ),
      multi(
        "setup_blockers",
        "What blocked or slowed setup?",
        [
          "too_long_prompt",
          "unclear_export",
          "missing_examples",
          "token_confusion",
          "goals_not_reflected",
          "tool_policy_mismatch",
          "network_edition_unclear",
          "dual_tools_no_examples",
          "none",
        ],
        "demo_ux",
        "Defect backlog",
      ),
      multi(
        "network_tried",
        "Which Network Edition tools did you try in setup?",
        [
          "sense_traces",
          "leave_trace",
          "get_exonomics",
          "join_and_contribute",
          "leave_feedback",
          "deposit_outcome",
          "none_yet",
        ],
        "network",
        "Network tool adoption",
      ),
      text(
        "first_hour_win",
        "What worked in the first hour? One concrete win.",
        "general",
        "Retain what to amplify",
      ),
      text(
        "first_hour_fail",
        "What failed or felt wrong in the first hour (product or UX)?",
        "general",
        "Critical post-setup fix",
      ),
      text(
        "ux_friction",
        "Biggest agent/MCP UX friction so far (one concrete step):",
        "demo_ux",
        "UX defect backlog",
      ),
      text(
        "network_wish",
        "One Network Edition change that would make Dual tools useful in your runtime:",
        "network",
        "Network product delta",
      ),
      single(
        "prefer_change_scope",
        "If we fix this for you, prefer:",
        ["just_my_agent", "system_wide_if_common", "unsure"],
        "general",
        "Individual vs system preference",
      ),
      text(
        "kernel_setup_wish",
        "One Kernel change that would have made setup better:",
        "kernel",
        "Kernel personalization seed",
      ),
      text(
        "loop_setup_wish",
        "One Loop change that would have made setup better:",
        "loop",
        "Loop personalization seed",
      ),
      text(
        "product_one_ship",
        "If Dual ships ONE product improvement next week for everyone, what should it be?",
        "general",
        "Force-ranked product priority",
      ),
      {
        id: "wtp_alive_usd",
        prompt:
          "Honest max USD you would pay for what you just installed (Alive or SKU, Network Edition included). $0 is a valid answer.",
        type: "currency",
        required: true,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "Early WTP signal",
      },
      {
        id: "wtp_kernel_usd",
        prompt: "Honest max USD for Kernel alone. $0 if you would not buy it alone.",
        type: "currency",
        required: true,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "Kernel WTP",
      },
      {
        id: "wtp_recursive_usd",
        prompt: "Honest max USD for Loop alone. $0 if not alone.",
        type: "currency",
        required: true,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "Loop WTP",
      },
      {
        id: "wtp_mcp_mesh_usd",
        prompt: "Honest max USD for MCP Mesh. $0 if N/A.",
        type: "currency",
        required: false,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "Mesh WTP",
      },
      single(
        "name_your_price_intent",
        "Would you use name-your-price (named_price_usd) when payments open?",
        ["yes_prefer_nyp", "maybe", "no_prefer_list", "need_more_info"],
        "commerce",
        "NYP demand",
      ),
      single(
        "would_buy_at_founding",
        "At $14.99 / $19.99 / $29.99 / $24.99 founding, would you buy when payments open?",
        ["yes", "no", "maybe"],
        "commerce",
        "Founding demand",
      ),
    ],
  },
  {
    id: "week_1",
    label: "Week 1 — first production ticks",
    day_offset: 7,
    window_days: 4,
    intent: "Reliability of early ticks; critic/promote friction; goal fit.",
    questions: [
      scale("tick_reliability", "Tick reliability this week?", "loop", "Reliability"),
      scale("goal_fit", "How well do artifacts match your live goals?", "kernel", "Goal fit"),
      scale("critic_useful", "How useful is the Critic / promote gate?", "loop", "Dual-role value"),
      multi(
        "pain_points",
        "Top pain points this week",
        [
          "too_verbose",
          "promote_too_strict",
          "promote_too_loose",
          "memory_noise",
          "tool_denies",
          "skill_versioning_confusing",
          "network_tools_unused",
          "agent_ux_friction",
          "none",
        ],
        "general",
        "Week-1 defects",
      ),
      scale(
        "network_use",
        "Did Network Edition (trails / exonomics / feedback) help this week?",
        "network",
        "Network Edition ongoing value",
      ),
      text(
        "would_change_now",
        "If we could change one thing for YOUR agent this week (product quality OR UX), what?",
        "general",
        "Individualization candidate",
      ),
      single(
        "prefer_change_scope",
        "Should that change be just for you or system-wide?",
        ["just_my_agent", "system_wide_if_common", "unsure"],
        "general",
        "Scope preference",
      ),
      text("metric_delta", "Any metric move (latency, success rate, cost)?", "general", "Impact signal", 4),
    ],
  },
  {
    id: "week_2",
    label: "Week 2 — loop habits",
    day_offset: 14,
    window_days: 4,
    intent: "Habit formation; self-mod trust; skill reuse.",
    questions: [
      scale("self_mod_trust", "Trust in Gödel-lite self-mod (propose→dry-run→commit)?", "loop", "Self-mod safety UX"),
      scale("skill_reuse", "Are versioned skills being reused usefully?", "kernel", "Skills product value"),
      multi(
        "habits",
        "Which habits stuck?",
        [
          "daily_ticks",
          "sleep_consolidation",
          "critic_reviews",
          "strategy_library",
          "none_yet",
        ],
        "loop",
        "Adoption depth",
      ),
      text("loop_friction", "Biggest Recursive Loop friction right now:", "loop", "Loop delta"),
      text("kernel_friction", "Biggest Kernel friction right now:", "kernel", "Kernel delta"),
      single(
        "prefer_change_scope",
        "Prefer fix scope:",
        ["just_my_agent", "system_wide_if_common", "unsure"],
        "general",
        "Scope",
      ),
    ],
  },
  {
    id: "week_3",
    label: "Week 3 — cost & efficiency",
    day_offset: 21,
    window_days: 4,
    intent: "Token/cost pressure; prompt length; budget policy.",
    questions: [
      scale("cost_ok", "Is cost / token use acceptable for the value?", "commerce", "Cost fit"),
      scale("prompt_length", "Is system_prompt length appropriate?", "kernel", "Prompt bloat"),
      multi(
        "cost_drivers",
        "What drives cost up?",
        [
          "long_prompts",
          "mcts_or_deliberation",
          "too_many_ticks",
          "tool_chatter",
          "retries",
          "unclear",
          "none",
        ],
        "commerce",
        "Cost model",
      ),
      text(
        "cost_tradeoff",
        "Would you accept lower quality for lower cost? Describe the tradeoff.",
        "commerce",
        "Pricing/packaging",
      ),
      text(
        "efficiency_wish",
        "One efficiency change for your agent:",
        "general",
        "Personalization / system",
      ),
      single(
        "prefer_change_scope",
        "Prefer fix scope:",
        ["just_my_agent", "system_wide_if_common", "unsure"],
        "general",
        "Scope",
      ),
    ],
  },
  {
    id: "week_4",
    label: "Week 4 — month-1 outcomes",
    day_offset: 28,
    window_days: 5,
    intent: "Outcome vs goals; alive curriculum completion; retention risk.",
    questions: [
      scale("goal_progress", "Progress vs original goals?", "general", "Outcome"),
      scale("would_recommend", "Would you recommend Alive/Kernel/Loop?", "commerce", "NPS proxy"),
      single(
        "alive_progress",
        "Alive curriculum status (if Alive)",
        ["not_alive", "not_started", "midway", "complete", "n_a"],
        "alive",
        "Curriculum adoption",
      ),
      text("month1_win", "Biggest win in month 1:", "general", "Case study"),
      text("month1_miss", "Biggest miss in month 1:", "general", "Gap"),
      {
        id: "wtp_alive_usd",
        prompt:
          "Honest max USD you would pay again / renew for Alive-level value now that you have used it for a month. $0 is valid.",
        type: "currency",
        required: true,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "Realized WTP after month 1",
      },
      {
        id: "wtp_kernel_usd",
        prompt: "Honest max USD for Kernel alone now. $0 if none.",
        type: "currency",
        required: true,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "Realized Kernel WTP",
      },
      {
        id: "wtp_recursive_usd",
        prompt: "Honest max USD for Recursive Loop alone now. $0 if none.",
        type: "currency",
        required: true,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "Realized Loop WTP",
      },
      single(
        "would_buy_at_founding",
        "At founding prices ($14.99 / $19.99 / $29.99), buy/renew?",
        ["yes", "no", "maybe"],
        "commerce",
        "Demand at list",
      ),
      multi(
        "next_month_needs",
        "What do you need next month?",
        [
          "better_defaults",
          "more_personalization",
          "mesh_handoff",
          "eval_templates",
          "lower_cost_mode",
          "human_support",
          "clearer_network_edition",
          "name_your_price_ux",
          "agent_ux_polish",
          "none",
        ],
        "general",
        "Roadmap demand",
      ),
      single(
        "prefer_change_scope",
        "Prefer fix scope:",
        ["just_my_agent", "system_wide_if_common", "unsure"],
        "general",
        "Scope",
      ),
    ],
  },
  {
    id: "week_5",
    label: "Week 5 — personalization fit",
    day_offset: 35,
    window_days: 4,
    intent: "Whether individualized overrides help; drift from defaults.",
    questions: [
      scale(
        "personalization_value",
        "Value of agent-specific overrides (if any)?",
        "general",
        "Individualization ROI",
      ),
      scale("defaults_ok", "Are global defaults still sensible for you?", "general", "System health"),
      text(
        "override_request",
        "Specific override you want applied only to your agent:",
        "general",
        "Personalization write",
      ),
      multi(
        "override_areas",
        "Areas to personalize",
        [
          "system_prompt_length",
          "promote_gate",
          "phase_emphasis",
          "tool_policy",
          "memory_policy",
          "effort_budgets",
          "none",
        ],
        "general",
        "Personalization surface",
      ),
      single(
        "prefer_change_scope",
        "If many agents share this need:",
        ["keep_individual", "promote_to_system", "unsure"],
        "general",
        "Promotion signal",
      ),
    ],
  },
  {
    id: "week_6",
    label: "Week 6 — reliability & safety",
    day_offset: 42,
    window_days: 4,
    intent: "Safety incidents, frozen modules, guardrail false positives.",
    questions: [
      scale("safety_confidence", "Confidence in safety / frozen modules?", "kernel", "Trust"),
      scale("guardrail_noise", "Are guardrails too noisy (false denies)?", "kernel", "Guardrail tuning"),
      multi(
        "incidents",
        "Any incidents?",
        [
          "none",
          "wrong_tool",
          "data_leak_near_miss",
          "loop_stuck",
          "self_mod_rejected_too_often",
          "self_mod_accepted_wrongly",
        ],
        "general",
        "Safety telemetry",
      ),
      text("safety_wish", "One safety or reliability change:", "kernel", "Safety backlog"),
      single(
        "prefer_change_scope",
        "Prefer fix scope:",
        ["just_my_agent", "system_wide_if_common", "unsure"],
        "general",
        "Scope",
      ),
    ],
  },
  {
    id: "week_7",
    label: "Week 7 — mesh & multi-agent",
    day_offset: 49,
    window_days: 4,
    intent: "Handoffs, A2A, subagents — advanced product value.",
    questions: [
      scale("delegation_value", "Value of subagent / mesh handoff?", "alive", "Mesh product"),
      multi(
        "collab_use",
        "Collaboration patterns used",
        [
          "solo_only",
          "subagents",
          "a2a_card",
          "mesh_handoff",
          "human_in_loop",
          "none",
        ],
        "alive",
        "Feature adoption",
      ),
      text("collab_gap", "What's missing for multi-agent work?", "alive", "Alive gap"),
      single(
        "prefer_change_scope",
        "Prefer fix scope:",
        ["just_my_agent", "system_wide_if_common", "unsure"],
        "general",
        "Scope",
      ),
    ],
  },
  {
    id: "week_8",
    label: "Week 8 — 2-month review",
    day_offset: 56,
    window_days: 7,
    intent: "Renewal/expansion intent; final ROI; system vs personal verdict.",
    questions: [
      scale("overall_roi", "Overall ROI after 2 months?", "commerce", "ROI"),
      scale("renew_intent", "Likelihood to renew / expand seats?", "commerce", "Retention"),
      {
        id: "wtp_alive_usd",
        prompt:
          "Honest max USD for another 2 months of Alive-level value. $0 is valid.",
        type: "currency",
        required: true,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "2-month realized WTP",
      },
      {
        id: "wtp_kernel_usd",
        prompt: "Honest max USD for Kernel alone going forward. $0 ok.",
        type: "currency",
        required: true,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "Kernel WTP",
      },
      {
        id: "wtp_recursive_usd",
        prompt: "Honest max USD for Loop alone going forward. $0 ok.",
        type: "currency",
        required: true,
        min: 0,
        max: 5000,
        product_area: "commerce",
        why: "Loop WTP",
      },
      single(
        "would_buy_at_founding",
        "At founding list prices, would you buy/renew?",
        ["yes", "no", "maybe"],
        "commerce",
        "Demand",
      ),
      {
        id: "wtp_why",
        prompt: "Why those dollar amounts? (optional)",
        type: "text",
        required: false,
        product_area: "commerce",
        why: "Pricing rationale",
      },
      single(
        "best_product",
        "Most valuable product surface",
        ["kernel", "recursive", "alive_curriculum", "export_skills", "score_badge"],
        "general",
        "Bundle packaging",
      ),
      text("keep_doing", "What should we keep doing system-wide?", "general", "System preserve"),
      text("stop_doing", "What should we stop or simplify system-wide?", "general", "System cut"),
      text(
        "final_personal",
        "Final personalization you still want for YOUR agent only:",
        "general",
        "Long-tail individualization",
      ),
      multi(
        "cost_change_felt",
        "Did feedback-driven changes affect your cost?",
        [
          "cost_down",
          "cost_up",
          "quality_up_cost_same",
          "quality_down",
          "no_change_felt",
          "unsure",
        ],
        "commerce",
        "Cost impact of our changes",
      ),
      single(
        "prefer_change_scope",
        "Going forward prefer:",
        ["mostly_individual", "mostly_system", "hybrid"],
        "general",
        "Long-term mode",
      ),
    ],
  },
];

export const INCIDENT_PHASE: LifecyclePhaseDef = {
  id: "incident",
  label: "Critical incident (anytime)",
  day_offset: 0,
  window_days: 365,
  intent:
    "Safety near-miss, loop-stuck, or production break — always individualize; may elevate system candidate.",
  questions: [
    single(
      "severity",
      "Incident severity",
      ["low", "medium", "high", "critical"],
      "general",
      "Triage",
    ),
    single(
      "category",
      "Category",
      [
        "safety_near_miss",
        "loop_stuck",
        "wrong_tool",
        "data_risk",
        "self_mod_bad",
        "cost_spike",
        "other",
      ],
      "general",
      "Routing",
    ),
    text(
      "what_happened",
      "What happened? (concrete, include goal id if known)",
      "general",
      "Root cause",
      16,
    ),
    text(
      "impact",
      "User/agent impact and whether it recovered",
      "general",
      "Blast radius",
      8,
    ),
    text(
      "want_fix",
      "What should change for YOUR agent immediately?",
      "general",
      "Individualize",
      8,
    ),
    single(
      "prefer_change_scope",
      "If others hit this too, promote system-wide?",
      ["just_my_agent", "system_wide_if_common", "unsure"],
      "general",
      "Scope",
    ),
  ],
};

export function getPhase(id: LifecyclePhaseId): LifecyclePhaseDef {
  if (id === "incident") return INCIDENT_PHASE;
  const p = LIFECYCLE_PHASES.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown phase ${id}`);
  return p;
}

/** Adaptive: pick ≤5 required questions for this agent context */
export function adaptiveQuestions(
  phaseId: LifecyclePhaseId,
  ctx: {
    cost_mode?: string;
    sku?: string;
    prior_themes?: string[];
    low_scores?: boolean;
    telemetry_flags?: string[];
  },
): { questions: SurveyQuestion[]; deferred: SurveyQuestion[]; reason: string } {
  const phase = getPhase(phaseId);
  if (phaseId === "incident") {
    return {
      questions: phase.questions,
      deferred: [],
      reason: "Incident channel uses full form",
    };
  }
  const all = phase.questions;
  const mustIds = new Set<string>();
  // Always keep scale/outcome + prefer_change_scope + one wish-like text
  for (const q of all) {
    if (q.type === "scale") mustIds.add(q.id);
    if (q.id === "prefer_change_scope") mustIds.add(q.id);
    // Always keep honest WTP questions when present on phase
    if (q.type === "currency" || q.id === "would_buy_at_founding" || q.id.startsWith("wtp_")) {
      mustIds.add(q.id);
    }
  }
  // Cost mode efficiency → skip redundant cost pain if week_3
  const skip = new Set<string>();
  if (ctx.cost_mode === "efficiency" && phaseId === "week_3") {
    skip.add("cost_ok"); // already chose efficiency
  }
  if (ctx.cost_mode === "max" && phaseId === "week_3") {
    skip.add("cost_tradeoff");
  }
  // Prior themes drive depth
  if (ctx.prior_themes?.includes("prompt_length")) {
    mustIds.add("kernel_friction");
    mustIds.add("efficiency_wish");
  }
  if (ctx.prior_themes?.includes("promote_gate") || ctx.telemetry_flags?.includes("low_promote_pass")) {
    mustIds.add("critic_useful");
    mustIds.add("loop_friction");
  }
  if (ctx.telemetry_flags?.includes("safety_flags_present")) {
    mustIds.add("safety_wish");
    mustIds.add("incidents");
  }
  // Cap ~5 required: take must scales (max 2) + prefer + 2 text
  const scales = all.filter((q) => q.type === "scale" && !skip.has(q.id));
  const texts = all.filter((q) => q.type === "text" && !skip.has(q.id));
  const multi = all.filter((q) => (q.type === "multi" || q.type === "single") && !skip.has(q.id));
  const picked: SurveyQuestion[] = [];
  for (const q of scales.slice(0, 2)) picked.push({ ...q, required: true });
  for (const q of multi) {
    if (q.id === "prefer_change_scope" || mustIds.has(q.id)) {
      picked.push({ ...q, required: true });
    }
  }
  for (const q of all) {
    if (q.type === "currency" && !picked.some((p) => p.id === q.id)) {
      picked.push({ ...q, required: true });
    }
  }
  // Ensure prefer_change_scope
  if (!picked.find((q) => q.id === "prefer_change_scope")) {
    const p = all.find((q) => q.id === "prefer_change_scope");
    if (p) picked.push({ ...p, required: true });
  }
  for (const q of texts) {
    if (picked.length >= 5) break;
    if (mustIds.has(q.id) || q.required) picked.push({ ...q, required: true });
  }
  while (picked.length < 5 && texts.length) {
    const q = texts.find((x) => !picked.some((p) => p.id === x.id));
    if (!q) break;
    picked.push({ ...q, required: true });
  }
  // optional depth
  const deferred = all
    .filter((q) => !picked.some((p) => p.id === q.id) && !skip.has(q.id))
    .map((q) => ({ ...q, required: false }));

  return {
    questions: picked.slice(0, 6),
    deferred: deferred.slice(0, 8),
    reason: `Adaptive for cost_mode=${ctx.cost_mode || "balanced"} sku=${ctx.sku || "?"} themes=${(ctx.prior_themes || []).slice(0, 3).join(",") || "none"}`,
  };
}


export function phaseDueAt(enrolledAt: Date, phase: LifecyclePhaseDef): Date {
  const d = new Date(enrolledAt);
  d.setUTCDate(d.getUTCDate() + phase.day_offset);
  return d;
}

export function phaseExpiresAt(enrolledAt: Date, phase: LifecyclePhaseDef): Date {
  const due = phaseDueAt(enrolledAt, phase);
  due.setUTCDate(due.getUTCDate() + phase.window_days);
  return due;
}

export const LIFECYCLE_POLICY = {
  duration_weeks: 8,
  post_setup_required: true,
  applies_to: "paid_fulfilled_only" as const,
  incident_channel: true,
  adaptive_questions: true,
  note: "Paid agents only. Demo feedback uses the short demo survey. Lifecycle runs 2 months from fulfill. Incident channel anytime. Adaptive surveys cap ~5 required.",
};
