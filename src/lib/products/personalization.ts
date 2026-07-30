/**
 * Per-agent individualized Kernel / Loop experience overrides.
 * Applied on regenerate / access for that order only — not global generators
 * unless promoted via lifecycle decision engine.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

const PATH = join(process.cwd(), "data", "products", "personalization.json");

export type AgentPersonalization = {
  order_id: string;
  agent_name?: string;
  agent_card_url?: string;
  sku?: string;
  created_at: string;
  updated_at: string;
  /** Free-text directives folded into that agent's kernel */
  kernel_directives: string[];
  loop_directives: string[];
  alive_directives: string[];
  /** Structured knobs — preference card */
  knobs: {
    prefer_short_prompt?: boolean;
    max_prompt_chars?: number;
    promote_gate_bias?: "stricter" | "looser" | "default";
    promote_profile?: "strict" | "draft_friendly" | "default";
    phase_emphasis?: string[];
    effort_cap?: "low" | "medium" | "high";
    cost_mode?: "efficiency" | "balanced" | "quality";
    tool_policy_notes?: string[];
    rejected_phrases?: string[];
    liked_examples?: string[];
    prompt_style?: "ultra_compact" | "structured_short" | "default";
  };
  source_phases: string[];
  notes: string[];
  /** Estimated relative cost multiplier after personalization (1 = baseline) */
  estimated_cost_multiplier: number;
  estimated_quality_delta: number; // -1..+1 rough
};

type Store = {
  updated_at: string;
  by_order: Record<string, AgentPersonalization>;
};

let mem: Store | null = null;

