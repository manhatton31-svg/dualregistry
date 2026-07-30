/**
 * Feedback status vs shipped themes.
 * Already-shipped improvements drop out of "active" reports unless the
 * participant is clearly asking for a refinement.
 */
import { listReviewQueue } from "./system-ship";

/** Survey improvement id → system-ship theme id(s) */
export const IMPROVEMENT_TO_THEMES: Record<string, string[]> = {
  one_click_skill_md: ["skill_export", "one_click_skill_md"],
  shorter_system_prompt: ["prompt_length", "shorter_system_prompt"],
  clearer_goal_examples: ["goal_examples", "clearer_goal_examples"],
  better_loop_defaults: ["promote_gate", "better_loop_defaults"],
  live_worked_example: ["live_worked_example"],
  agent_native_buy_docs: ["agent_native_buy_docs"],
  pricing_transparency: ["pricing_transparency"],
  eval_harness_templates: ["eval_harness_templates"],
  mesh_a2a_handoff: ["mesh_a2a_handoff"],
  memory_policy_examples: ["memory_policy_examples"],
  mcp_reliability_loop: ["mcp.reliability_loop", "mcp_reliability_loop"],
  mcp_tool_policy_export: ["mcp.tool_policy", "mcp_tool_policy_export", "kernel_wish"],
};

const REFINEMENT_RE =
  /\b(still|again|not fixed|doesn'?t work|does not work|not working|broken still|regressed|regression|refine|refinement|not enough|still need|still missing|still want|still hard|still long|still confus|incomplete|half[- ]?fixed|please re-?do|more specific|even shorter|actually install)\b/i;

export type ShipSet = Set<string>;

export async function loadShippedThemeSet(): Promise<ShipSet> {
  const set = new Set<string>();
  try {
    const review = await listReviewQueue();
    for (const t of review.shipped_global?.themes || []) set.add(t);
    for (const i of review.shipped || []) set.add(i.theme);
    for (const i of review.queue || []) {
      if (i.status === "shipped") set.add(i.theme);
    }
  } catch {
    /* empty */
  }
  // Only themes actually shipped via system-ship / review queue
  return set;
}

export function isImprovementShipped(
  improvementId: string,
  shipped: ShipSet,
): boolean {
  const themes = IMPROVEMENT_TO_THEMES[improvementId] || [improvementId];
  return themes.some((t) => shipped.has(t));
}

export function textRequestsRefinement(text: string | undefined | null): boolean {
  if (!text) return false;
  return REFINEMENT_RE.test(String(text));
}

export type ImprovementBucket =
  | "active" // not shipped yet
  | "shipped_done" // shipped and no refinement signal
  | "refinement"; // shipped but participant asks to refine

export function classifyImprovement(opts: {
  id: string;
  shipped: ShipSet;
  /** free text from same response */
  texts?: string[];
}): ImprovementBucket {
  const shipped = isImprovementShipped(opts.id, opts.shipped);
  if (!shipped) return "active";
  const texts = opts.texts || [];
  if (texts.some((t) => textRequestsRefinement(t))) return "refinement";
  return "shipped_done";
}

/**
 * Split vote tallies into active / refinement / done.
 * Votes that only re-select a shipped theme without refinement language
 * count as shipped_done (hidden from "what should we build next").
 */
export function partitionImprovements(
  counts: Record<string, number>,
  shipped: ShipSet,
  refinementIds: Set<string>,
  directives: Record<string, string>,
): {
  active: Array<{ id: string; count: number; directive: string; status: "active" }>;
  refinement: Array<{
    id: string;
    count: number;
    directive: string;
    status: "refinement";
  }>;
  shipped_done: Array<{
    id: string;
    count: number;
    directive: string;
    status: "shipped_done";
  }>;
} {
  const active: Array<{
    id: string;
    count: number;
    directive: string;
    status: "active";
  }> = [];
  const refinement: Array<{
    id: string;
    count: number;
    directive: string;
    status: "refinement";
  }> = [];
  const shipped_done: Array<{
    id: string;
    count: number;
    directive: string;
    status: "shipped_done";
  }> = [];

  for (const [id, count] of Object.entries(counts).sort(
    (a, b) => b[1] - a[1],
  )) {
    const directive = directives[id] || id;
    if (refinementIds.has(id)) {
      refinement.push({ id, count, directive, status: "refinement" });
    } else if (isImprovementShipped(id, shipped)) {
      shipped_done.push({ id, count, directive, status: "shipped_done" });
    } else {
      active.push({ id, count, directive, status: "active" });
    }
  }
  return { active, refinement, shipped_done };
}

/** Free-text lines that still matter after shipping known themes */
export function filterOpenText(
  lines: string[],
  shipped: ShipSet,
): { open: string[]; refinement: string[]; already_covered: string[] } {
  const open: string[] = [];
  const refinement: string[] = [];
  const already_covered: string[] = [];

  const coveredSnippets: Array<{ re: RegExp; theme: string }> = [
    {
      re: /short(er)?\s*(system\s*)?prompt|prompt.?length|system_prompt_short|prompt is long|prompt too long|bit long for|context windows?/i,
      theme: "prompt_length",
    },
    {
      re: /skill\.?md|one[- ]?click|skill install|export.*skill|clearer install for agents/i,
      theme: "skill_export",
    },
    {
      re: /goal example|worked example|goal_checklist|checklist/i,
      theme: "goal_examples",
    },
    {
      re: /promote.?gate|loop default|looser promote|replan/i,
      theme: "promote_gate",
    },
    {
      re: /pricing|payment gate|founding price|250 feedback/i,
      theme: "pricing_transparency",
    },
    {
      re: /buy_product|agent.?native buy|checkout/i,
      theme: "agent_native_buy_docs",
    },
    {
      re: /tool policy export|publisher kernel|least privilege/i,
      theme: "kernel_wish",
    },
    {
      re: /eval harness|acceptance test/i,
      theme: "eval_harness_templates",
    },
  ];

  for (const line of lines) {
    const matched = coveredSnippets.find((c) => c.re.test(line));
    if (matched && shipped.has(matched.theme)) {
      if (textRequestsRefinement(line)) refinement.push(line);
      else already_covered.push(line);
    } else {
      open.push(line);
    }
  }
  return { open, refinement, already_covered };
}
