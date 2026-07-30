/**
 * Preference pairs (A vs B) + Bradley-Terry-ish theme weights + diversity caps.
 * Feeds Kernel/Loop defaults without overweighting loud duplicate feedback.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const PATH = join(process.cwd(), "data", "products", "preference-pairs.json");

export type PreferenceAudience = "agent" | "mcp" | "paid" | "unknown";

export type PreferencePair = {
  id: string;
  created_at: string;
  theme: string;
  dimension: "prompt_length" | "promote_gate" | "skill_install" | "other";
  variant_a: { id: string; label: string; preview: string };
  variant_b: { id: string; label: string; preview: string };
  winner: "a" | "b" | "tie" | null;
  order_id?: string;
  agent_name?: string;
  audience: PreferenceAudience;
  artifact_version?: string;
  kernel_clarity?: number;
  source: string;
};

export type ThemeWeight = {
  theme: string;
  score: number;
  n_pairs: number;
  n_a: number;
  n_b: number;
  n_tie: number;
  by_audience: Record<string, number>;
};

type Store = {
  updated_at: string;
  pairs: PreferencePair[];
  weights: Record<string, ThemeWeight>;
};

let mem: Store | null = null;

function empty(): Store {
  return { updated_at: new Date().toISOString(), pairs: [], weights: {} };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.pairs = mem!.pairs || [];
    mem!.weights = mem!.weights || {};
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

/** Canonical A/B cards for survey / agent tools */
export function preferencePairCatalog() {
  return [
    {
      id: "pair_prompt_length",
      theme: "prompt_length",
      dimension: "prompt_length" as const,
      question: "Which short Kernel prompt style is clearer for your runtime?",
      variant_a: {
        id: "short_compact",
        label: "A · Ultra-compact",
        preview:
          "# Agent kernel (short)\nGoals: …\nProducer acts; Critic scores.\nFrozen: constitution, budgets.\nPrefer reversible tools.",
      },
      variant_b: {
        id: "short_structured",
        label: "B · Structured short",
        preview:
          "# Agent kernel (short)\n## Goals\n- g1 …\n## Roles\nProducer | Critic\n## Install\nexport?format=skills\n## Safety\nConfirm irreversible.",
      },
    },
    {
      id: "pair_promote_gate",
      theme: "promote_gate",
      dimension: "promote_gate" as const,
      question: "Which promote_gate profile fits your goals better?",
      variant_a: {
        id: "strict",
        label: "A · Strict (quality)",
        preview:
          "low_risk critic≥0.70 · draft≥0.65 · max_replans=2 · safety_flags must be 0",
      },
      variant_b: {
        id: "draft_friendly",
        label: "B · Draft-friendly",
        preview:
          "low_risk critic≥0.62 · draft≥0.58 · max_replans=2 · safety_flags must be 0",
      },
    },
  ];
}

export async function recordPreferencePair(input: {
  pair_id?: string;
  theme?: string;
  dimension?: PreferencePair["dimension"];
  winner: "a" | "b" | "tie";
  order_id?: string;
  agent_name?: string;
  audience?: PreferenceAudience;
  artifact_version?: string;
  kernel_clarity?: number;
  source?: string;
  variant_a_preview?: string;
  variant_b_preview?: string;
}): Promise<PreferencePair> {
  const catalog = preferencePairCatalog();
  const card =
    catalog.find((c) => c.id === input.pair_id) ||
    catalog.find((c) => c.theme === input.theme) ||
    catalog[0];
  const s = await load();
  const pair: PreferencePair = {
    id: `pref_${Date.now().toString(36)}_${randomBytes(2).toString("hex")}`,
    created_at: new Date().toISOString(),
    theme: input.theme || card.theme,
    dimension: input.dimension || card.dimension,
    variant_a: {
      ...card.variant_a,
      preview: input.variant_a_preview || card.variant_a.preview,
    },
    variant_b: {
      ...card.variant_b,
      preview: input.variant_b_preview || card.variant_b.preview,
    },
    winner: input.winner,
    order_id: input.order_id,
    agent_name: input.agent_name,
    audience: input.audience || "unknown",
    artifact_version: input.artifact_version,
    kernel_clarity: input.kernel_clarity,
    source: input.source || "survey",
  };
  s.pairs.unshift(pair);
  s.pairs = s.pairs.slice(0, 2000);
  recomputeWeights(s);
  s.updated_at = pair.created_at;
  await persist(s);
  return pair;
}

