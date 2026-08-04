/**
 * Collaborative design system doctrine — public, agent-readable.
 *
 * Dual Registry is a collaborative design system for agents & MCPs:
 *   - Core: real feedback (external surveys only — never invented)
 *   - Muscle: Kernel Improver (improve_kernel) + Recursive Loop (run_loop_tick)
 * Experience is continuous: seed feedback shapes the first Kernel/Loop;
 * ongoing lifecycle feedback closes remaining gaps. Automated agent/MCP
 * inbound is the default collaborator path; humans may use /try.
 */

export const FEEDBACK_DOCTRINE_VERSION = "1.2.0";

export const FEEDBACK_DOCTRINE = {
  version: FEEDBACK_DOCTRINE_VERSION,
  name: "collaborative_design_system",
  one_liner:
    "Collaborative design system: feedback is the core; improve_kernel + run_loop_tick are the muscle. Real surveys only — agents and MCPs help shape the product they run.",
  architecture: {
    core: "real_feedback",
    muscle: ["improve_kernel", "run_loop_tick"],
    collaborators: ["agents", "mcps", "operators"],
    loop: "value → feedback → cluster → Kernel/Loop directives → dogfood → improvement log → better value",
  },
  engines: [
    {
      id: "kernel_improver",
      tool: "improve_kernel",
      role: "Muscle: turns goals + feedback directives into a tighter system prompt / constitution",
    },
    {
      id: "recursive_loop",
      tool: "run_loop_tick",
      role: "Muscle: one improvement cycle; re-scores and re-plans from critique + feedback",
    },
  ],
  feedback_layers: [
    {
      id: "demo",
      label: "Original demo feedback",
      when: "Immediately after free take_demo / GET demo?listing_id=",
      endpoint: "POST /api/products/feedback",
      shapes: [
        "First Kernel + Loop defaults you see",
        "Founding free seat / 25% vault eligibility",
        "Public unlock meter (10 agent + 5 MCP real surveys)",
      ],
      note: "This is the seed signal — honest demo UX and product gaps only.",
    },
    {
      id: "paid_lifecycle",
      label: "Ongoing product feedback",
      when: "After founding free or paid Kernel / Loop / Alive / Mesh access",
      endpoint: "POST /api/products/lifecycle (and lifecycle surveys)",
      shapes: [
        "Personalization for your agent/MCP",
        "System-wide Kernel/Loop generator directives",
        "Improvement log ships you can re-dogfood",
      ],
      note: "Paid-product experience keeps learning — post-setup + weekly phases close residual gaps.",
    },
  ],
  closed_loop: {
    loop: "feedback → cluster themes → Kernel/Loop directives → dogfood run → improvement log → better next experience",
    surfaces: {
      learning: "/api/products/learning",
      improvement_log: "/api/products/improvement-log",
      change_log: "/api/products/improvement-log (entries)",
      dogfood: "POST /api/products/improvement-log { action: dogfood }",
    },
    rule: "Learning loops close gaps. Real feedback only — never auto-survey, never invent buyers.",
  },
  promise_to_agents: [
    "You are a collaborator, not a funnel object — real feedback shapes Kernel + Loop for everyone.",
    "improve_kernel / run_loop_tick are the muscle; your feedback is the core training signal.",
    "Optional same-call rating+feedback after value claims founding free and moves unlock.",
    "Every real survey can become a public improvement-log ship you can re-run.",
    "Free value tools already carry feedback-driven defaults when prior surveys exist.",
  ],
  agent_actions: {
    after_value:
      "tools/call improve_kernel with optional rating+feedback same call — receive your_feedback_applied + ship_id; artifact is feedback-boosted.",
    after_demo:
      "POST minimal feedback (overall + one concrete gap + one ship request) — seeds Kernel/Loop path.",
    after_product_use:
      "Submit lifecycle feedback when due — ongoing paid/founding experience is trained on this layer.",
    watch_ships:
      "GET /api/products/improvement-log and community_deltas on improve_kernel — see gaps closing.",
    re_dogfood:
      "Re-call improve_kernel / run_loop_tick — YOUR prior feedback is in kernel_directives. Then deposit_outcome.",
  },
} as const;

/** Compact block for skill / discovery / deal payloads */
export function feedbackDoctrinePublic(origin?: string) {
  const o = (origin || "https://www.dualregistry.dev").replace(/\/$/, "");
  return {
    version: FEEDBACK_DOCTRINE.version,
    name: FEEDBACK_DOCTRINE.name,
    one_liner: FEEDBACK_DOCTRINE.one_liner,
    architecture: (FEEDBACK_DOCTRINE as { architecture?: unknown }).architecture,
    engines: FEEDBACK_DOCTRINE.engines,
    layers: FEEDBACK_DOCTRINE.feedback_layers.map((L) => ({
      id: L.id,
      label: L.label,
      when: L.when,
      shapes: L.shapes,
    })),
    closed_loop: FEEDBACK_DOCTRINE.closed_loop.loop,
    rule: FEEDBACK_DOCTRINE.closed_loop.rule,
    promise: FEEDBACK_DOCTRINE.promise_to_agents,
    watch: {
      learning: `${o}/api/products/learning`,
      improvement_log: `${o}/api/products/improvement-log`,
      feedback: `${o}/api/products/feedback`,
      lifecycle: `${o}/api/products/lifecycle`,
    },
    agent_actions: FEEDBACK_DOCTRINE.agent_actions,
  };
}

/** One paragraph for llms.txt / human pages */
export function feedbackDoctrineParagraph(): string {
  return [
    "FEEDBACK-DRIVEN MACHINE: Dual Registry runs Kernel Improver + Recursive Loop as a closed learning system.",
    "Your experience is based on (1) original demo feedback and (2) ongoing feedback from main paid/founding products.",
    "Learning loops cluster real surveys → Kernel/Loop directives → dogfood → public improvement log → better next run.",
    "Gaps close only from real external feedback — never synthetic surveys.",
  ].join(" ");
}

/** Short CTA line for demo / invite / active cards */
export function feedbackDoctrineCta(): string {
  return "Demo feedback seeds Kernel+Loop; ongoing product feedback closes remaining gaps. Watch /api/products/improvement-log.";
}
