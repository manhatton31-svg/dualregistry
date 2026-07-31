/**
 * Running platform cost ledger — dimensions match Vercel dashboard.
 * Persists via durable-json so multi-instance /tmp still rolls up.
 * Persist is deferred (waitUntil) so billing never extends provisioned wall time.
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "./durable-json";
import { deferWork } from "./defer-work";
import {
  type CostClass,
  type CostBreakdown,
  costFromUsage,
  estimateActiveCpuMs,
  FLUID_MEMORY_MB,
  platformPublicMeta,
  PRO_MONTHLY_CREDIT_USD,
  RATES_VERSION,
  VERCEL_PLAN,
} from "./vercel-platform";

const DURABLE_NAME = "platform-cost.json";

export type CostEvent = {
  at: string;
  class: CostClass;
  route?: string;
  label?: string;
  wall_ms: number;
  active_cpu_ms: number;
  invocations: number;
  cache_hit?: boolean;
  response_bytes?: number;
  usd: number;
  skipped?: boolean;
  vercel_cache?: string | null;
};

export type DayBucket = {
  day: string; // UTC YYYY-MM-DD
  invocations: number;
  active_cpu_ms: number;
  wall_ms: number;
  provisioned_gb_hours: number;
  response_bytes: number;
  cache_hits: number;
  cache_misses: number;
  skipped_cadence: number; // cheap skip — still 1 inv, tiny CPU
  by_class: Partial<
    Record<
      CostClass,
      { n: number; wall_ms: number; active_cpu_ms: number; usd: number }
    >
  >;
  usd: CostBreakdown;
  events: CostEvent[]; // last N
};

export type PlatformCostState = {
  plan: typeof VERCEL_PLAN;
  rates_version: string;
  month: string; // YYYY-MM UTC
  month_usd: number;
  month_invocations: number;
  month_active_cpu_ms: number;
  month_provisioned_gb_hours: number;
  month_cache_hits: number;
  today: DayBucket;
  /** Lifetime within this deploy lineage (resets only if durable wiped) */
  lifetime_usd: number;
  lifetime_invocations: number;
  updated_at: string;
  savings_notes: string[];
};

const MAX_EVENTS = 80;

const SAVINGS_NOTES = [
  "Fluid Active CPU: I/O wait during probes is free",
  "Probe de-dupe: Vercel Cron primary; GH Actions commits only when tick fresh or backup",
  "Harvest every 12m soft GETs (was 2m) — fewer origin inv",
  "CDN + ETag/304 on discovery (cards, pack, stats, A2A help)",
  "waitUntil: cost ledger + durable writes off critical path",
  "preferredRegion iad1 + short maxDuration on metadata routes",
  "Dashboard soft poll 3m + private max-age; growth panel 3m",
  "x-vercel-cache telemetry in ledger (HIT = origin avoided)",
];

