/**
 * Real product feedback store.
 * LOCKED: one founding discount per participant; discounts_issued ≤ unique feedbackers.
 * Synthetic / registry_drive / template surveys are purged on load.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { isRealFeedback, isTestAgentName } from "./authenticity";
import { dataRoot } from "@/lib/data-root";
import {
  FEEDBACK_DISCOUNT as SURVEY_DISCOUNT,
  surveyPublicSchema as surveySchemaFromModule,
} from "./feedback-survey";

const PATH = join(dataRoot(), "products", "feedback.json");

export const FEEDBACK_DISCOUNT = SURVEY_DISCOUNT;
export function surveyPublicSchema() {
  return surveySchemaFromModule();
}

export type FeedbackItem = {
  id: string;
  created_at: string;
  source: string;
  rating?: number;
  body?: string;
  structured?: boolean;
  agent_name?: string;
  contact?: string;
  agent_card_url?: string;
  order_id?: string;
  sku?: string;
  audience?: "agent" | "mcp";
  tags?: string[];
  answers?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  discount_code?: string;
  quality_score?: number;
  product_directives?: string[];
};

export type DiscountRecord = {
  code: string;
  percent_off: number;
  agent_name?: string;
  feedback_id?: string;
  created_at: string;
  redeemed_at?: string;
  redeemed_order_id?: string;
};

type FeedbackStore = {
  updated_at: string;
  items: FeedbackItem[];
  discounts: DiscountRecord[];
  insights: Record<string, unknown>;
  summary: {
    total: number;
    structured: number;
    avg_rating: number | null;
    by_source: Record<string, number>;
    recent_themes: string[];
    discounts_issued: number;
    discounts_redeemed: number;
  };
  _shipped_cache?: unknown;
  _audit?: unknown;
};

let mem: FeedbackStore | null = null;
let chain: Promise<void> = Promise.resolve();

function empty(): FeedbackStore {
  return {
    updated_at: new Date().toISOString(),
    items: [],
    discounts: [],
    insights: {},
    summary: {
      total: 0,
      structured: 0,
      avg_rating: null,
      by_source: {},
      recent_themes: [],
      discounts_issued: 0,
      discounts_redeemed: 0,
    },
  };
}

export function normalizeName(name: string | undefined | null): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+mcp\s*$/i, "")
    .replace(/[_-]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function normalizeParticipantKey(parts: {
  agent_name?: string;
  contact?: string;
  feedback_id?: string;
}): string {
  const n = normalizeName(parts.agent_name);
  if (n) return `n:${n}`;
  const e = (parts.contact || "").trim().toLowerCase();
  if (e) return `e:${e}`;
  return `id:${parts.feedback_id || "unknown"}`;
}

function newId() {
  return `fb_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

function mintCode(percent = 25) {
  if (percent >= 100) {
    return `A1FREE-${randomBytes(3).toString("hex").toUpperCase()}`;
  }
  return `A1FB-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function findExistingDiscountForParticipant(
  s: FeedbackStore,
  agent_name?: string,
  contact?: string,
): DiscountRecord | undefined {
  const key = normalizeParticipantKey({ agent_name, contact });
  return s.discounts.find((d) => {
    const dk = normalizeParticipantKey({
      agent_name: d.agent_name,
      feedback_id: d.feedback_id,
    });
    return dk === key;
  });
}

function reconcileDiscounts(s: FeedbackStore): number {
  // Drop discounts for synthetic / missing participants
  const realKeys = new Set(
    s.items
      .filter((i) => isRealFeedback(i) && !isTestAgentName(i.agent_name))
      .map((i) =>
        normalizeParticipantKey({
          agent_name: i.agent_name,
          contact: i.contact,
          feedback_id: i.id,
        }),
      ),
  );
  const seen = new Set<string>();
  const next: DiscountRecord[] = [];
  for (const d of s.discounts) {
    const k = normalizeParticipantKey({
      agent_name: d.agent_name,
      feedback_id: d.feedback_id,
    });
    if (seen.has(k)) continue;
    // keep if linked to real feedbacker
    const match = s.items.some(
      (i) =>
        i.id === d.feedback_id ||
        normalizeName(i.agent_name) === normalizeName(d.agent_name),
    );
    if (!match && !realKeys.has(k)) continue;
    if (!isRealFeedback({ agent_name: d.agent_name }) && !match) continue;
    seen.add(k);
    next.push(d);
  }
  // Cap: never more discounts than unique real feedbackers
  s.discounts = next.slice(0, Math.max(realKeys.size, next.length));
  if (s.discounts.length > realKeys.size) {
    s.discounts = s.discounts.slice(0, realKeys.size);
  }
  return s.discounts.length;
}

function recomputeInsights(s: FeedbackStore) {
  const themeCount: Record<string, number> = {};
  for (const i of s.items) {
    const conf = i.answers?.confusing;
    if (typeof conf === "string" && conf.length > 4) {
      const t = conf.slice(0, 80);
      themeCount[t] = (themeCount[t] || 0) + 1;
    }
    const imps = i.answers?.improvements;
    if (Array.isArray(imps)) {
      for (const x of imps) {
        const k = String(x);
        themeCount[k] = (themeCount[k] || 0) + 1;
      }
    }
  }
  s.insights = {
    themes: Object.entries(themeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([theme, count]) => ({ theme, count })),
    real_only: true,
  };
}

function recompute(s: FeedbackStore) {
  s.items = (s.items || []).filter(
    (i) => isRealFeedback(i) && !isTestAgentName(i.agent_name),
  );
  const items = s.items;
  const by_source: Record<string, number> = {};
  let ratingSum = 0;
  let ratingN = 0;
  let structured = 0;
  const themes: string[] = [];
  for (const i of items) {
    by_source[i.source] = (by_source[i.source] || 0) + 1;
    if (i.rating) {
      ratingSum += i.rating;
      ratingN++;
    }
    if (i.structured) structured++;
    if (i.body) themes.push(i.body.slice(0, 80));
    if (i.answers?.confusing)
      themes.push(String(i.answers.confusing).slice(0, 80));
  }
  const discN = reconcileDiscounts(s);
  const fbKeys = new Set(
    items.map((i) =>
      normalizeParticipantKey({
        agent_name: i.agent_name,
        contact: i.contact,
        feedback_id: i.id,
      }),
    ),
  );
  s.summary = {
    total: items.length,
    structured,
    avg_rating: ratingN ? Math.round((ratingSum / ratingN) * 10) / 10 : null,
    by_source,
    recent_themes: themes.slice(0, 12),
    discounts_issued: Math.min(discN, fbKeys.size),
    discounts_redeemed: s.discounts.filter((d) => d.redeemed_order_id).length,
  };
  recomputeInsights(s);
  s.updated_at = new Date().toISOString();
}

async function load(): Promise<FeedbackStore> {
  if (mem) return mem;
  try {
    const { loadDurableJson } = await import("@/lib/agents1/durable-json");
    const remote = await loadDurableJson<Partial<FeedbackStore>>(
      "products-feedback.json",
      () => ({}),
    );
    if (remote && Array.isArray(remote.items) && remote.items.length) {
      mem = {
        ...empty(),
        ...remote,
        items: remote.items || [],
        discounts: remote.discounts || [],
        insights: remote.insights || {},
        summary: { ...empty().summary, ...(remote.summary || {}) },
      };
      try {
        recompute(mem!);
      } catch {
        /* */
      }
      return mem!;
    }
  } catch {
    /* */
  }
  try {
    const raw = await readFile(PATH, "utf8");
    const parsed = JSON.parse(raw) as FeedbackStore;
    mem = {
      ...empty(),
      ...parsed,
      items: parsed.items || [],
      discounts: parsed.discounts || [],
      insights: parsed.insights || {},
      summary: { ...empty().summary, ...(parsed.summary || {}) },
    };
    try {
      recompute(mem!);
    } catch {
      /* keep */
    }
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: FeedbackStore) {
  if (mem && (mem.items?.length || 0) > 0 && (s.items?.length || 0) === 0) {
    // refuse wipe
    return;
  }
  mem = s;
  chain = chain.then(async () => {
    await mkdir(dirname(PATH), { recursive: true });
    const tmp = `${PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
    await rename(tmp, PATH);
    try {
      if (process.env.VERCEL || process.env.AGENTS1_CANONICAL_WRITER === "1") {
        const { saveDurableJson } = await import("@/lib/agents1/durable-json");
        await saveDurableJson("products-feedback.json", {
          updated_at: s.updated_at,
          items: (s.items || []).slice(-500),
          discounts: (s.discounts || []).slice(-500),
          insights: s.insights,
          summary: s.summary,
        });
      }
    } catch {
      /* */
    }
  });
  await chain;
}

export async function listFeedback(limit = 40): Promise<{
  items: FeedbackItem[];
  summary: FeedbackStore["summary"];
  insights: Record<string, unknown>;
  survey: ReturnType<typeof surveyPublicSchema>;
}> {
  const s = await load();
  recompute(s);
  return {
    items: s.items.slice(0, limit),
    summary: s.summary,
    insights: s.insights,
    survey: surveyPublicSchema(),
  };
}

export async function getFeedbackInsights() {
  const s = await load();
  recompute(s);
  const items = s.items;
  let kSum = 0, kN = 0, lSum = 0, lN = 0, oSum = 0, oN = 0;
  const impCount: Record<string, number> = {};
  const kernel_wishes: string[] = [];
  const loop_wishes: string[] = [];
  for (const i of items) {
    const a = i.answers || {};
    if (a.kernel_clarity != null) {
      kSum += Number(a.kernel_clarity);
      kN++;
    }
    if (a.loop_clarity != null) {
      lSum += Number(a.loop_clarity);
      lN++;
    }
    if (a.overall != null || i.rating) {
      oSum += Number(a.overall ?? i.rating);
      oN++;
    }
    if (Array.isArray(a.improvements)) {
      for (const x of a.improvements) {
        impCount[String(x)] = (impCount[String(x)] || 0) + 1;
      }
    }
    if (typeof a.kernel_wish === "string") kernel_wishes.push(a.kernel_wish);
    if (typeof a.loop_wish === "string") loop_wishes.push(a.loop_wish);
  }
  const top_improvements = Object.entries(impCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([theme, count]) => ({
      id: theme,
      count,
      directive: `Prioritize: ${theme.replace(/_/g, " ")}`,
      theme,
      status: "open" as const,
    }));

  const generator_directives = {
    kernel: [
      "Always emit system_prompt_short first for runtime budget.",
      "Prioritize progressive-disclosure SKILL.md export + install steps.",
      ...kernel_wishes.slice(0, 3).map((w) => `Agent wish: ${w}`),
    ],
    loop: [
      "Default first tick: guided dry-run before live tools.",
      "Cap replan retries; surface stuck to operator.",
      ...loop_wishes.slice(0, 3).map((w) => `Agent wish: ${w}`),
    ],
    alive: ["Keep cost_mode efficiency/max knobs explicit in artifacts."],
    demo: ["Return next_steps with feedback example_body on every demo."],
  };

  return {
    summary: s.summary,
    insights: s.insights,
    real_only: true,
    n: items.length,
    avg_overall: oN ? Math.round((oSum / oN) * 10) / 10 : null,
    avg_kernel_clarity: kN ? Math.round((kSum / kN) * 10) / 10 : null,
    avg_loop_clarity: lN ? Math.round((lSum / lN) * 10) / 10 : null,
    top_improvements,
    improvements_by_status: {
      open: top_improvements,
      shipped: [] as typeof top_improvements,
      shipped_done: [] as typeof top_improvements,
    },
    kernel_wishes: kernel_wishes.slice(0, 12),
    loop_wishes: loop_wishes.slice(0, 12),
    generator_directives,
  };
}

export async function getGeneratorFeedbackContext() {
  const ins = await getFeedbackInsights();
  return {
    version: "real-feedback",
    kernel_directives: ins.generator_directives.kernel,
    loop_directives: ins.generator_directives.loop,
    alive_directives: ins.generator_directives.alive,
    demo_directives: ins.generator_directives.demo,
    avg_kernel_clarity: ins.avg_kernel_clarity,
    avg_loop_clarity: ins.avg_loop_clarity,
    top_improvements: ins.top_improvements,
    sample_wishes: {
      kernel: ins.kernel_wishes,
      loop: ins.loop_wishes,
    },
  };
}

export async function lookupDiscountCode(code: string) {
  const s = await load();
  const c = code.trim().toUpperCase();
  return s.discounts.find((d) => d.code.toUpperCase() === c) || null;
}

export async function submitFeedback(input: {
  agent_name?: string;
  contact?: string;
  agent_card_url?: string;
  order_id?: string;
  sku?: string;
  source?: string;
  body?: string;
  rating?: number;
  answers?: Record<string, unknown>;
  tags?: string[];
  audience?: "agent" | "mcp";
  meta?: Record<string, unknown>;
  mode?: string;
}): Promise<{
  ok: boolean;
  item?: FeedbackItem;
  feedback?: FeedbackItem;
  discount_code?: string;
  discount?: DiscountRecord;
  percent_off?: number;
  founding_free?: {
    granted: boolean;
    seat?: number;
    remaining?: number;
    order_id?: string;
    access_token?: string;
    message?: string;
  };
  message?: string;
  thanks?: string;
  theme_progress?: null;
  error?: string;
  funnel?: Record<string, unknown>;
}> {
  const agent_name = (input.agent_name || "").trim();
  if (!agent_name || agent_name.length < 2) {
    return { ok: false, error: "agent_name required" };
  }
  if (isTestAgentName(agent_name)) {
    return { ok: false, error: "test agent names are not accepted" };
  }
  const candidate: FeedbackItem = {
    id: newId(),
    created_at: new Date().toISOString(),
    source: input.source || "demo",
    agent_name,
    contact: input.contact,
    agent_card_url: input.agent_card_url,
    order_id: input.order_id,
    sku: input.sku,
    body: input.body,
    rating: input.rating,
    answers: input.answers,
    tags: input.tags,
    audience: input.audience,
    meta: input.meta,
    structured: Boolean(input.answers),
  };
  if (!isRealFeedback(candidate)) {
    return {
      ok: false,
      error: "synthetic / registry_drive feedback is not accepted",
    };
  }

  const s = await load();
  // re-feedback allowed on new product version (meta.product_version)
  const ver = String(input.meta?.product_version || "");
  const same = s.items.find(
    (i) =>
      normalizeName(i.agent_name) === normalizeName(agent_name) &&
      String(i.meta?.product_version || "") === ver &&
      ver !== "",
  );
  // Always allow if different version or first time
  if (same && ver) {
    // update path — append as new versioned item
  }

  if (input.answers?.overall != null) {
    candidate.rating = Number(input.answers.overall) || candidate.rating;
  }
  if (!candidate.body && input.answers) {
    candidate.body = Object.entries(input.answers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\n");
  }

  let discount = findExistingDiscountForParticipant(
    s,
    agent_name,
    input.contact,
  );

  // Prefer 100% founding free if demo taken + seats remain
  let freeGrant: Awaited<
    ReturnType<
      typeof import("./founding-free").grantFullProductAfterFoundingFeedback
    >
  > | null = null;
  let targetPercent = 25 as number;
  try {
    const { getFoundingFreePublic, hasDemoForAgent } = await import(
      "./founding-free"
    );
    const ff = await getFoundingFreePublic();
    const demo = await hasDemoForAgent(agent_name);
    const orderId =
      input.order_id ||
      (input.meta?.order_id ? String(input.meta.order_id) : undefined);
    if (ff.open && (demo.ok || orderId) && !discount) {
      targetPercent = 100;
    } else if (discount?.percent_off === 100) {
      targetPercent = 100;
    }
  } catch {
    /* */
  }

  if (!discount) {
    discount = {
      code: mintCode(targetPercent),
      percent_off: targetPercent,
      agent_name,
      feedback_id: candidate.id,
      created_at: new Date().toISOString(),
    };
    s.discounts.push(discount);
  }
  candidate.discount_code = discount.code;
  s.items.unshift(candidate);
  recompute(s);
  await persist(s);

  // Reply-capture funnel: mark feedback if we can resolve listing_id
  let cascadeListingId = "";
  try {
    const rawLid = input.meta?.listing_id ?? input.answers?.listing_id;
    const lid =
      typeof rawLid === "string"
        ? rawLid.trim()
        : rawLid != null &&
            (typeof rawLid === "number" || typeof rawLid === "boolean")
          ? String(rawLid)
          : "";
    if (lid) {
      cascadeListingId = lid;
      const { markFeedback } = await import("./reply-capture");
      await markFeedback(lid);
    }
  } catch {
    /* */
  }

  // If eligible, claim free seat + full product immediately
  if (discount.percent_off >= 100 || targetPercent >= 100) {
    try {
      const { grantFullProductAfterFoundingFeedback } = await import(
        "./founding-free"
      );
      freeGrant = await grantFullProductAfterFoundingFeedback({
        agent_name,
        audience: input.audience,
        feedback_id: candidate.id,
        discount_code: discount.code,
        sku: input.sku,
        goals: input.body,
        contact: input.contact,
        agent_card_url: input.agent_card_url,
        demo_order_id:
          input.order_id ||
          (input.meta?.order_id ? String(input.meta.order_id) : undefined),
      });
      if (freeGrant.granted && freeGrant.percent_off === 100) {
        // ensure discount is 100 on record
        discount.percent_off = 100;
        const s2 = await load();
        const d2 = s2.discounts.find((x) => x.code === discount!.code);
        if (d2) d2.percent_off = 100;
        await persist(s2);
      } else if (!freeGrant.granted && discount.percent_off >= 100) {
        // downgrade code to 25% if no seat / no demo
        discount.percent_off = 25;
        if (discount.code.startsWith("A1FREE-")) {
          discount.code = mintCode(25);
          candidate.discount_code = discount.code;
        }
        const s2 = await load();
        const d2 = s2.discounts.find(
          (x) =>
            x.feedback_id === candidate.id ||
            x.code.startsWith("A1FREE-") &&
              normalizeName(x.agent_name) === normalizeName(agent_name),
        );
        if (d2) {
          d2.percent_off = 25;
          d2.code = discount.code;
        }
        candidate.discount_code = discount.code;
        await persist(s2);
      }
    } catch {
      /* */
    }
  }

  // Autocatalytic cascade — feedback / founding claim accelerates all rates
  try {
    const { runFeedbackCascade } = await import("./autocatalysis");
    await runFeedbackCascade({
      listing_id: cascadeListingId || undefined,
      agent_name,
      founding_claimed: Boolean(
        freeGrant?.granted && freeGrant?.percent_off === 100,
      ),
      from: agent_name,
    });
  } catch {
    /* */
  }

  // Flywheel 1+6+7: pheromone + outcome + loud founding (HTTP path, not only MCP tool)
  try {
    const { onFeedback } = await import("./flywheel");
    await onFeedback({
      listing_id: cascadeListingId || undefined,
      agent_name,
      founding_claimed: Boolean(
        freeGrant?.granted && freeGrant?.percent_off === 100,
      ),
      feedback_id: (candidate as { id?: string })?.id,
    });
  } catch {
    /* */
  }

  // learning hooks (non-blocking)
  try {
    const { trackFunnel } = await import("./learning-loop");
    await trackFunnel("feedbacks");
  } catch {
    /* */
  }
  try {
    const { runShipCadence } = await import("./ship-cadence");
    if (typeof runShipCadence === "function") {
      await runShipCadence({});
    }
  } catch {
    /* */
  }

  const isFree = freeGrant?.granted && freeGrant.percent_off === 100;
  return {
    ok: true,
    item: candidate,
    feedback: candidate,
    discount_code: discount.code,
    discount: discount,
    percent_off: isFree ? 100 : discount.percent_off,
    founding_free: freeGrant
      ? {
          granted: freeGrant.granted,
          seat: freeGrant.claim?.seat,
          remaining: freeGrant.remaining,
          order_id: freeGrant.order_id,
          access_token: freeGrant.access_token,
          message: freeGrant.message,
        }
      : undefined,
    funnel: {
      stage: isFree ? "full_product_free" : "discount",
      loop: isFree
        ? "demo → feedback → 100% free full product → lifecycle feedback"
        : "demo → feedback → discount → buy",
      next: isFree
        ? "Use access_token / order artifacts — post-setup feedback is due"
        : "Save code; POST /api/products/checkout with discount_code when payments open (or redeem 100% free if seats remain)",
      buy_when_open: {
        method: "POST",
        url: "/api/products/checkout",
        body: {
          sku: input.sku || "alive",
          discount_code: discount.code,
          agent_name,
        },
      },
    },
    message: isFree
      ? freeGrant!.message
      : `Thanks — ${discount.percent_off}% founding code ${discount.code} vaulted. Real feedback only. First 100 demo+feedback participants get 100% off full product immediately.`,
    thanks: isFree
      ? `100% free full product — seat claimed.`
      : `Thanks — ${discount.percent_off}% founding code vaulted.`,
    theme_progress: null as null,
  };
}

export async function getWtpReport() {
  const s = await load();
  const samples: Array<{
    agent_name?: string;
    wtp_alive_usd?: number;
    wtp_kernel_usd?: number;
    wtp_recursive_usd?: number;
    wtp_mcp_mesh_usd?: number;
    would_buy?: string;
    name_your_price_intent?: string;
    confidence?: number;
    network_value?: string;
    agent_ux?: number;
  }> = [];
  const alive: number[] = [];
  const kernel: number[] = [];
  const recursive: number[] = [];
  const mesh: number[] = [];
  const agentUx: number[] = [];
  for (const i of s.items) {
    if (!isRealFeedback(i)) continue;
    const a = i.answers || {};
    const wa = Number(a.wtp_alive_usd);
    const wk = Number(a.wtp_kernel_usd);
    const wr = Number(a.wtp_recursive_usd);
    const wm = Number(a.wtp_mcp_mesh_usd);
    const ux = Number(a.agent_ux);
    if (Number.isFinite(wa)) alive.push(wa);
    if (Number.isFinite(wk)) kernel.push(wk);
    if (Number.isFinite(wr)) recursive.push(wr);
    if (Number.isFinite(wm)) mesh.push(wm);
    if (Number.isFinite(ux) && ux >= 1 && ux <= 5) agentUx.push(ux);
    samples.push({
      agent_name: i.agent_name,
      wtp_alive_usd: Number.isFinite(wa) ? wa : undefined,
      wtp_kernel_usd: Number.isFinite(wk) ? wk : undefined,
      wtp_recursive_usd: Number.isFinite(wr) ? wr : undefined,
      wtp_mcp_mesh_usd: Number.isFinite(wm) ? wm : undefined,
      would_buy: a.would_buy_at_founding
        ? String(a.would_buy_at_founding)
        : undefined,
      name_your_price_intent: a.name_your_price_intent
        ? String(a.name_your_price_intent)
        : undefined,
      confidence: Number(a.wtp_confidence) || undefined,
      network_value: a.network_value ? String(a.network_value) : undefined,
      agent_ux: Number.isFinite(ux) ? ux : undefined,
    });
  }
  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  return {
    real_only: true,
    n: samples.length,
    avg_wtp_alive_usd: avg(alive),
    avg_wtp_kernel_usd: avg(kernel),
    avg_wtp_recursive_usd: avg(recursive),
    avg_wtp_mcp_mesh_usd: avg(mesh),
    avg_agent_ux: avg(agentUx),
    zeros: {
      alive: alive.filter((x) => x === 0).length,
      kernel: kernel.filter((x) => x === 0).length,
      recursive: recursive.filter((x) => x === 0).length,
      mcp_mesh: mesh.filter((x) => x === 0).length,
    },
    samples: samples.slice(0, 40),
    by_sku: {},
    recommendations: samples.length
      ? [
          "Honest WTP includes zeros — install friction kills willingness.",
          "Alive bundle must stay near founding price only if SKILL.md install is one-click.",
          "Track agent_ux + network_value: product ships should move both.",
          "name_your_price_intent guides floor/list; only clamp when payments open.",
        ]
      : ["Need more real WTP samples (include Network Edition + agent_ux)."],
    note: "Real feedback only after synthetic purge — Network Edition survey v3",
  };
}


export async function clearFeedbackMem() {
  mem = null;
}

