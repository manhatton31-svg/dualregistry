/**
 * Free taste: watermarked kernel stub from goals (no payment).
 * short_preview → ~30 lines (demo conversion default).
 * v2.3: lead with system_prompt_short (≤600) + quick_start.
 */
import { generateKernel, type GoalsInput } from "./generate";
import { PRODUCTS, formatUsd } from "./catalog";
import { shortenForDemo, goalsFromListing, GOAL_PRESETS } from "./demo-funnel";

export function buildPreview(
  input: GoalsInput & {
    short_preview?: boolean;
    preset?: string;
    description?: string;
  },
) {
  let goals = (input.goals || "").trim();
  if (goals.length < 8) {
    const resolved = goalsFromListing({
      name: input.agent_name,
      description: input.description || goals,
      preset: input.preset,
    });
    goals = resolved.goals;
  }

  const full = generateKernel({ ...input, goals });
  const short = input.short_preview !== false; // default short for demos

  const skills = (full.memory.procedural.skills || []).slice(0, 2).map((s) => ({
    ...s,
    steps: s.steps.slice(0, short ? 1 : 2),
    optimizable: false,
    note: "preview — full versioned skill library requires demo fulfill or paid Kernel/Alive",
  }));

  const system_prompt_full = [
    `# ${full.agent_name} — Agents1 Kernel PREVIEW (not full v${full.version})`,
    `Domain: ${full.domain}`,
    `Seed: ${full.seed}`,
    "",
    "## Paste this first (compact ≤600)",
    full.system_prompt_short,
    "",
    "## Constitution (sample — full set after demo/purchase)",
    ...full.constitution.slice(0, short ? 3 : 4).map((c, i) => `${i + 1}. ${c}`),
    "",
    "## Goals (bound)",
    ...full.goal_tree.map((g) => `- [${g.id}] ${g.objective}`),
    "",
    "## Preview limits",
    "- No promote_gate / dual Critic",
    "- No Gödel-lite self-mod",
    "- No textual-gradient skill versions",
    "- No sleep consolidation or subagent delegation",
    "",
    "Next: POST /api/products/agent { tool: demo_alive, sku: alive, goals, demo: true }",
    `Or one_click_demo (no goals). Feedback → founding 25% vault + counts toward unlock. Alive ${formatUsd(PRODUCTS.alive.price_cents)} when 10 agent + 5 MCP feedback opens payments.`,
  ].join("\n");

  const system_prompt = short
    ? shortenForDemo(system_prompt_full, 30)
    : system_prompt_full;

  return {
    status: "preview" as const,
    product: "kernel_preview",
    version: full.version,
    clarity_ship: full.clarity_ship,
    generated_at: new Date().toISOString(),
    watermark: "PREVIEW — free demo taste; not for production autonomy",
    short_preview: short,
    line_count: system_prompt.split("\n").length,
    agent_name: full.agent_name,
    domain: full.domain,
    seed: full.seed,
    // Clarity-first (agents read top of payload)
    quick_start: {
      paste_this: full.system_prompt_short,
      paste_char_count: full.system_prompt_short.length,
      max_chars: full.system_prompt_short_max,
      do_this_now: full.quick_start.do_this_now,
      next: "demo_alive or one_click_demo for full SKILL.md install kit",
    },
    system_prompt_short: full.system_prompt_short,
    system_prompt_short_chars: full.system_prompt_short.length,
    goal_tree: full.goal_tree,
    constitution_sample: full.constitution.slice(0, short ? 3 : 4),
    roles_summary: Object.keys(full.roles),
    frozen_modules: full.frozen_modules,
    skills_sample: skills,
    system_prompt,
    presets: Object.keys(GOAL_PRESETS),
    locked: [
      "promote_gate",
      "self_mod",
      "textual_gradient",
      "subagents",
      "sleep_consolidation",
      "aliveness_certificate",
      "skills_export",
    ],
    next: {
      demo_alive:
        "POST /api/products/agent { tool: demo_alive, sku: alive, goals, demo: true }",
      one_click_demo:
        "POST /api/products/agent { tool: one_click_demo, agent_name, description? }",
      feedback: "POST /api/products/feedback — founding 25% vault code",
    },
    upgrade: {
      recommended_sku: "alive",
      products: Object.values(PRODUCTS).map((p) => ({
        sku: p.sku,
        name: p.name,
        price: formatUsd(p.price_cents),
        price_cents: p.price_cents,
      })),
      checkout: "POST /api/products/checkout",
      agent_buy: "POST /api/products/agent { tool: buy_product|demo_alive, ... }",
    },
    goals_echo: { ...input, goals },
  };
}
