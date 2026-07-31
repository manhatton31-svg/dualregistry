/**
 * Running platform cost ledger — dimensions match Vercel dashboard.
 * Persists via durable-json so multi-instance /tmp still rolls up.
 * Persist is deferred (waitUntil) so billing never extends provisioned wall time.
 *
 * High-water merge: cold isolates must not zero today/month USD.
 */
import {
  loadDurableJson,
  saveDurableJson,
  durableRemoteRawUrl,
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
  skipped_cadence: number;
  by_class: Partial<
    Record<
      CostClass,
      { n: number; wall_ms: number; active_cpu_ms: number; usd: number }
    >
  >;
  usd: CostBreakdown;
  events: CostEvent[];
};

export type PlatformCostState = {
  plan: typeof VERCEL_PLAN;
  rates_version: string;
  month: string;
  month_usd: number;
  month_invocations: number;
  month_active_cpu_ms: number;
  month_provisioned_gb_hours: number;
  month_cache_hits: number;
  today: DayBucket;
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
  "High-water merge: multi-instance never regresses today/month USD",
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

function mergeDayBucket(a: DayBucket, b: DayBucket): DayBucket {
  if (a.day !== b.day) {
    // Prefer today's bucket
    const day = utcDay();
    if (a.day === day) return a;
    if (b.day === day) return b;
    return (a.day || "") >= (b.day || "") ? a : b;
  }
  const by_class: DayBucket["by_class"] = { ...(a.by_class || {}) };
  for (const [k, v] of Object.entries(b.by_class || {})) {
    const key = k as CostClass;
    const prev = by_class[key];
    if (!prev) {
      by_class[key] = v;
      continue;
    }
    by_class[key] = {
      n: Math.max(prev.n || 0, v?.n || 0),
      wall_ms: Math.max(prev.wall_ms || 0, v?.wall_ms || 0),
      active_cpu_ms: Math.max(prev.active_cpu_ms || 0, v?.active_cpu_ms || 0),
      usd: Math.max(prev.usd || 0, v?.usd || 0),
    };
  }
  const eventsMap = new Map<string, CostEvent>();
  for (const ev of [...(a.events || []), ...(b.events || [])]) {
    if (!ev) continue;
    const key = `${ev.at}|${ev.route || ""}|${ev.label || ""}|${ev.wall_ms}`;
    if (!eventsMap.has(key)) eventsMap.set(key, ev);
  }
  const events = [...eventsMap.values()]
    .sort((x, y) => (y.at || "").localeCompare(x.at || ""))
    .slice(0, MAX_EVENTS);

  const merged: DayBucket = {
    day: a.day,
    invocations: Math.max(a.invocations || 0, b.invocations || 0),
    active_cpu_ms: Math.max(a.active_cpu_ms || 0, b.active_cpu_ms || 0),
    wall_ms: Math.max(a.wall_ms || 0, b.wall_ms || 0),
    provisioned_gb_hours: Math.max(
      a.provisioned_gb_hours || 0,
      b.provisioned_gb_hours || 0,
    ),
    response_bytes: Math.max(a.response_bytes || 0, b.response_bytes || 0),
    cache_hits: Math.max(a.cache_hits || 0, b.cache_hits || 0),
    cache_misses: Math.max(a.cache_misses || 0, b.cache_misses || 0),
    skipped_cadence: Math.max(a.skipped_cadence || 0, b.skipped_cadence || 0),
    by_class,
    usd: costFromUsage({ active_cpu_ms: 0, wall_ms: 0, invocations: 0 }),
    events,
  };
  merged.usd = recomputeDayUsd(merged);
  // Also high-water the precomputed usd_total if recompute is lower (shouldn't be)
  const aTot = a.usd?.usd_total || 0;
  const bTot = b.usd?.usd_total || 0;
  if (Math.max(aTot, bTot) > (merged.usd.usd_total || 0)) {
    const winner = aTot >= bTot ? a.usd : b.usd;
    if (winner) merged.usd = { ...merged.usd, ...winner, usd_total: Math.max(aTot, bTot) };
  }
  return merged;
}

/** High-water merge across instances. */
export function mergePlatformCost(
  a: PlatformCostState,
  b: PlatformCostState,
): PlatformCostState {
  const month = utcMonth();
  const aM = a.month === month;
  const bM = b.month === month;
  const today = mergeDayBucket(
    a.today?.day ? a.today : emptyDay(),
    b.today?.day ? b.today : emptyDay(),
  );
  return {
    plan: VERCEL_PLAN,
    rates_version: RATES_VERSION,
    month,
    month_usd: Math.max(aM ? a.month_usd || 0 : 0, bM ? b.month_usd || 0 : 0),
    month_invocations: Math.max(
      aM ? a.month_invocations || 0 : 0,
      bM ? b.month_invocations || 0 : 0,
    ),
    month_active_cpu_ms: Math.max(
      aM ? a.month_active_cpu_ms || 0 : 0,
      bM ? b.month_active_cpu_ms || 0 : 0,
    ),
    month_provisioned_gb_hours: Math.max(
      aM ? a.month_provisioned_gb_hours || 0 : 0,
      bM ? b.month_provisioned_gb_hours || 0 : 0,
    ),
    month_cache_hits: Math.max(
      aM ? a.month_cache_hits || 0 : 0,
      bM ? b.month_cache_hits || 0 : 0,
    ),
    today,
    lifetime_usd: Math.max(a.lifetime_usd || 0, b.lifetime_usd || 0),
    lifetime_invocations: Math.max(
      a.lifetime_invocations || 0,
      b.lifetime_invocations || 0,
    ),
    updated_at:
      (a.updated_at || "") >= (b.updated_at || "")
        ? a.updated_at || new Date().toISOString()
        : b.updated_at || new Date().toISOString(),
    savings_notes: [...SAVINGS_NOTES],
  };
}

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

async function fetchRemoteCost(): Promise<PlatformCostState | null> {
  try {
    const url = durableRemoteRawUrl(DURABLE_NAME) + `?t=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryCost/1.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<!")) return null;
    return JSON.parse(text) as PlatformCostState;
  } catch {
    return null;
  }
}

export async function loadPlatformCost(): Promise<PlatformCostState> {
  let local: PlatformCostState | null = null;
  try {
    const raw = await loadDurableJson<PlatformCostState>(
      DURABLE_NAME,
      () => fresh(),
    );
    if (raw && raw.today) local = rollDay({ ...fresh(), ...raw, today: raw.today });
  } catch {
    /* */
  }
  const remoteRaw = await fetchRemoteCost();
  let remote: PlatformCostState | null = null;
  if (remoteRaw?.today) {
    remote = rollDay({ ...fresh(), ...remoteRaw, today: remoteRaw.today });
  }

  let merged = local || fresh();
  if (remote) merged = mergePlatformCost(merged, remote);
  if (mem) merged = mergePlatformCost(merged, rollDay({ ...mem }));
  merged = rollDay(merged);
  mem = merged;
  return merged;
}

function schedulePersist(s: PlatformCostState) {
  mem = s;
  chain = chain.then(async () => {
    try {
      // Merge remote high-water before push so we never clobber
      let next = s;
      try {
        const remote = await fetchRemoteCost();
        if (remote?.today) {
          next = mergePlatformCost(
            s,
            rollDay({ ...fresh(), ...remote, today: remote.today }),
          );
        }
      } catch {
        /* */
      }
      mem = next;
      await saveDurableJson(DURABLE_NAME, next);
    } catch {
      /* local-only ok */
    }
  });
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
  skipped?: boolean;
  vercel_cache?: string | null;
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
      let next = s;
      const remote = await fetchRemoteCost();
      if (remote?.today) {
        next = mergePlatformCost(
          s,
          rollDay({ ...fresh(), ...remote, today: remote.today }),
        );
        // re-apply this event's deltas already in s — merge already high-watered
        next = mergePlatformCost(next, s);
      }
      mem = next;
      await saveDurableJson(DURABLE_NAME, next);
    } catch {
      /* */
    }
  } else {
    schedulePersist(s);
  }
  return s;
}

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

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
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
          ? Math.round(
              (day.cache_hits / (day.cache_hits + day.cache_misses)) * 1000,
            ) / 1000
          : null,
    },
  };
}
