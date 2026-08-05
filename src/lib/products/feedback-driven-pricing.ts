/**
 * Feedback-driven pricing — list + per-call prices move with honest WTP
 * from agents, MCPs, and human operators.
 *
 * Base catalog stays the anchor. With enough real WTP samples we blend
 * toward the median (zeros allowed). Cache is durable so resolve paths
 * stay sync-friendly.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import {
  LAUNCH_PRICES,
  formatUsd,
  type ProductSku,
} from "./catalog";

export const FEEDBACK_PRICING_VERSION = "1.0.0";
export const MIN_WTP_SAMPLES = 3;
export const STRONG_WTP_SAMPLES = 8;

/** Rolling spend gate: free Collab Lab when paid kernel+loop events ≥ this (USD / 30d) */
export const COLLAB_SPEND_FREE_USD = 5;
export const COLLAB_SPEND_WINDOW_DAYS = 30;

/** One-time Collab Lab license (BYO API path) — founding list before WTP blend */
export const COLLAB_LAB_LICENSE_BASE_CENTS = 4900; // $49.00

export type AudienceBucket = "agent" | "mcp" | "human" | "unknown";

export type FeedbackPriceState = {
  version: string;
  updated_at: string;
  sample_n: number;
  by_audience: Record<AudienceBucket, number>;
  /** Effective list prices (cents) after feedback blend */
  list_cents: Record<string, number>;
  /** Effective per-call event prices (cents) */
  event_cents: Record<string, number>;
  /** Free/day allowances (may rise when fairness feedback is low-price heavy) */
  event_free_per_day: Record<string, number>;
  /** Diagnostic medians (USD) */
  wtp_median_usd: Partial<Record<string, number | null>>;
  method: string;
  note: string;
  recommendations: string[];
};

type EventCatalogEntry = {
  id: string;
  product: string;
  free_per_day: number;
  price_cents: number;
  always_free?: boolean;
};

const PATH = join(dataRoot(), "products", "feedback-prices.json");
let mem: FeedbackPriceState | null = null;

/** Founding event bases (mirror event-pricing EVENT_CATALOG) — avoids ESM require cycles. */
const BASE_EVENT_CATALOG: Record<string, EventCatalogEntry> = {
  improve_kernel: { id: "improve_kernel", product: "kernel", free_per_day: 3, price_cents: 25 },
  run_loop_tick: { id: "run_loop_tick", product: "recursive", free_per_day: 3, price_cents: 25 },
  mesh_match: { id: "mesh_match", product: "mcp_mesh", free_per_day: 5, price_cents: 10 },
  mesh_compose: { id: "mesh_compose", product: "mcp_mesh", free_per_day: 2, price_cents: 20 },
  network_sense: { id: "network_sense", product: "network", free_per_day: 10, price_cents: 2, always_free: true },
  collab_session_open: { id: "collab_session_open", product: "collab", free_per_day: 2, price_cents: 15 },
  collab_session_step: { id: "collab_session_step", product: "collab", free_per_day: 12, price_cents: 5 },
  collab_converge: { id: "collab_converge", product: "collab", free_per_day: 2, price_cents: 30 },
  collab_package: { id: "collab_package", product: "collab", free_per_day: 1, price_cents: 50 },
  collab_publish: { id: "collab_publish", product: "collab", free_per_day: 1, price_cents: 25 },
  collab_talk: { id: "collab_talk", product: "collab", free_per_day: 30, price_cents: 2, always_free: true },
};

function loadEventCatalog(): Record<string, EventCatalogEntry> {
  try {
    // Lazy require when CJS available
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./event-pricing") as {
      EVENT_CATALOG?: Record<string, EventCatalogEntry>;
    };
    if (mod?.EVENT_CATALOG && Object.keys(mod.EVENT_CATALOG).length) {
      return mod.EVENT_CATALOG;
    }
  } catch {
    /* ESM path — use base mirror */
  }
  return BASE_EVENT_CATALOG;
}

function round99(cents: number): number {
  const dollars = Math.max(1, Math.round(cents / 100));
  return dollars * 100 - 1;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid];
  return Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
}