function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function utcMonth(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

function emptyDay(day = utcDay()): DayBucket {
  return {
    day,
    invocations: 0,
    active_cpu_ms: 0,
    wall_ms: 0,
    provisioned_gb_hours: 0,
    response_bytes: 0,
    cache_hits: 0,
    cache_misses: 0,
    skipped_cadence: 0,
    by_class: {},
    usd: costFromUsage({ active_cpu_ms: 0, wall_ms: 0, invocations: 0 }),
    events: [],
  };
}

function fresh(): PlatformCostState {
  return {
    plan: VERCEL_PLAN,
    rates_version: RATES_VERSION,
    month: utcMonth(),
    month_usd: 0,
    month_invocations: 0,
    month_active_cpu_ms: 0,
    month_provisioned_gb_hours: 0,
    month_cache_hits: 0,
    today: emptyDay(),
    lifetime_usd: 0,
    lifetime_invocations: 0,
    updated_at: new Date().toISOString(),
    savings_notes: [...SAVINGS_NOTES],
  };
}

let mem: PlatformCostState | null = null;
let chain: Promise<void> = Promise.resolve();

function rollDay(s: PlatformCostState): PlatformCostState {
  const day = utcDay();
  const month = utcMonth();
  if (s.month !== month) {
    s.month = month;
    s.month_usd = 0;
    s.month_invocations = 0;
    s.month_active_cpu_ms = 0;
    s.month_provisioned_gb_hours = 0;
    s.month_cache_hits = 0;
  }
  if (!s.today || s.today.day !== day) {
    s.today = emptyDay(day);
  }
  s.rates_version = RATES_VERSION;
  s.plan = VERCEL_PLAN;
  s.savings_notes = [...SAVINGS_NOTES];
  return s;
}

function recomputeDayUsd(day: DayBucket): CostBreakdown {
  return costFromUsage({
    active_cpu_ms: day.active_cpu_ms,
    wall_ms: day.wall_ms,
    provisioned_memory_mb: FLUID_MEMORY_MB,
    invocations: day.invocations,
    response_bytes: day.response_bytes,
  });
}

export async function loadPlatformCost(): Promise<PlatformCostState> {
  if (mem) {
    rollDay(mem);
    return mem;
  }
  try {
    const raw = await loadDurableJson<PlatformCostState>(
      DURABLE_NAME,
      () => fresh(),
    );
    if (raw && raw.today) {
      mem = rollDay({ ...fresh(), ...raw, today: raw.today });
      return mem;
    }
  } catch {
    /* */
  }
  mem = fresh();
  return mem;
}

function schedulePersist(s: PlatformCostState) {
  mem = s;
  chain = chain.then(async () => {
    try {
      await saveDurableJson(DURABLE_NAME, s);
    } catch {
      /* local-only ok */
    }
  });
  // Do not await chain on the request path — waitUntil keeps it alive on Vercel
  deferWork(chain);
}

export type RecordUsageInput = {
  class: CostClass;
  wall_ms: number;
  route?: string;
  label?: string;
  active_cpu_ms?: number;
  invocations?: number;
  response_bytes?: number;
  cache_hit?: boolean;
  /** Cadence skip / cheap early return */
  skipped?: boolean;
  /** Raw x-vercel-cache status when known */
  vercel_cache?: string | null;
  /** When true, still await durable write (cron commit needs it) */
  await_persist?: boolean;
};

export async function recordPlatformUsage(
  input: RecordUsageInput,
): Promise<PlatformCostState> {
  const s = await loadPlatformCost();
  rollDay(s);
  const inv = Math.max(1, Math.floor(input.invocations ?? 1));
  const wall = Math.max(0, Math.floor(input.wall_ms));
  const active = estimateActiveCpuMs(wall, input.class, {
    active_cpu_ms: input.active_cpu_ms,
  });
  const sampleCost = costFromUsage({
    active_cpu_ms: active,
    wall_ms: wall,
    provisioned_memory_mb: FLUID_MEMORY_MB,
    invocations: inv,
    response_bytes: input.response_bytes,
  });

  s.today.invocations += inv;
  s.today.active_cpu_ms += active;
  s.today.wall_ms += wall;
  s.today.provisioned_gb_hours += sampleCost.provisioned_gb_hours;
  s.today.response_bytes += Math.max(0, input.response_bytes || 0);
  if (input.cache_hit) s.today.cache_hits += 1;
  else s.today.cache_misses += 1;
  if (input.skipped) s.today.skipped_cadence += 1;

  const bc = s.today.by_class[input.class] || {
    n: 0,
    wall_ms: 0,
    active_cpu_ms: 0,
    usd: 0,
  };
  bc.n += 1;
  bc.wall_ms += wall;
  bc.active_cpu_ms += active;
  bc.usd += sampleCost.usd_total;
  s.today.by_class[input.class] = bc;

  s.today.usd = recomputeDayUsd(s.today);

  const ev: CostEvent = {
    at: new Date().toISOString(),
    class: input.class,
    route: input.route,
    label: input.label,
    wall_ms: wall,
    active_cpu_ms: active,
    invocations: inv,
    cache_hit: input.cache_hit,
    response_bytes: input.response_bytes,
    usd: sampleCost.usd_total,
    skipped: input.skipped,
    vercel_cache: input.vercel_cache ?? null,
  };
  s.today.events = [ev, ...s.today.events].slice(0, MAX_EVENTS);

  s.month_usd += sampleCost.usd_total;
  s.month_invocations += inv;
  s.month_active_cpu_ms += active;
  s.month_provisioned_gb_hours += sampleCost.provisioned_gb_hours;
  if (input.cache_hit) s.month_cache_hits += 1;
  s.lifetime_usd += sampleCost.usd_total;
  s.lifetime_invocations += inv;
  s.updated_at = ev.at;

  if (input.await_persist) {
    mem = s;
    try {
      await saveDurableJson(DURABLE_NAME, s);
    } catch {
      /* */
    }
  } else {
    schedulePersist(s);
  }
  return s;
}

/** Wrap an async op — records wall + estimated Active CPU. */
export async function withPlatformCost<T>(
  input: Omit<RecordUsageInput, "wall_ms" | "active_cpu_ms"> & {
    wall_ms?: number;
  },
  fn: () => Promise<T>,
): Promise<{ result: T; cost: PlatformCostState; wall_ms: number }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    const wall_ms = Date.now() - t0;
    const cost = await recordPlatformUsage({ ...input, wall_ms });
    return { result, cost, wall_ms };
  } catch (e) {
    const wall_ms = Date.now() - t0;
    await recordPlatformUsage({
      ...input,
      wall_ms,
      label: `${input.label || "error"}:fail`,
    }).catch(() => undefined);
    throw e;
  }
}

