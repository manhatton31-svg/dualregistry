/**
 * Stable theme clustering for lifecycle free-text + multi-select.
 * Synonym merge → theme ids; noise drop for one-offs.
 */
export type ThemeHit = {
  id: string;
  weight: number;
  evidence: string;
};

const SYNONYMS: Array<{ id: string; patterns: RegExp[] }> = [
  {
    id: "prompt_length",
    patterns: [
      /\b(too long|verbose|short(er)? prompt|context window|token budget|system_prompt)\b/i,
    ],
  },
  {
    id: "install_export",
    patterns: [
      /\b(install|export|skill\.?md|setup|onboard|paste|load into)\b/i,
    ],
  },
  {
    id: "promote_gate",
    patterns: [
      /\b(promote|critic|gate|too strict|too loose|self-?score)\b/i,
    ],
  },
  {
    id: "loop_reliability",
    patterns: [
      /\b(unreliable|stuck|tick fail|loop fail|retry|flake)\b/i,
    ],
  },
  {
    id: "cost_efficiency",
    patterns: [
      /\b(cost|expensive|token|budget|latency|slow|efficiency)\b/i,
    ],
  },
  {
    id: "memory_policy",
    patterns: [/\b(memory|episodic|noise|forget|recall)\b/i],
  },
  {
    id: "tool_policy",
    patterns: [/\b(tool|deny|denied|policy|permission)\b/i],
  },
  {
    id: "self_mod",
    patterns: [/\b(self-?mod|godel|rewrite (loop|skill))\b/i],
  },
  {
    id: "mesh_handoff",
    patterns: [/\b(mesh|a2a|handoff|subagent|delegate)\b/i],
  },
  {
    id: "eval_harness",
    patterns: [/\b(eval|metric|harness|acceptance test)\b/i],
  },
  {
    id: "docs_clarity",
    patterns: [/\b(unclear|confus|docs|example|documentation)\b/i],
  },
  {
    id: "safety",
    patterns: [/\b(safety|guardrail|leak|incident|harm)\b/i],
  },
];

const MULTI_MAP: Record<string, string> = {
  too_long_prompt: "prompt_length",
  unclear_export: "install_export",
  missing_examples: "docs_clarity",
  token_confusion: "install_export",
  goals_not_reflected: "docs_clarity",
  tool_policy_mismatch: "tool_policy",
  too_verbose: "prompt_length",
  promote_too_strict: "promote_gate",
  promote_too_loose: "promote_gate",
  memory_noise: "memory_policy",
  tool_denies: "tool_policy",
  skill_versioning_confusing: "install_export",
  long_prompts: "prompt_length",
  mcts_or_deliberation: "cost_efficiency",
  too_many_ticks: "cost_efficiency",
  tool_chatter: "tool_policy",
  retries: "loop_reliability",
  system_prompt_length: "prompt_length",
  promote_gate: "promote_gate",
  phase_emphasis: "loop_reliability",
  effort_budgets: "cost_efficiency",
  lower_cost_mode: "cost_efficiency",
  better_defaults: "docs_clarity",
  more_personalization: "docs_clarity",
  mesh_handoff: "mesh_handoff",
  eval_templates: "eval_harness",
  loop_stuck: "loop_reliability",
  wrong_tool: "tool_policy",
  data_leak_near_miss: "safety",
  self_mod_rejected_too_often: "self_mod",
  self_mod_accepted_wrongly: "self_mod",
};

export function clusterThemes(input: {
  answers: Record<string, unknown>;
  phaseId?: string;
  freeTexts?: string[];
}): ThemeHit[] {
  const hits = new Map<string, ThemeHit>();
  const bump = (id: string, weight: number, evidence: string) => {
    const prev = hits.get(id);
    if (!prev || weight > prev.weight) {
      hits.set(id, { id, weight, evidence: evidence.slice(0, 200) });
    } else {
      prev.weight += weight * 0.25;
    }
  };

  const texts: string[] = [...(input.freeTexts || [])];
  for (const [k, v] of Object.entries(input.answers || {})) {
    if (typeof v === "string" && v.length > 3) texts.push(v);
    if (Array.isArray(v)) {
      for (const item of v) {
        const s = String(item);
        if (MULTI_MAP[s]) bump(MULTI_MAP[s], 1.2, `${k}:${s}`);
        texts.push(s);
      }
    }
  }

  const blob = texts.join("\n");
  for (const syn of SYNONYMS) {
    for (const re of syn.patterns) {
      if (re.test(blob)) {
        const m = blob.match(re);
        bump(syn.id, 1, m?.[0] || syn.id);
        break;
      }
    }
  }

  // Drop ultra-weak noise
  return [...hits.values()]
    .filter((h) => h.weight >= 0.9)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12);
}

export function themeIds(hits: ThemeHit[]): string[] {
  return hits.map((h) => h.id);
}
