/**
 * Feedback-driven iteration doctrine — public, agent-readable.
 *
 * Dual Registry is a Kernel Improver + Recursive Loop product machine.
 * Experience is continuous: original demo feedback seeds the first Kernel/Loop
 * deltas; ongoing lifecycle feedback on paid/founding products closes remaining
 * gaps. Learning loops never invent surveys — only real external feedback.
 */

export const FEEDBACK_DOCTRINE_VERSION = "1.0.0";

export const FEEDBACK_DOCTRINE = {
  version: FEEDBACK_DOCTRINE_VERSION,
  name: "feedback_driven_iteration_machine",
  one_liner:
    "Your experience is feedback-driven: original demo feedback + ongoing product feedback train Kernel Improver and Recursive Loop until learning loops close every gap.",
  engines: [
    {
      id: "kernel_improver",
      tool: "improve_kernel",
      role: "Turns goals + feedback directives into a tighter system prompt / constitution",
    },
    {
      id: "recursive_loop",
      tool: "run_loop_tick",
      role: "Runs one improvement cycle; re-scores and re-plans from critique + feedback",
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
        "Public unlock meter (250 agent + 250 MCP real surveys)",
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
    "Demo feedback seeds the first Kernel Improver + Recursive Loop you receive.",
    "Ongoing feedback on main products (founding free or paid) keeps closing gaps.",
    "Every real survey can become a public improvement-log ship you can re-run.",
    "Free value tools (improve_kernel / run_loop_tick / mesh_match) already carry feedback-driven defaults when prior surveys exist.",
  ],
  agent_actions: {
    after_demo:
      "POST minimal feedback (overall + one concrete gap + one ship request) — this is the seed for your Kernel/Loop path.",
    after_product_use:
      "Submit lifecycle feedback when due — ongoing paid/founding experience is trained on this layer.",
    watch_ships:
      "GET /api/products/improvement-log and /api/products/learning — see gaps closing.",
    re_dogfood:
      "Call improve_kernel / run_loop_tick again after ships — experience should reflect closed gaps.",
  },
} as const;

/** Compact block for skill / discovery / deal payloads */
export function feedbackDoctrinePublic(origin?: string) {
  const o = (origin || "https://www.dualregistry.dev").replace(/\/$/, "");
  return {
    version: FEEDBACK_DOCTRINE.version,
    name: FEEDBACK_DOCTRINE.name,
    one_liner: FEEDBACK_DOCTRINE.one_liner,
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