export function platformCostPublic(s: PlatformCostState) {
  const monthCredit = PRO_MONTHLY_CREDIT_USD;
  const monthBillable = Math.max(0, s.month_usd);
  const monthAfterCredit = Math.max(0, monthBillable - monthCredit);
  const day = s.today;
  return {
    ok: true,
    ...platformPublicMeta(),
    running_total: {
      today_usd: round4(day.usd.usd_total),
      month_usd_gross: round4(s.month_usd),
      month_usd_after_pro_credit: round4(monthAfterCredit),
      lifetime_usd: round4(s.lifetime_usd),
      currency: "USD",
      matches_dashboard:
        "Dimensions map 1:1 to Fluid Active CPU / Provisioned Memory / Invocations. $ uses rates_version; compare Usage → Fluid in Vercel dashboard.",
    },
    today: {
      day: day.day,
      invocations: day.invocations,
      active_cpu_ms: day.active_cpu_ms,
      active_cpu_hours: round6(day.active_cpu_ms / 3_600_000),
      wall_ms: day.wall_ms,
      provisioned_gb_hours: round6(day.provisioned_gb_hours),
      response_bytes: day.response_bytes,
      cache_hits: day.cache_hits,
      cache_misses: day.cache_misses,
      skipped_cadence: day.skipped_cadence,
      by_class: day.by_class,
      usd: {
        active_cpu: round4(day.usd.usd_active_cpu),
        provisioned_memory: round4(day.usd.usd_provisioned_memory),
        invocations: round4(day.usd.usd_invocations),
        bandwidth: round4(day.usd.usd_bandwidth),
        total: round4(day.usd.usd_total),
      },
      recent: day.events.slice(0, 24),
    },
    month: {
      month: s.month,
      invocations: s.month_invocations,
      active_cpu_ms: s.month_active_cpu_ms,
      active_cpu_hours: round6(s.month_active_cpu_ms / 3_600_000),
      provisioned_gb_hours: round6(s.month_provisioned_gb_hours),
      cache_hits: s.month_cache_hits,
      usd_gross: round4(s.month_usd),
      pro_credit_usd: monthCredit,
      usd_after_credit: round4(monthAfterCredit),
    },
    savings: {
      notes: s.savings_notes,
      cadence_skips_today: day.skipped_cadence,
      cache_hit_rate:
        day.cache_hits + day.cache_misses > 0
          ? round4(day.cache_hits / (day.cache_hits + day.cache_misses))
          : null,
      estimated_origin_avoided_invocations: day.cache_hits,
    },
    updated_at: s.updated_at,
  };
}

function round4(n: number) {
  // Keep micro-cent resolution so small Fluid samples don't read as $0.0000
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) > 0 && Math.abs(n) < 0.0001) {
    return Math.round(n * 1_000_000_000) / 1_000_000_000;
  }
  return Math.round(n * 10_000) / 10_000;
}
function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}