function parseUsd(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function blendCents(
  baseCents: number,
  medianUsd: number | null,
  n: number,
): { cents: number; used: boolean } {
  if (medianUsd == null || n < MIN_WTP_SAMPLES) {
    return { cents: baseCents, used: false };
  }
  const medianCents = Math.round(medianUsd * 100);
  const w =
    n >= STRONG_WTP_SAMPLES
      ? 0.85
      : 0.35 +
        ((n - MIN_WTP_SAMPLES) / (STRONG_WTP_SAMPLES - MIN_WTP_SAMPLES)) * 0.5;
  const blended = Math.round(w * medianCents + (1 - w) * baseCents);
  // Seat prices (.99) keep $0.50 floor; per-call events may be pennies
  const floor =
    baseCents >= 100
      ? Math.max(50, Math.round(baseCents * 0.5))
      : Math.max(1, Math.round(baseCents * 0.4));
  const ceiling = Math.round(baseCents * 3);
  const clamped = Math.min(ceiling, Math.max(floor, blended));
  if (baseCents >= 100) return { cents: round99(clamped), used: true };
  return { cents: Math.max(1, clamped), used: true };
}

function emptyState(): FeedbackPriceState {
  const list_cents: Record<string, number> = { ...LAUNCH_PRICES };
  if (!list_cents.collab_lab_license) {
    list_cents.collab_lab_license = COLLAB_LAB_LICENSE_BASE_CENTS;
  }
  const event_cents: Record<string, number> = {};
  const event_free_per_day: Record<string, number> = {};
  for (const [id, def] of Object.entries(loadEventCatalog())) {
    event_cents[id] = def.price_cents;
    event_free_per_day[id] = def.free_per_day;
  }
  return {
    version: FEEDBACK_PRICING_VERSION,
    updated_at: new Date().toISOString(),
    sample_n: 0,
    by_audience: { agent: 0, mcp: 0, human: 0, unknown: 0 },
    list_cents,
    event_cents,
    event_free_per_day,
    wtp_median_usd: {},
    method: "base_catalog",
    note: "No WTP samples yet — using founding catalog. Leave feedback with wtp_* fields to move prices.",
    recommendations: [
      "Collect ≥3 honest WTP samples (agents + MCPs + humans) to unlock feedback-driven list prices",
    ],
  };
}

async function loadCache(): Promise<FeedbackPriceState> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...emptyState(), ...JSON.parse(raw) };
    return mem!;
  } catch {
    mem = emptyState();
    return mem;
  }
}