function empty(): Store {
  return { updated_at: new Date().toISOString(), by_order: {} };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.by_order = mem!.by_order || {};
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: Store) {
  mem = s;
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

export async function getPersonalization(orderId: string) {
  const s = await load();
  return s.by_order[orderId] || null;
}

export async function listPersonalizations() {
  const s = await load();
  return Object.values(s.by_order);
}

export async function upsertPersonalization(
  orderId: string,
  patch: Partial<AgentPersonalization> & {
    agent_name?: string;
    agent_card_url?: string;
    sku?: string;
  },
): Promise<AgentPersonalization> {
  const s = await load();
  const now = new Date().toISOString();
  const prev = s.by_order[orderId] || {
    order_id: orderId,
    created_at: now,
    updated_at: now,
    kernel_directives: [],
    loop_directives: [],
    alive_directives: [],
    knobs: {},
    source_phases: [],
    notes: [],
    estimated_cost_multiplier: 1,
    estimated_quality_delta: 0,
  };
  const next: AgentPersonalization = {
    ...prev,
    ...patch,
    order_id: orderId,
    agent_name: patch.agent_name ?? prev.agent_name,
    agent_card_url: patch.agent_card_url ?? prev.agent_card_url,
    sku: patch.sku ?? prev.sku,
    kernel_directives: uniq([
      ...prev.kernel_directives,
      ...(patch.kernel_directives || []),
    ]).slice(0, 24),
    loop_directives: uniq([
      ...prev.loop_directives,
      ...(patch.loop_directives || []),
    ]).slice(0, 24),
    alive_directives: uniq([
      ...prev.alive_directives,
      ...(patch.alive_directives || []),
    ]).slice(0, 16),
    knobs: { ...prev.knobs, ...(patch.knobs || {}) },
    source_phases: uniq([
      ...prev.source_phases,
      ...(patch.source_phases || []),
    ]),
    notes: [...prev.notes, ...(patch.notes || [])].slice(-40),
    updated_at: now,
  };
  // Recompute cost/quality from knobs
  next.estimated_cost_multiplier = costMultiplier(next.knobs);
  next.estimated_quality_delta = qualityDelta(next.knobs, next);
  s.by_order[orderId] = next;
  s.updated_at = now;
  await persist(s);
  return next;
}

function uniq(a: string[]) {
  return [...new Set(a.map((x) => x.trim()).filter(Boolean))];
}

function costMultiplier(k: AgentPersonalization["knobs"]): number {
  let m = 1;
  if (k.prefer_short_prompt) m *= 0.82;
  if (k.cost_mode === "efficiency") m *= 0.75;
  if (k.cost_mode === "quality") m *= 1.25;
  if (k.effort_cap === "low") m *= 0.7;
  if (k.effort_cap === "high") m *= 1.35;
  if (k.promote_gate_bias === "looser") m *= 0.95; // fewer retries sometimes
  if (k.promote_gate_bias === "stricter") m *= 1.1; // more critic passes
  return Math.round(m * 100) / 100;
}

function qualityDelta(
  k: AgentPersonalization["knobs"],
  p: AgentPersonalization,
): number {
  let q = 0;
  if (k.cost_mode === "quality" || k.effort_cap === "high") q += 0.15;
  if (k.cost_mode === "efficiency" || k.effort_cap === "low") q -= 0.08;
  if (k.prefer_short_prompt) q -= 0.03;
  if (p.kernel_directives.length + p.loop_directives.length > 0) q += 0.1;
  if (k.promote_gate_bias === "stricter") q += 0.05;
  return Math.round(Math.max(-0.5, Math.min(0.5, q)) * 100) / 100;
}

/** Context for generate.ts for a single agent order */
export async function personalizationAsFeedbackCtx(orderId: string) {
  const p = await getPersonalization(orderId);
  if (!p) return null;
  return {
    version: `personal:${orderId}`,
    kernel_directives: [
      ...p.kernel_directives,
      p.knobs.prefer_short_prompt
        ? "Prefer system_prompt_short; keep full prompt as reference only"
        : "",
      p.knobs.max_prompt_chars
        ? `Cap system_prompt_short at ${p.knobs.max_prompt_chars} chars`
        : "",
      p.knobs.prompt_style === "ultra_compact"
        ? "Use ultra-compact short prompt layout (A won preference pair)"
        : "",
      p.knobs.prompt_style === "structured_short"
        ? "Use structured short prompt layout (B won preference pair)"
        : "",
      p.knobs.rejected_phrases?.length
        ? `Never emit: ${p.knobs.rejected_phrases.slice(0, 5).join(" | ")}`
        : "",
      p.knobs.liked_examples?.length
        ? `Prefer patterns like: ${p.knobs.liked_examples.slice(0, 3).join(" | ")}`
        : "",
      p.knobs.cost_mode === "efficiency"
        ? "Bias tool calls and deliberation toward minimum effective spend"
        : "",
      p.knobs.tool_policy_notes?.length
        ? `Tool notes: ${p.knobs.tool_policy_notes.join("; ")}`
        : "",
    ].filter(Boolean),
    loop_directives: [
      ...p.loop_directives,
      p.knobs.promote_gate_bias === "looser" ||
      p.knobs.promote_profile === "draft_friendly"
        ? "Relax promote_gate slightly for low-risk/draft goals (agent-specific)"
        : "",
      p.knobs.promote_gate_bias === "stricter" ||
      p.knobs.promote_profile === "strict"
        ? "Tighten promote_gate; require stronger critic evidence (agent-specific)"
        : "",
      p.knobs.phase_emphasis?.length
        ? `Emphasize phases: ${p.knobs.phase_emphasis.join(", ")}`
        : "",
      p.knobs.effort_cap
        ? `Cap effort tier at ${p.knobs.effort_cap} unless human override`
        : "",
    ].filter(Boolean),
    alive_directives: p.alive_directives,
    demo_directives: [],
    avg_kernel_clarity: null,
    avg_loop_clarity: null,
    top_improvements: [],
    sample_wishes: {
      kernel: p.kernel_directives.slice(0, 3),
      loop: p.loop_directives.slice(0, 3),
    },
    knobs: p.knobs,
    estimated_cost_multiplier: p.estimated_cost_multiplier,
    estimated_quality_delta: p.estimated_quality_delta,
  };
}