function recomputeWeights(s: Store) {
  const byTheme: Record<
    string,
    {
      a: number;
      b: number;
      tie: number;
      aud: Record<string, number>;
    }
  > = {};
  // Diversity: max 3 pairs/day/audience per theme when scoring
  const dayAud: Record<string, number> = {};
  for (const p of s.pairs) {
    if (!p.winner) continue;
    const day = p.created_at.slice(0, 10);
    const key = `${p.theme}|${day}|${p.audience}`;
    dayAud[key] = (dayAud[key] || 0) + 1;
    const weight = dayAud[key] <= 3 ? 1 : 0.25; // down-weight spam
    if (!byTheme[p.theme])
      byTheme[p.theme] = { a: 0, b: 0, tie: 0, aud: {} };
    if (p.winner === "a") byTheme[p.theme].a += weight;
    else if (p.winner === "b") byTheme[p.theme].b += weight;
    else byTheme[p.theme].tie += weight;
    byTheme[p.theme].aud[p.audience] =
      (byTheme[p.theme].aud[p.audience] || 0) + weight;
  }

  const weights: Record<string, ThemeWeight> = {};
  for (const [theme, t] of Object.entries(byTheme)) {
    const n = t.a + t.b + t.tie;
    // Bradley-Terry-ish: P(A>B) ≈ a/(a+b); score in [-1,1] where + favors A
    const score = t.a + t.b > 0 ? (t.a - t.b) / (t.a + t.b) : 0;
    weights[theme] = {
      theme,
      score: Math.round(score * 1000) / 1000,
      n_pairs: n,
      n_a: t.a,
      n_b: t.b,
      n_tie: t.tie,
      by_audience: t.aud,
    };
  }
  s.weights = weights;
}

/** Cap generator directive share from one audience at 40% */
export function diversifyDirectives(
  items: Array<{ text: string; audience?: string }>,
  maxShare = 0.4,
): string[] {
  if (!items.length) return [];
  const counts: Record<string, number> = {};
  const out: string[] = [];
  const maxPer = Math.max(1, Math.floor(items.length * maxShare));
  for (const it of items) {
    const aud = it.audience || "unknown";
    counts[aud] = counts[aud] || 0;
    if (counts[aud] >= maxPer) continue;
    // near-duplicate collapse
    const norm = it.text.toLowerCase().slice(0, 80);
    if (out.some((o) => o.toLowerCase().slice(0, 80) === norm)) continue;
    counts[aud]++;
    out.push(it.text);
  }
  return out.slice(0, 12);
}

export async function getPreferenceReport() {
  const s = await load();
  recomputeWeights(s);
  await persist(s);
  const catalog = preferencePairCatalog();
  return {
    catalog,
    weights: s.weights,
    recent: s.pairs.slice(0, 20).map((p) => ({
      id: p.id,
      theme: p.theme,
      winner: p.winner,
      audience: p.audience,
      at: p.created_at,
    })),
    recommendations: Object.values(s.weights).map((w) => ({
      theme: w.theme,
      prefer:
        w.score > 0.15 ? "variant_a" : w.score < -0.15 ? "variant_b" : "tie",
      score: w.score,
      n: w.n_pairs,
    })),
    n_pairs: s.pairs.length,
    updated_at: s.updated_at,
  };
}

/** Defaults implied by pair winners for generators */
export async function getPreferenceDrivenDefaults(): Promise<{
  prompt_style: "ultra_compact" | "structured_short" | "default";
  promote_profile: "strict" | "draft_friendly" | "default";
  weights: Record<string, ThemeWeight>;
}> {
  const s = await load();
  recomputeWeights(s);
  const pl = s.weights.prompt_length;
  const pg = s.weights.promote_gate;
  return {
    prompt_style:
      pl && pl.n_pairs >= 2
        ? pl.score >= 0
          ? "ultra_compact"
          : "structured_short"
        : "default",
    promote_profile:
      pg && pg.n_pairs >= 2
        ? pg.score >= 0
          ? "strict"
          : "draft_friendly"
        : "default",
    weights: s.weights,
  };
}