async function persist(s: FeedbackPriceState) {
  mem = s;
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

/** Sync peek — uses last recompute (call recompute after feedback). */
export function getFeedbackPriceStateSync(): FeedbackPriceState {
  return mem || emptyState();
}

export async function getFeedbackPriceState(): Promise<FeedbackPriceState> {
  return loadCache();
}

function audienceOf(item: {
  audience?: string;
  answers?: Record<string, unknown>;
  source?: string;
}): AudienceBucket {
  const role = String(item.answers?.audience_role || "").toLowerCase();
  if (role.includes("human") || role === "human_operator") return "human";
  if (role.includes("mcp") || item.audience === "mcp") return "mcp";
  if (role.includes("agent") || item.audience === "agent") return "agent";
  if (item.source === "operator_try" || item.source === "human") return "human";
  if (item.audience === "mcp") return "mcp";
  if (item.audience === "agent") return "agent";
  return "unknown";
}

type WtpBuckets = {
  kernel: number[];
  recursive: number[];
  alive: number[];
  mcp_mesh: number[];
  collab_pack: number[];
  collab_lab_license: number[];
  events: Record<string, number[]>;
  fairness: number[];
};

function collectFromAnswers(
  answers: Record<string, unknown> | undefined,
  buckets: WtpBuckets,
) {
  if (!answers) return;
  const pushSku = (key: keyof WtpBuckets, field: string) => {
    if (key === "events" || key === "fairness") return;
    const v = parseUsd(answers[field]);
    if (v != null) (buckets[key] as number[]).push(v);
  };
  pushSku("kernel", "wtp_kernel_usd");
  pushSku("recursive", "wtp_recursive_usd");
  pushSku("alive", "wtp_alive_usd");
  pushSku("mcp_mesh", "wtp_mcp_mesh_usd");
  pushSku("collab_pack", "wtp_collab_pack_usd");
  pushSku("collab_lab_license", "wtp_collab_lab_license_usd");

  const eventFields: Array<[string, string]> = [
    ["improve_kernel", "wtp_event_improve_kernel_usd"],
    ["run_loop_tick", "wtp_event_run_loop_tick_usd"],
    ["mesh_match", "wtp_event_mesh_match_usd"],
    ["mesh_compose", "wtp_event_mesh_compose_usd"],
    ["collab_session_open", "wtp_event_collab_session_usd"],
    ["collab_session_step", "wtp_event_collab_step_usd"],
    ["collab_converge", "wtp_event_collab_converge_usd"],
    ["collab_package", "wtp_event_collab_package_usd"],
    ["collab_publish", "wtp_event_collab_publish_usd"],
  ];
  for (const [eid, field] of eventFields) {
    const v = parseUsd(answers[field]);
    if (v == null) continue;
    if (!buckets.events[eid]) buckets.events[eid] = [];
    buckets.events[eid].push(v);
  }

  const fair = Number(answers.pricing_fairness);
  if (Number.isFinite(fair) && fair >= 1 && fair <= 5) buckets.fairness.push(fair);
}

/**
 * Recompute list + event prices from real feedback WTP.
 * Call after every accepted leave_feedback.
 */
export async function recomputeFeedbackDrivenPrices(): Promise<FeedbackPriceState> {
  const state = emptyState();
  let items: Array<{
    audience?: string;
    answers?: Record<string, unknown>;
    source?: string;
    agent_name?: string;
  }> = [];

  try {
    const { listFeedback } = await import("./feedback");
    const listed = await listFeedback(500);
    items = (listed.items || []) as typeof items;
  } catch {
    try {
      const raw = await readFile(
        join(dataRoot(), "products", "feedback.json"),
        "utf8",
      );
      const parsed = JSON.parse(raw);
      items = parsed.items || [];
    } catch {
      items = [];
    }
  }

  const buckets: WtpBuckets = {
    kernel: [],
    recursive: [],
    alive: [],
    mcp_mesh: [],
    collab_pack: [],
    collab_lab_license: [],
    events: {},
    fairness: [],
  };

  for (const it of items) {
    const aud = audienceOf(it);
    state.by_audience[aud] = (state.by_audience[aud] || 0) + 1;
    collectFromAnswers(it.answers, buckets);
  }

  state.sample_n =
    buckets.kernel.length +
    buckets.recursive.length +
    buckets.alive.length +
    buckets.mcp_mesh.length +
    buckets.collab_pack.length +
    buckets.collab_lab_license.length;

  const recs: string[] = [];
  let anyBlend = false;

  const applySku = (sku: string, samples: number[], base: number) => {
    const med = median(samples);
    state.wtp_median_usd[sku] = med;
    const { cents, used } = blendCents(base, med, samples.length);
    state.list_cents[sku] = cents;
    if (used) {
      anyBlend = true;
      recs.push(
        `${sku}: feedback-driven list ${formatUsd(cents)} (median WTP $${med} · n=${samples.length}; base ${formatUsd(base)})`,
      );
    } else if (samples.length > 0) {
      recs.push(
        `${sku}: n=${samples.length} WTP samples (need ${MIN_WTP_SAMPLES}) — still at base ${formatUsd(base)}`,
      );
    }
  };

  applySku("kernel", buckets.kernel, LAUNCH_PRICES.kernel);
  applySku("recursive", buckets.recursive, LAUNCH_PRICES.recursive);
  applySku("alive", buckets.alive, LAUNCH_PRICES.alive);
  applySku("mcp_mesh", buckets.mcp_mesh, LAUNCH_PRICES.mcp_mesh);
  applySku("collab_pack", buckets.collab_pack, LAUNCH_PRICES.collab_pack);
  applySku(
    "collab_lab_license",
    buckets.collab_lab_license,
    LAUNCH_PRICES.collab_lab_license || COLLAB_LAB_LICENSE_BASE_CENTS,
  );

  const kernelScale =
    buckets.kernel.length >= MIN_WTP_SAMPLES && median(buckets.kernel) != null
      ? Math.min(
          1.5,
          Math.max(
            0.5,
            (median(buckets.kernel) as number) / (LAUNCH_PRICES.kernel / 100),
          ),
        )
      : 1;
  const loopScale =
    buckets.recursive.length >= MIN_WTP_SAMPLES &&
    median(buckets.recursive) != null
      ? Math.min(
          1.5,
          Math.max(
            0.5,
            (median(buckets.recursive) as number) /
              (LAUNCH_PRICES.recursive / 100),
          ),
        )
      : kernelScale;

  const catalog = loadEventCatalog();
  for (const [id, def] of Object.entries(catalog)) {
    const samples = buckets.events[id] || [];
    const med = median(samples);
    state.wtp_median_usd[`event:${id}`] = med;
    if (med != null && samples.length >= MIN_WTP_SAMPLES) {
      const { cents, used } = blendCents(def.price_cents, med, samples.length);
      state.event_cents[id] = cents;
      if (used) {
        anyBlend = true;
        recs.push(
          `event ${id}: ${formatUsd(cents)}/call (median WTP $${med} · n=${samples.length})`,
        );
      }
    } else {
      let scale = 1;
      if (def.product === "kernel") scale = kernelScale;
      else if (def.product === "recursive") scale = loopScale;
      else if (def.product === "mcp_mesh") {
        scale =
          buckets.mcp_mesh.length >= MIN_WTP_SAMPLES &&
          median(buckets.mcp_mesh) != null
            ? Math.min(
                1.5,
                Math.max(
                  0.5,
                  (median(buckets.mcp_mesh) as number) /
                    (LAUNCH_PRICES.mcp_mesh / 100),
                ),
              )
            : 1;
      } else if (def.product === "collab") {
        scale =
          buckets.collab_pack.length >= MIN_WTP_SAMPLES &&
          median(buckets.collab_pack) != null
            ? Math.min(
                1.5,
                Math.max(
                  0.5,
                  (median(buckets.collab_pack) as number) /
                    (LAUNCH_PRICES.collab_pack / 100),
                ),
              )
            : kernelScale;
      }
      const scaled = Math.max(1, Math.round(def.price_cents * scale));
      state.event_cents[id] = scaled;
      if (scale !== 1) {
        anyBlend = true;
        recs.push(
          `event ${id}: ${formatUsd(scaled)}/call (scaled ×${scale.toFixed(2)} from product WTP; base ${formatUsd(def.price_cents)})`,
        );
      }
    }
    let free = def.free_per_day;
    if (buckets.fairness.length >= MIN_WTP_SAMPLES) {
      const fairMed = median(buckets.fairness) || 3;
      if (fairMed <= 2.5) free = def.free_per_day + 2;
      else if (fairMed <= 3.5) free = def.free_per_day + 1;
    }
    state.event_free_per_day[id] = free;
  }

  const audParts = Object.entries(state.by_audience)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}:${n}`);
  if (audParts.length) {
    recs.unshift(`WTP sources by role — ${audParts.join(" · ")}`);
  }
  if (!anyBlend) {
    recs.push(
      "Prices still at founding catalog until ≥3 WTP samples per SKU/event (agents, MCPs, humans all count)",
    );
  }

  state.method = anyBlend ? "feedback_blend_median" : "base_catalog";
  state.note = anyBlend
    ? "List + per-call prices are feedback-driven (median WTP blend with founding anchors). $0 answers pull prices down honestly."
    : state.note;
  state.recommendations = recs.slice(0, 24);
  state.updated_at = new Date().toISOString();
  await persist(state);
  return state;
}

/** Effective list cents for a SKU (seat-tier bump applied on top of feedback base). */
export function feedbackListCents(sku: ProductSku, tierListCents: number): number {
  const s = getFeedbackPriceStateSync();
  const fb = s.list_cents[sku];
  if (!fb || s.method === "base_catalog") return tierListCents;
  const founding = LAUNCH_PRICES[sku] || tierListCents;
  if (founding <= 0) return tierListCents;
  const ratio = tierListCents / founding;
  return Math.max(50, Math.round(fb * ratio));
}

export function feedbackEventCents(eventId: string, baseCents: number): number {
  const s = getFeedbackPriceStateSync();
  const v = s.event_cents[eventId];
  return typeof v === "number" && v > 0 ? v : baseCents;
}

export function feedbackEventFreePerDay(eventId: string, base: number): number {
  const s = getFeedbackPriceStateSync();
  const v = s.event_free_per_day[eventId];
  return typeof v === "number" && v >= 0 ? v : base;
}

export async function publicFeedbackPricingSnapshot() {
  let s = await getFeedbackPriceState();
  if (!mem || Date.now() - Date.parse(s.updated_at || "0") > 6 * 3600_000) {
    s = await recomputeFeedbackDrivenPrices();
  }
  return {
    ok: true as const,
    product: "feedback_driven_pricing",
    version: FEEDBACK_PRICING_VERSION,
    method: s.method,
    note: s.note,
    sample_n: s.sample_n,
    by_audience: s.by_audience,
    min_samples_to_move: MIN_WTP_SAMPLES,
    list: Object.fromEntries(
      Object.entries(s.list_cents).map(([k, c]) => [
        k,
        { price_cents: c, price_usd: c / 100, price: formatUsd(c) },
      ]),
    ),
    events: Object.fromEntries(
      Object.entries(s.event_cents).map(([k, c]) => [
        k,
        {
          price_cents: c,
          price_usd: (c || 0) / 100,
          price: formatUsd(c || 0),
          free_per_day: s.event_free_per_day[k],
        },
      ]),
    ),
    collab_lab: {
      free_via_spend_usd_30d: COLLAB_SPEND_FREE_USD,
      license_list: formatUsd(
        s.list_cents.collab_lab_license || COLLAB_LAB_LICENSE_BASE_CENTS,
      ),
      byo_api: true,
      note: "Free Collab Lab if rolling 30d paid Kernel+Loop event spend ≥ $5, or active seat, or one-time collab_lab_license + BYO API key",
    },
    wtp_median_usd: s.wtp_median_usd,
    recommendations: s.recommendations,
    updated_at: s.updated_at,
  };
}

void loadCache().catch(() => undefined);
