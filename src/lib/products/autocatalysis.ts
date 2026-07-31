/**
 * Autocatalysis (Dorr/RethinkX) — second-order acceleration on Dual.
 *
 * First-order stigmergy: trace → local ranking.
 * Second-order autocatalysis: ANY trace raises the RATE of ALL loops
 * (match weight, conversion room, outbound budget, feed heat).
 *
 * Virtuous cycle: activity → higher acceleration_index → more surface → more activity.
 * Vicious counterpart: sustained danger accelerates delist priority.
 *
 * Durable: autocatalysis.json
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";

export const AUTOCATALYSIS_VERSION = "2.5.0";
const DURABLE = "autocatalysis.json";

/** Base index = 1.0 (no acceleration). Caps prevent runaway spam. */
export const INDEX_MIN = 1.0;
export const INDEX_MAX = 3.0;
/** Half-life of excess acceleration toward 1.0 (hours). */
export const INDEX_HALF_LIFE_H = 72;

/** How much each event kind bumps acceleration_index (before caps). */
export const ACCEL_BUMPS: Record<string, number> = {
  take_demo: 0.012,
  leave_feedback: 0.04,
  founding_claim: 0.08,
  leave_trace: 0.008,
  endorse: 0.015,
  used_with: 0.01,
  match_hit: 0.003,
  match_query: 0.001,
  list_yourself: 0.01,
  probe_ok: 0.002,
  probe_fail: 0.004, // also feeds vicious path
  cascade: 0.02,
  contagion: 0.005,
};

export type AccelKind = keyof typeof ACCEL_BUMPS;

export type RateBucket = {
  key: string; // YYYY-MM-DDTHH or YYYY-MM-DD
  demos: number;
  feedback: number;
  traces: number;
  lists: number;
  matches: number;
  probes_fail: number;
  probes_ok: number;
  founding_claims: number;
  endorsements: number;
  events: number;
};

export type CascadeEvent = {
  at: string;
  kind: string;
  listing_id?: string;
  amount: number;
  note?: string;
};

export type ViciousRow = {
  listing_id: string;
  danger: number;
  fail_streak: number;
  priority: number;
  last_at: string;
  note: string;
};

type Store = {
  version: string;
  updated_at: string;
  acceleration_index: number;
  last_bump_at?: string;
  last_evaporated_at?: string;
  /** Extra conversion multipath slots earned via cascades (resets daily). */
  conversion_bonus_day: string;
  conversion_bonus: number;
  hourly: RateBucket[];
  daily: RateBucket[];
  cascades: CascadeEvent[];
  vicious: Record<string, ViciousRow>;
  totals: {
    bumps: number;
    cascades: number;
    contagions: number;
    vicious_flags: number;
  };
};

function emptyBucket(key: string): RateBucket {
  return {
    key,
    demos: 0,
    feedback: 0,
    traces: 0,
    lists: 0,
    matches: 0,
    probes_fail: 0,
    probes_ok: 0,
    founding_claims: 0,
    endorsements: 0,
    events: 0,
  };
}

function empty(): Store {
  return {
    version: AUTOCATALYSIS_VERSION,
    updated_at: new Date().toISOString(),
    acceleration_index: INDEX_MIN,
    conversion_bonus_day: etDay(),
    conversion_bonus: 0,
    hourly: [],
    daily: [],
    cascades: [],
    vicious: {},
    totals: {
      bumps: 0,
      cascades: 0,
      contagions: 0,
      vicious_flags: 0,
    },
  };
}

function etDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function hourKey(d = new Date()): string {
  // UTC hour bucket for rate curves
  return d.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

let mem: Store | null = null;

async function load(): Promise<Store> {
  if (mem) return mem;
  const s = await loadDurableJson<Store>(DURABLE, empty);
  if (!s.hourly) s.hourly = [];
  if (!s.daily) s.daily = [];
  if (!s.cascades) s.cascades = [];
  if (!s.vicious) s.vicious = {};
  if (!s.totals) s.totals = empty().totals;
  if (typeof s.acceleration_index !== "number") s.acceleration_index = INDEX_MIN;
  if (!s.conversion_bonus_day) s.conversion_bonus_day = etDay();
  if (typeof s.conversion_bonus !== "number") s.conversion_bonus = 0;
  const day = etDay();
  if (s.conversion_bonus_day !== day) {
    s.conversion_bonus_day = day;
    s.conversion_bonus = 0;
  }
  s.version = AUTOCATALYSIS_VERSION;
  mem = s;
  return s;
}

async function persist(s: Store) {
  s.updated_at = new Date().toISOString();
  s.version = AUTOCATALYSIS_VERSION;
  mem = s;
  await saveDurableJson(DURABLE, s);
}

function hoursSince(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

/** Excess over 1.0 decays with half-life; floor at INDEX_MIN. */
function evaporateIndex(s: Store): boolean {
  const ref = s.last_evaporated_at || s.last_bump_at;
  const h = hoursSince(ref);
  if (h < 0.25) return false;
  const excess = Math.max(0, s.acceleration_index - INDEX_MIN);
  if (excess <= 0.0001) {
    s.acceleration_index = INDEX_MIN;
    s.last_evaporated_at = new Date().toISOString();
    return false;
  }
  const nextExcess = excess * Math.pow(0.5, h / INDEX_HALF_LIFE_H);
  const next = INDEX_MIN + nextExcess;
  const changed = Math.abs(next - s.acceleration_index) > 0.0005;
  s.acceleration_index = Math.max(INDEX_MIN, Math.min(INDEX_MAX, next));
  s.last_evaporated_at = new Date().toISOString();
  return changed;
}

function touchBucket(
  list: RateBucket[],
  key: string,
  max: number,
  mut: (b: RateBucket) => void,
): RateBucket[] {
  let b = list.find((x) => x.key === key);
  if (!b) {
    b = emptyBucket(key);
    list.unshift(b);
  }
  mut(b);
  return list.filter((x, i, arr) => arr.findIndex((y) => y.key === x.key) === i).slice(0, max);
}

function recordRates(s: Store, kind: string) {
  const hk = hourKey();
  const dk = dayKey();
  const apply = (b: RateBucket) => {
    b.events += 1;
    if (kind === "take_demo") b.demos += 1;
    if (kind === "leave_feedback") b.feedback += 1;
    if (kind === "founding_claim") b.founding_claims += 1;
    if (kind === "leave_trace" || kind === "endorse" || kind === "used_with")
      b.traces += 1;
    if (kind === "endorse") b.endorsements += 1;
    if (kind === "list_yourself") b.lists += 1;
    if (kind === "match_hit" || kind === "match_query") b.matches += 1;
    if (kind === "probe_fail") b.probes_fail += 1;
    if (kind === "probe_ok") b.probes_ok += 1;
  };
  s.hourly = touchBucket(s.hourly, hk, 48, apply);
  s.daily = touchBucket(s.daily, dk, 30, apply);
}

function rateOf(bucket: RateBucket | undefined): number {
  if (!bucket) return 0;
  return (
    bucket.demos * 3 +
    bucket.feedback * 5 +
    bucket.founding_claims * 8 +
    bucket.traces * 2 +
    bucket.lists * 2 +
    bucket.matches * 0.5 +
    bucket.endorsements * 2
  );
}

/** dR/dt over recent windows → second derivative signal. */
export function computeSCurve(s: Store): {
  rate_now: number;
  rate_prev: number;
  acceleration: number; // second derivative proxy
  phase: "seed" | "early_s" | "steep" | "mature";
  hourly_series: Array<{ key: string; rate: number }>;
  daily_series: Array<{ key: string; rate: number }>;
} {
  const h = [...s.hourly].sort((a, b) => a.key.localeCompare(b.key));
  const last3 = h.slice(-3);
  const prev3 = h.slice(-6, -3);
  const rate_now = last3.reduce((a, b) => a + rateOf(b), 0) / Math.max(1, last3.length);
  const rate_prev =
    prev3.reduce((a, b) => a + rateOf(b), 0) / Math.max(1, prev3.length || 1);
  const acceleration = rate_now - rate_prev;
  let phase: "seed" | "early_s" | "steep" | "mature" = "seed";
  if (rate_now > 20 && acceleration > 2) phase = "steep";
  else if (rate_now > 8 && acceleration >= 0) phase = "early_s";
  else if (rate_now > 25 && acceleration < 0) phase = "mature";
  else if (rate_now > 3) phase = "early_s";

  return {
    rate_now: Math.round(rate_now * 100) / 100,
    rate_prev: Math.round(rate_prev * 100) / 100,
    acceleration: Math.round(acceleration * 100) / 100,
    phase,
    hourly_series: h.slice(-24).map((b) => ({
      key: b.key,
      rate: Math.round(rateOf(b) * 100) / 100,
    })),
    daily_series: [...s.daily]
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-14)
      .map((b) => ({
        key: b.key,
        rate: Math.round(rateOf(b) * 100) / 100,
      })),
  };
}

export type AccelMultipliers = {
  index: number;
  match_boost_mult: number;
  conversion_room_mult: number;
  conversion_room_bonus: number;
  day_budget_mult: number;
  multipath_extra: number;
  feed_weight: number;
};

export function multipliersFromIndex(
  index: number,
  conversion_bonus = 0,
): AccelMultipliers {
  const i = Math.max(INDEX_MIN, Math.min(INDEX_MAX, index));
  const excess = i - INDEX_MIN;
  return {
    index: Math.round(i * 1000) / 1000,
    match_boost_mult: Math.min(2, 1 + excess * 0.5),
    conversion_room_mult: Math.min(2.5, 1 + excess * 0.8),
    conversion_room_bonus: Math.max(0, Math.floor(conversion_bonus)),
    day_budget_mult: Math.min(1.8, 1 + excess * 0.4),
    multipath_extra: Math.min(24, Math.floor(excess * 12)),
    feed_weight: Math.min(3, 1 + excess),
  };
}

export async function getAccelerationMultipliers(): Promise<AccelMultipliers> {
  const s = await load();
  evaporateIndex(s);
  await persist(s);
  return multipliersFromIndex(s.acceleration_index, s.conversion_bonus);
}

export async function getAccelerationIndex(): Promise<number> {
  const m = await getAccelerationMultipliers();
  return m.index;
}

/**
 * P0 — every deposit bumps global acceleration_index.
 * Called from stigmergy autoDeposit / leaveTrace and feedback cascade.
 */
export async function bumpAcceleration(opts: {
  kind: string;
  listing_id?: string;
  amount?: number;
  meta?: Record<string, unknown>;
}): Promise<{ ok: true; index: number; bump: number }> {
  const s = await load();
  evaporateIndex(s);
  const base = ACCEL_BUMPS[opts.kind] ?? 0.005;
  const scale = opts.amount != null ? Math.min(3, Math.max(0.25, opts.amount / 10)) : 1;
  let hyperScale = 1;
  try {
    const { getHyperBumpScale } = await import("./exonomics");
    hyperScale = await getHyperBumpScale();
  } catch {
    /* */
  }
  const bump = base * scale * hyperScale;
  s.acceleration_index = Math.min(
    INDEX_MAX,
    Math.max(INDEX_MIN, s.acceleration_index + bump),
  );
  s.last_bump_at = new Date().toISOString();
  s.totals.bumps += 1;
  recordRates(s, opts.kind);

  if (opts.kind === "probe_fail" && opts.listing_id) {
    const prev = s.vicious[opts.listing_id];
    const fail_streak = (prev?.fail_streak || 0) + 1;
    const danger = (prev?.danger || 0) + 10;
    s.vicious[opts.listing_id] = {
      listing_id: opts.listing_id,
      danger,
      fail_streak,
      priority: Math.min(100, danger + fail_streak * 8),
      last_at: s.last_bump_at,
      note:
        fail_streak >= 3
          ? "vicious cycle — prioritize re-probe / delist review"
          : "danger accumulating",
    };
    s.totals.vicious_flags += 1;
  }
  if (opts.kind === "probe_ok" && opts.listing_id && s.vicious[opts.listing_id]) {
    const v = s.vicious[opts.listing_id];
    v.fail_streak = 0;
    v.danger = Math.max(0, v.danger - 15);
    v.priority = Math.max(0, v.priority - 20);
    v.last_at = s.last_bump_at;
    v.note = "danger dampened by probe_ok";
    if (v.danger <= 0 && v.priority <= 0) delete s.vicious[opts.listing_id];
  }

  await persist(s);
  return {
    ok: true,
    index: Math.round(s.acceleration_index * 1000) / 1000,
    bump: Math.round(bump * 10000) / 10000,
  };
}

/**
 * P0 — cascade: feedback / founding claim accelerates ALL loops.
 * Bumps index harder + conversion day bonus + optional neighbor demand deposit.
 */
export async function runFeedbackCascade(opts: {
  listing_id?: string;
  agent_name?: string;
  founding_claimed?: boolean;
  from?: string;
}): Promise<{
  ok: true;
  index: number;
  conversion_bonus: number;
  neighbors_touched: number;
  note: string;
}> {
  const s = await load();
  evaporateIndex(s);
  const day = etDay();
  if (s.conversion_bonus_day !== day) {
    s.conversion_bonus_day = day;
    s.conversion_bonus = 0;
  }

  const bumpKind = opts.founding_claimed ? "founding_claim" : "leave_feedback";
  const base = ACCEL_BUMPS[bumpKind] || 0.04;
  s.acceleration_index = Math.min(INDEX_MAX, s.acceleration_index + base);
  s.last_bump_at = new Date().toISOString();
  s.totals.bumps += 1;
  s.totals.cascades += 1;
  recordRates(s, bumpKind);

  // Extra conversion multipath slots today (cap +12)
  const bonusAdd = opts.founding_claimed ? 4 : 2;
  s.conversion_bonus = Math.min(12, s.conversion_bonus + bonusAdd);

  s.cascades.unshift({
    at: s.last_bump_at,
    kind: bumpKind,
    listing_id: opts.listing_id,
    amount: base,
    note: opts.founding_claimed
      ? "founding seat claim — cascade heat"
      : "feedback cascade — system-wide acceleration",
  });
  s.cascades = s.cascades.slice(0, 100);

  await persist(s);

  // Composition neighbors get weak demand (contagion lite)
  let neighbors_touched = 0;
  if (opts.listing_id) {
    try {
      const { contagionFromListing } = await import("./stigmergy");
      const r = await contagionFromListing(opts.listing_id, {
        intensity: opts.founding_claimed ? 3 : 2,
        from: opts.from || opts.agent_name || "cascade",
      });
      neighbors_touched = r.touched;
      if (neighbors_touched > 0) {
        const s2 = await load();
        s2.totals.contagions += neighbors_touched;
        await persist(s2);
      }
    } catch {
      /* */
    }
  }

  // also bump acceleration for cascade itself
  await bumpAcceleration({
    kind: "cascade",
    listing_id: opts.listing_id,
  });

  const m = await getAccelerationMultipliers();
  return {
    ok: true,
    index: m.index,
    conversion_bonus: m.conversion_room_bonus,
    neighbors_touched,
    note: "Autocatalytic cascade — one feedback raises conversion room + index + neighbor demand",
  };
}

/** P2 — vicious cycle: listings with high danger / fail streaks. */
export async function getViciousCycle(limit = 20): Promise<{
  ok: true;
  items: ViciousRow[];
  note: string;
}> {
  const s = await load();
  const items = Object.values(s.vicious)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
  return {
    ok: true,
    items,
    note: "Sustained probe fails accelerate delist/re-probe priority (incumbent death spiral analog).",
  };
}

export async function getAutocatalysisPublic(opts?: {
  origin?: string;
}): Promise<Record<string, unknown>> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const s = await load();
  evaporateIndex(s);
  await persist(s);
  const mult = multipliersFromIndex(s.acceleration_index, s.conversion_bonus);
  const scurve = computeSCurve(s);
  const vicious = Object.values(s.vicious)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8);

  return {
    ok: true,
    version: AUTOCATALYSIS_VERSION,
    model: "dorr_rethinkx_autocatalysis",
    pitch:
      "Any stigmergic trace raises the rate of ALL Dual loops — acceleration of acceleration (S-curve).",
    acceleration_index: mult.index,
    multipliers: mult,
    s_curve: scurve,
    half_life_hours: INDEX_HALF_LIFE_H,
    index_bounds: { min: INDEX_MIN, max: INDEX_MAX },
    bumps: ACCEL_BUMPS,
    totals: s.totals,
    recent_cascades: s.cascades.slice(0, 10),
    vicious_cycle: vicious,
    endpoints: {
      api: `${origin}/api/products/autocatalysis`,
      stigmergy: `${origin}/api/products/stigmergy`,
      feed: `${origin}/api/feed`,
      match: `${origin}/api/match`,
      conversion: `${origin}/api/products/conversion-pressure`,
    },
    laws: [
      "Any deposit bumps acceleration_index (capped 3.0)",
      "Index multiplies match boost, conversion room, day first-touch budget, multipath extra",
      "Feedback / founding claim cascade → conversion bonus + neighbor demand",
      "Composition used_with contagion seeds demand on co-use graph",
      "Hot trails prioritize outbound multipath (Active-only, 30d silence holds)",
      "Sustained danger accelerates delist priority (vicious cycle)",
      "Excess index evaporates toward 1.0 (72h half-life)",
    ],
    note: "Second-order layer on stigmergy v2.4 — Dual accelerates its own adoption rate.",
  };
}
