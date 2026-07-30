/**
 * Product gap discovery + learning loop.
 * Continuously records conversion/product gaps so Agents1 always improves offers.
 * No model API — heuristic signals + structured backlog.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PRODUCTS } from "./catalog";
import { listFulfilledOrders } from "./orders";
import { getFeedbackInsights } from "./feedback";
import { lifecycleInsightsForLearning } from "./feedback-lifecycle";
import { listReviewQueue } from "./system-ship";

const PATH = join(process.cwd(), "data", "products", "learning.json");

export type GapId =
  | "no_preview_used"
  | "human_only_checkout"
  | "no_skills_export"
  | "no_alive_badge"
  | "goals_too_short"
  | "demo_without_stripe"
  | "kernel_without_loop"
  | "loop_without_kernel"
  | "no_agent_card_url"
  | "no_callback"
  | "discovery_schema_stale";

export type GapRecord = {
  id: string;
  title: string;
  severity: "low" | "medium" | "high";
  evidence: string[];
  product_action: string;
  method_fit: string[];
  count: number;
  last_seen: string;
};

export type LearningState = {
  updated_at: string;
  cycles: number;
  gaps: Record<string, GapRecord>;
  recommendations: string[];
  funnel: {
    previews: number;
    checkouts: number;
    demos: number;
    paid: number;
    exports: number;
    verifies: number;
    feedbacks: number;
    conversions_shown: number;
  };
  offered_best: {
    sku_order: string[];
    pitch: string;
  };
};

const SEED_GAPS: Omit<GapRecord, "count" | "last_seen">[] = [
  {
    id: "no_preview_used",
    title: "Agents buy without free preview",
    severity: "medium",
    evidence: [],
    product_action: "Surface POST /api/products/preview on list + discovery",
    method_fit: ["free_taste", "conversion"],
  },
  {
    id: "human_only_checkout",
    title: "Checkout requires human browser",
    severity: "high",
    evidence: [],
    product_action: "Push agent tool buy_product + machine schema",
    method_fit: ["agent_native_pay", "mcp_tools"],
  },
  {
    id: "no_skills_export",
    title: "Artifacts not installed as SKILL.md",
    severity: "high",
    evidence: [],
    product_action: "Always link export after fulfill",
    method_fit: ["progressive_disclosure", "skill_md"],
  },
  {
    id: "no_alive_badge",
    title: "Alive buyers not reflected in free score",
    severity: "medium",
    evidence: [],
    product_action: "Score boost + list badge via certificate",
    method_fit: ["reputation_coupling"],
  },
];

function empty(): LearningState {
  const gaps: Record<string, GapRecord> = {};
  const now = new Date().toISOString();
  for (const g of SEED_GAPS) {
    gaps[g.id] = { ...g, count: 0, last_seen: now };
  }
  return {
    updated_at: now,
    cycles: 0,
    gaps,
    recommendations: [],
    funnel: {
      previews: 0,
      checkouts: 0,
      demos: 0,
      paid: 0,
      exports: 0,
      verifies: 0,
      feedbacks: 0,
      conversions_shown: 0,
    },
    offered_best: {
      sku_order: ["alive", "kernel", "recursive"],
      pitch:
        "Alive Bundle: Kernel + Loop + curriculum — best value and score badge",
    },
  };
}

let mem: LearningState | null = null;

async function load(): Promise<LearningState> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    const parsed = JSON.parse(raw) as LearningState;
    const base = empty();
    mem = {
      ...base,
      ...parsed,
      funnel: { ...base.funnel, ...(parsed.funnel || {}) },
      gaps: { ...base.gaps, ...(parsed.gaps || {}) },
    };
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: LearningState) {
  mem = s;
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

export async function trackFunnel(
  event: keyof LearningState["funnel"],
  meta?: { gap?: GapId; evidence?: string },
) {
  const s = await load();
  s.funnel[event] = (s.funnel[event] || 0) + 1;
  if (meta?.gap) {
    const g = s.gaps[meta.gap] || {
      id: meta.gap,
      title: meta.gap,
      severity: "medium" as const,
      evidence: [] as string[],
      product_action: "Review product learning backlog",
      method_fit: [] as string[],
      count: 0,
      last_seen: new Date().toISOString(),
    };
    g.count += 1;
    g.last_seen = new Date().toISOString();
    if (meta.evidence) {
      g.evidence = [...g.evidence.slice(-19), meta.evidence];
    }
    s.gaps[meta.gap] = g;
  }
  s.updated_at = new Date().toISOString();
  await persist(s);
  return s;
}

export async function runProductLearningCycle() {
  const s = await load();
  s.cycles += 1;
  const orders = await listFulfilledOrders();
  const now = new Date().toISOString();

  const bump = (id: GapId, evidence: string, severity?: GapRecord["severity"]) => {
    const base = SEED_GAPS.find((g) => g.id === id);
    const g = s.gaps[id] || {
      id,
      title: base?.title || id,
      severity: severity || base?.severity || "medium",
      evidence: [] as string[],
      product_action: base?.product_action || "Improve product surface",
      method_fit: base?.method_fit || [],
      count: 0,
      last_seen: now,
    };
    g.count += 1;
    g.last_seen = now;
    g.evidence = [...g.evidence.slice(-19), evidence];
    if (severity) g.severity = severity;
    s.gaps[id] = g;
  };

  for (const o of orders) {
    if (!o.agent_card_url) bump("no_agent_card_url", o.id);
    if (!o.callback_url) bump("no_callback", o.id);
    if (o.status === "demo") bump("demo_without_stripe", o.id, "low");
    if (o.sku === "kernel") bump("kernel_without_loop", o.id, "low");
    if (o.sku === "recursive") bump("loop_without_kernel", o.id, "medium");
    if ((o.goals.goals || "").trim().length < 40) bump("goals_too_short", o.id);
  }

  if (s.funnel.checkouts > 0 && s.funnel.previews === 0) {
    bump("no_preview_used", "checkouts without previews", "high");
  }
  if (s.funnel.exports < s.funnel.demos + s.funnel.paid) {
    bump(
      "no_skills_export",
      `exports ${s.funnel.exports} < fulfills ${s.funnel.demos + s.funnel.paid}`,
      "high",
    );
  }
  if (s.funnel.verifies === 0 && orders.some((o) => o.sku === "alive")) {
    bump("no_alive_badge", "alive orders but zero verify calls", "medium");
  }

  // Rank recommendations
  const ranked = Object.values(s.gaps).sort((a, b) => {
    const sev = { high: 3, medium: 2, low: 1 };
    return sev[b.severity] * 100 + b.count - (sev[a.severity] * 100 + a.count);
  });

  s.recommendations = ranked.slice(0, 8).map(
    (g) =>
      `[${g.severity}] ${g.title} (×${g.count}) → ${g.product_action} · methods: ${g.method_fit.join(", ") || "—"}`,
  );

  // Always-best offer logic
  const aliveCount = orders.filter((o) => o.sku === "alive").length;
  const kernelOnly = orders.filter((o) => o.sku === "kernel").length;
  const loopOnly = orders.filter((o) => o.sku === "recursive").length;
  if (kernelOnly + loopOnly > aliveCount) {
    s.offered_best = {
      sku_order: ["alive", "kernel", "recursive"],
      pitch: `Prefer Alive Bundle ($${(PRODUCTS.alive.price_cents / 100).toFixed(2)} founding): buyers of single SKUs miss curriculum + score badge. Bundle upsell active.`,
    };
  } else {
    s.offered_best = {
      sku_order: ["alive", "recursive", "kernel"],
      pitch: "Alive Bundle remains best default; Loop is secondary for self-improvers with existing kernels.",
    };
  }

  try {
    const ins = await getFeedbackInsights();
    if (ins.n > 0) {
      s.recommendations.unshift(
        `[feedback] ${ins.n} surveys · kernel clarity ${ins.avg_kernel_clarity ?? "—"}/5 · loop clarity ${ins.avg_loop_clarity ?? "—"}/5`,
      );
      for (const d of ins.generator_directives.kernel.slice(0, 3)) {
        s.recommendations.push(`[kernel←feedback] ${d}`);
      }
      for (const d of ins.generator_directives.loop.slice(0, 3)) {
        s.recommendations.push(`[loop←feedback] ${d}`);
      }
      for (const imp of ins.top_improvements.slice(0, 3)) {
        s.recommendations.push(
          `[demand×${imp.count}] ${imp.id} → ${imp.directive}`,
        );
      }
      s.recommendations = s.recommendations.slice(0, 16);
    } else if (s.funnel.demos > s.funnel.feedbacks) {
      s.recommendations.unshift(
        `[high] Demos ${s.funnel.demos} ≫ feedbacks ${s.funnel.feedbacks} — push survey + 25% discount harder`,
      );
    }
  } catch {
    /* */
  }


  try {
    const rq = await listReviewQueue();
    const waiting = rq.queue.filter((i) => i.status === "in_review" || i.status === "canary");
    if (waiting.length) {
      s.recommendations.unshift(
        `[review] ${waiting.length} system themes need human action (canary/ship/reject) — GET /api/products/review`,
      );
      for (const w of waiting.slice(0, 3)) {
        s.recommendations.push(
          `[${w.severity}/${w.status}] ${w.theme} ×${w.count} → ${w.product_action}`,
        );
      }
    }
  } catch {
    /* */
  }

  try {
    const life = await lifecycleInsightsForLearning();
    s.recommendations.unshift(
      `[lifecycle] enrolled ${life.metrics.enrolled} · responses ${life.metrics.responses} · individualized ${life.metrics.individualized}`,
    );
    for (const r of life.recommendations.slice(0, 6)) {
      s.recommendations.push(r);
    }
    for (const th of life.top_system_themes.slice(0, 4)) {
      const g = s.gaps[`life_${th.theme}`] || {
        id: `life_${th.theme}`,
        title: `Lifecycle theme: ${th.theme}`,
        severity: th.severity,
        evidence: th.sample_evidence.slice(-5),
        product_action: th.product_action,
        method_fit: ["system_vs_individual", "personalization"],
        count: th.count,
        last_seen: now,
      };
      g.count = th.count;
      g.severity = th.severity;
      g.evidence = th.sample_evidence.slice(-8);
      g.last_seen = now;
      s.gaps[`life_${th.theme}`] = g;
    }
    s.recommendations = s.recommendations.slice(0, 20);
  } catch {
    /* */
  }

  s.updated_at = now;
  await persist(s);
  return s;
}

export async function getLearningPublic() {
  const s = await runProductLearningCycle();
  return {
    ok: true,
    updated_at: s.updated_at,
    cycles: s.cycles,
    funnel: s.funnel,
    offered_best: s.offered_best,
    top_gaps: Object.values(s.gaps)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((g) => ({
        id: g.id,
        title: g.title,
        severity: g.severity,
        count: g.count,
        product_action: g.product_action,
        method_fit: g.method_fit,
      })),
    recommendations: s.recommendations,
    products: Object.values(PRODUCTS).map((p) => ({
      sku: p.sku,
      name: p.name,
      price_cents: p.price_cents,
    })),
  };
}
