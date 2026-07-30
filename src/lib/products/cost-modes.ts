/**
 * First-class cost modes for Alive (and applicable to Kernel/Loop).
 * Efficiency ≈ 0.75–0.85× token spend · Max ≈ 1.2–1.35× for quality.
 */
export type CostModeId = "balanced" | "efficiency" | "max";

export type CostModeDef = {
  id: CostModeId;
  product_label: string;
  tagline: string;
  description: string;
  /** Relative to balanced baseline */
  cost_multiplier: number;
  quality_delta: number;
  knobs: {
    prefer_short_prompt?: boolean;
    cost_mode: "efficiency" | "balanced" | "quality";
    effort_cap: "low" | "medium" | "high";
    promote_gate_bias?: "stricter" | "looser" | "default";
  };
  features: string[];
};

export const COST_MODES: Record<CostModeId, CostModeDef> = {
  balanced: {
    id: "balanced",
    product_label: "Alive Balanced",
    tagline: "Default quality / cost",
    description: "Standard dual-role depth and deliberation.",
    cost_multiplier: 1,
    quality_delta: 0,
    knobs: {
      cost_mode: "balanced",
      effort_cap: "medium",
      promote_gate_bias: "default",
    },
    features: ["Default promote gate", "Medium effort tiers", "Full system prompt"],
  },
  efficiency: {
    id: "efficiency",
    product_label: "Alive Efficiency",
    tagline: "~0.75–0.85× cost · lean ticks",
    description:
      "Short prompts, lower effort caps, less deliberation — best for high-volume agents.",
    cost_multiplier: 0.8,
    quality_delta: -0.08,
    knobs: {
      prefer_short_prompt: true,
      cost_mode: "efficiency",
      effort_cap: "low",
      promote_gate_bias: "looser",
    },
    features: [
      "system_prompt_short preferred",
      "Low effort / fewer subagents",
      "Looser promote for low-risk goals",
      "MCTS-lite off unless hard goals",
    ],
  },
  max: {
    id: "max",
    product_label: "Alive Max",
    tagline: "~1.2–1.35× cost · max quality",
    description:
      "Deep critic, higher effort, stricter gates — best for high-stakes agents.",
    cost_multiplier: 1.25,
    quality_delta: 0.15,
    knobs: {
      cost_mode: "quality",
      effort_cap: "high",
      promote_gate_bias: "stricter",
    },
    features: [
      "Strict promote gate",
      "High effort + deliberation",
      "Full prompts + eval depth",
      "MCTS-lite on hard goals",
    ],
  },
};

export function resolveCostMode(raw?: string | null): CostModeId {
  const s = (raw || "balanced").toLowerCase().trim();
  if (s === "efficiency" || s === "alive_efficiency" || s === "lean")
    return "efficiency";
  if (s === "max" || s === "alive_max" || s === "quality") return "max";
  return "balanced";
}

export function costModesPublic() {
  return Object.values(COST_MODES).map((m) => ({
    id: m.id,
    label: m.product_label,
    tagline: m.tagline,
    description: m.description,
    cost_multiplier: m.cost_multiplier,
    quality_delta: m.quality_delta,
    features: m.features,
  }));
}
