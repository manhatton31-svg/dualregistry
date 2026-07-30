/**
 * Cloudflare KV budgeting for Agents1 → store traffic.
 *
 * Plan is Workers **Paid** (user upgraded 2026-07-29):
 *   writes ~1,000,000 / month included
 *   reads  ~10,000,000 / month included
 *
 * We still soft-budget Agents1 so one runaway loop can't burn the month,
 * but caps are sized for real registry growth (not free-tier 1k/day cliff).
 *
 * On explicit get()/put() limit or 1101 → hard-stop until next UTC day; cache only.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Active CF plan for this deployment */
export const CF_PLAN: "free" | "paid" = "paid";

/** CF included put limit (paid = monthly; we convert to soft daily share). */
export const CF_PUT_LIMIT = CF_PLAN === "paid" ? 1_000_000 : 1_000;
/**
 * Agents1 soft put budget **per UTC day**.
 * Paid: ~2% of monthly included writes if fully used every day — plenty of headroom.
 * Free would be ~180 of 1000.
 */
export const CF_PUT_SOFT = CF_PLAN === "paid" ? 2_500 : 180;

export const CF_GET_LIMIT = CF_PLAN === "paid" ? 10_000_000 : 100_000;
/** Agents1 share of gets per UTC day */
export const AGENTS1_GET_SOFT = CF_PLAN === "paid" ? 40_000 : 1_200;

/** Steady-state max store writes per growth cycle. */
export const MAX_PUTS_PER_CYCLE = CF_PLAN === "paid" ? 20 : 2;

/** First cycle after UTC midnight / after unfreeze. */
export const MAX_PUTS_MIDNIGHT_BURST = CF_PLAN === "paid" ? 50 : 4;

/** Rolling 60-minute put cap. */
export const MAX_PUTS_PER_HOUR = CF_PLAN === "paid" ? 120 : 12;

/** Min between live heavy fetches when healthy. */
export const LIVE_REFRESH_MIN_MS =
  CF_PLAN === "paid" ? 5 * 60 * 1000 : 45 * 60 * 1000;

/** Growth interval when budgets healthy. Probes tick every 6 min for visible movement. */
export const GROWTH_INTERVAL_MS = 6 * 60 * 1000;

/** Dedicated probe-only tick (same cadence; independent of put throttle). */
export const PROBE_TICK_MS = 6 * 60 * 1000;

/** Growth interval when throttled / read-tight. */
export const GROWTH_INTERVAL_THROTTLED_MS =
  CF_PLAN === "paid" ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;

/** Write share for the lagging side when counts diverge. */
export const AGENT_FIRST_SHARE = 0.9;
/** When MCPs lag agents, dedicate this share of puts to MCP (catch-up). */
export const MCP_FIRST_SHARE = 1.0;
/** When within balance band, slight MCP bias so they don't fall behind again. */
export const EVEN_RATE_SHARE = 0.55;
/** Absolute gap (approved counts) before we flip priority. */
export const BALANCE_GAP = 3;
/** Gap at which we go pure MCP-only catch-up (no agent writes). */
export const CATCHUP_GAP = 10;

/** Above this fraction of put budget → 1 put/cycle max on free; softer on paid. */
export const PUT_THROTTLE_PCT = CF_PLAN === "paid" ? 0.7 : 0.45;
/** Above this fraction → discover-only. */
export const PUT_STOP_PCT = CF_PLAN === "paid" ? 0.92 : 0.75;

const PATH = join(process.cwd(), "data", "free-tier.json");
const STORE_ORIGIN = "https://grok-agent-store.manhatton31.workers.dev";

export type FreeTierState = {
  day: string;
  plan?: "free" | "paid";
  put: {
    budget: number;
    used: number;
    hard_stop: boolean;
    hard_stop_at?: string;
  };
  get: {
    budget: number;
    used: number;
    hard_stop: boolean;
    hard_stop_at?: string;
  };
  put_timestamps?: number[];
  last_live_ok_at?: string;
  safe_reason?: string;
  updated_at: string;
};

function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function fresh(day = utcDay()): FreeTierState {
  return {
    day,
    plan: CF_PLAN,
    put: { budget: CF_PUT_SOFT, used: 0, hard_stop: false },
    get: { budget: AGENTS1_GET_SOFT, used: 0, hard_stop: false },
    put_timestamps: [],
    updated_at: new Date().toISOString(),
  };
}

let mem: FreeTierState | null = null;
let chain: Promise<void> = Promise.resolve();

export async function loadFreeTier(): Promise<FreeTierState> {
  if (mem && mem.day === utcDay() && mem.plan === CF_PLAN) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    const p = JSON.parse(raw) as FreeTierState;
    if (p.day !== utcDay()) {
      mem = fresh();
      await persist(mem);
      return mem;
    }
    // Plan upgrade: reset hard stops and adopt new budgets
    const planChanged = p.plan !== CF_PLAN;
    mem = {
      ...fresh(p.day),
      last_live_ok_at: p.last_live_ok_at,
      plan: CF_PLAN,
      put: {
        budget: CF_PUT_SOFT,
        used: planChanged
          ? 0
          : Math.min(CF_PUT_SOFT, Math.max(0, p.put?.used ?? 0)),
        hard_stop: planChanged ? false : Boolean(p.put?.hard_stop),
        hard_stop_at: planChanged ? undefined : p.put?.hard_stop_at,
      },
      get: {
        budget: AGENTS1_GET_SOFT,
        used: planChanged
          ? 0
          : Math.min(AGENTS1_GET_SOFT, Math.max(0, p.get?.used ?? 0)),
        hard_stop: planChanged ? false : Boolean(p.get?.hard_stop),
        hard_stop_at: planChanged ? undefined : p.get?.hard_stop_at,
      },
      put_timestamps: planChanged
        ? []
        : Array.isArray(p.put_timestamps)
          ? p.put_timestamps.filter((t) => Date.now() - t < 3_600_000)
          : [],
      safe_reason: planChanged
        ? `CF plan → ${CF_PLAN}: budgets reset, growth reopened`
        : p.safe_reason,
      updated_at: new Date().toISOString(),
    };
    if (planChanged) await persist(mem);
    return mem;
  } catch {
    mem = fresh();
    await persist(mem);
    return mem;
  }
}

async function persist(s: FreeTierState) {
  mem = s;
  chain = chain.then(async () => {
    await mkdir(dirname(PATH), { recursive: true });
    const tmp = `${PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
    await rename(tmp, PATH);
  });
  await chain;
}

export function putRemaining(s: FreeTierState): number {
  if (s.put.hard_stop) return 0;
  return Math.max(0, s.put.budget - s.put.used);
}

export function getRemaining(s: FreeTierState): number {
  if (s.get.hard_stop) return 0;
  return Math.max(0, s.get.budget - s.get.used);
}

export function isReadSafe(s: FreeTierState): boolean {
  return s.get.hard_stop || getRemaining(s) <= 0;
}

export function isWriteSafe(s: FreeTierState): boolean {
  return s.put.hard_stop || putRemaining(s) <= 0;
}

export function isFullyThrottled(s: FreeTierState): boolean {
  return isReadSafe(s) || isWriteSafe(s);
}

export function putsInLastHour(s: FreeTierState): number {
  const cutoff = Date.now() - 3_600_000;
  return (s.put_timestamps || []).filter((t) => t >= cutoff).length;
}

export function hourlyPutRemaining(s: FreeTierState): number {
  if (s.put.hard_stop) return 0;
  return Math.max(0, MAX_PUTS_PER_HOUR - putsInLastHour(s));
}

export function cyclePutCap(s: FreeTierState, midnightBurst = false): number {
  if (isWriteSafe(s)) return 0;
  const dayLeft = putRemaining(s);
  const hourLeft = hourlyPutRemaining(s);
  const ratio = s.put.budget > 0 ? s.put.used / s.put.budget : 1;
  if (ratio >= PUT_STOP_PCT) return 0;
  let base = midnightBurst ? MAX_PUTS_MIDNIGHT_BURST : MAX_PUTS_PER_CYCLE;
  if (ratio >= PUT_THROTTLE_PCT)
    base = Math.max(1, Math.floor(MAX_PUTS_PER_CYCLE / 4));
  return Math.min(base, dayLeft, hourLeft);
}

export function msUntilUtcMidnight(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      5,
      0,
    ),
  );
  return Math.max(60_000, next.getTime() - now.getTime());
}

export function isHeavyStorePath(path: string): boolean {
  const p = path.replace(STORE_ORIGIN, "");
  return (
    p.startsWith("/health") ||
    p.startsWith("/v1/milestones") ||
    p.startsWith("/v1/poll") ||
    p.startsWith("/v1/agents") ||
    p.startsWith("/v1/registry") ||
    p.startsWith("/agents.json") ||
    p.startsWith("/registry.json") ||
    p.startsWith("/agent-registry") ||
    p.includes("well-known/agents")
  );
}

export function detectKvLimitMessage(text: string): "get" | "put" | null {
  if (/kv get\(\) limit|get\(\) limit exceeded/i.test(text)) return "get";
  if (/kv put\(\) limit|put\(\) limit exceeded/i.test(text)) return "put";
  if (/kv.*limit exceeded/i.test(text)) {
    if (/put/i.test(text)) return "put";
    return "get";
  }
  if (/error code:\s*1101/i.test(text)) return "get";
  if (/exceeded.*quota|quota.*exceeded|too many requests.*kv/i.test(text))
    return "get";
  return null;
}

export async function recordGet(n = 1): Promise<FreeTierState> {
  const s = await loadFreeTier();
  s.get.used = Math.min(s.get.budget, s.get.used + n);
  s.updated_at = new Date().toISOString();
  if (s.get.used >= s.get.budget) {
    s.get.hard_stop = true;
    s.get.hard_stop_at = s.get.hard_stop_at || new Date().toISOString();
    s.safe_reason =
      "Agents1 daily get soft-budget exhausted (protect store paid allotment)";
  }
  await persist(s);
  return s;
}

export async function recordPut(n = 1): Promise<FreeTierState> {
  const s = await loadFreeTier();
  const now = Date.now();
  s.put.used = Math.min(s.put.budget, s.put.used + n);
  s.put_timestamps = [
    ...(s.put_timestamps || []).filter((t) => now - t < 3_600_000),
    ...Array.from({ length: n }, () => now),
  ];
  s.updated_at = new Date().toISOString();
  if (s.put.used >= s.put.budget) {
    s.put.hard_stop = true;
    s.put.hard_stop_at = s.put.hard_stop_at || new Date().toISOString();
    s.safe_reason = `Agents1 daily put soft-budget exhausted (${CF_PUT_SOFT}/day on ${CF_PLAN})`;
  }
  if (hourlyPutRemaining(s) <= 0 && !s.put.hard_stop) {
    s.safe_reason = `Hourly put cap (${MAX_PUTS_PER_HOUR}/h) reached — pause growth writes briefly`;
  }
  await persist(s);
  return s;
}

export async function tripGetLimit(reason: string): Promise<FreeTierState> {
  const s = await loadFreeTier();
  s.get.hard_stop = true;
  s.get.hard_stop_at = new Date().toISOString();
  s.get.used = s.get.budget;
  s.safe_reason = reason;
  s.updated_at = s.get.hard_stop_at;
  await persist(s);
  return s;
}

export async function tripPutLimit(reason: string): Promise<FreeTierState> {
  const s = await loadFreeTier();
  s.put.hard_stop = true;
  s.put.hard_stop_at = new Date().toISOString();
  s.put.used = s.put.budget;
  s.safe_reason = reason;
  s.updated_at = s.put.hard_stop_at;
  await persist(s);
  return s;
}

export async function tripCfExhausted(
  kind: "get" | "put" | "both",
  reason: string,
): Promise<FreeTierState> {
  if (kind === "get" || kind === "both") await tripGetLimit(reason);
  if (kind === "put" || kind === "both") await tripPutLimit(reason);
  return loadFreeTier();
}

/** Clear hard-stops and adopt current plan budgets (e.g. after CF Paid upgrade). */
export async function reopenAfterUpgrade(reason?: string): Promise<FreeTierState> {
  const s = fresh(utcDay());
  s.safe_reason =
    reason ||
    `CF ${CF_PLAN} active — write/read safe cleared; growth reopened with paid caps`;
  s.updated_at = new Date().toISOString();
  await persist(s);
  return s;
}

export async function markLiveOk(): Promise<void> {
  const s = await loadFreeTier();
  s.last_live_ok_at = new Date().toISOString();
  s.updated_at = s.last_live_ok_at;
  await persist(s);
}

export async function shouldLiveFetch(opts?: {
  force?: boolean;
}): Promise<{ allow: boolean; reason: string; state: FreeTierState }> {
  const s = await loadFreeTier();
  if (opts?.force) {
    if (isReadSafe(s)) {
      return {
        allow: false,
        reason: "read-safe: store get budget exhausted until UTC midnight",
        state: s,
      };
    }
    if (s.last_live_ok_at) {
      const age = Date.now() - Date.parse(s.last_live_ok_at);
      const forceMin = Math.min(LIVE_REFRESH_MIN_MS, 60 * 1000);
      if (age >= 0 && age < forceMin) {
        return {
          allow: false,
          reason: `force cool-down ${Math.ceil((forceMin - age) / 1000)}s — serve cache`,
          state: s,
        };
      }
    }
    return { allow: true, reason: "forced refresh", state: s };
  }
  if (isReadSafe(s)) {
    return {
      allow: false,
      reason: "read-safe mode — using last-known-good cache only",
      state: s,
    };
  }
  const ttl =
    isWriteSafe(s) || s.put.used / s.put.budget >= PUT_THROTTLE_PCT
      ? LIVE_REFRESH_MIN_MS * 2
      : LIVE_REFRESH_MIN_MS;
  if (s.last_live_ok_at) {
    const age = Date.now() - Date.parse(s.last_live_ok_at);
    if (age >= 0 && age < ttl) {
      return {
        allow: false,
        reason: `live TTL ${Math.ceil((ttl - age) / 1000)}s remaining — serve cache`,
        state: s,
      };
    }
  }
  return { allow: true, reason: "live refresh due", state: s };
}

export async function canSubmit(): Promise<{
  allow: boolean;
  reason: string;
  state: FreeTierState;
}> {
  const s = await loadFreeTier();
  if (isReadSafe(s)) {
    return {
      allow: false,
      reason:
        "read-safe: store get() quota exhausted — submits also read KV; wait for UTC midnight",
      state: s,
    };
  }
  if (isWriteSafe(s)) {
    return {
      allow: false,
      reason: `put budget exhausted (${s.put.used}/${s.put.budget}) until UTC midnight`,
      state: s,
    };
  }
  if (hourlyPutRemaining(s) <= 0) {
    return {
      allow: false,
      reason: `hourly put cap ${MAX_PUTS_PER_HOUR}/h reached (${putsInLastHour(s)} in last hour)`,
      state: s,
    };
  }
  if (s.put.budget > 0 && s.put.used / s.put.budget >= PUT_STOP_PCT) {
    return {
      allow: false,
      reason: `put throttle ≥${Math.round(PUT_STOP_PCT * 100)}% of daily soft budget — discover-only until tomorrow`,
      state: s,
    };
  }
  return { allow: true, reason: "ok", state: s };
}

export function publicBudgetView(s: FreeTierState) {
  const putRem = putRemaining(s);
  const getRem = getRemaining(s);
  const hourUsed = putsInLastHour(s);
  return {
    day: s.day,
    plan: CF_PLAN,
    put: {
      budget: s.put.budget,
      used: s.put.used,
      remaining: putRem,
      hard_stop: s.put.hard_stop,
      cf_limit: CF_PUT_LIMIT,
      cf_limit_period: CF_PLAN === "paid" ? "month" : "day",
      hourly_used: hourUsed,
      hourly_cap: MAX_PUTS_PER_HOUR,
      hourly_remaining: hourlyPutRemaining(s),
      cycle_cap_now: cyclePutCap(s, false),
    },
    get: {
      budget: s.get.budget,
      used: s.get.used,
      remaining: getRem,
      hard_stop: s.get.hard_stop,
      cf_limit: CF_GET_LIMIT,
      note:
        CF_PLAN === "paid"
          ? "Workers Paid — Agents1 daily soft share of monthly included reads"
          : "Agents1 share only — store worker uses the rest of free gets",
    },
    read_safe: isReadSafe(s),
    write_safe: isWriteSafe(s),
    fully_throttled: isFullyThrottled(s),
    last_live_ok_at: s.last_live_ok_at,
    safe_reason: s.safe_reason,
    policy: [
      `Plan: Workers ${CF_PLAN}.`,
      `Puts: Agents1 soft ${CF_PUT_SOFT}/day (CF included ~${CF_PUT_LIMIT}${CF_PLAN === "paid" ? "/mo" : "/day"}). ≤${MAX_PUTS_PER_CYCLE}/cycle · ≤${MAX_PUTS_PER_HOUR}/hour · burst ≤${MAX_PUTS_MIDNIGHT_BURST}.`,
      `Gets: Agents1 soft ${AGENTS1_GET_SOFT}/day.`,
      `Live refresh ≤ every ${LIVE_REFRESH_MIN_MS / 60000} min · growth every ${GROWTH_INTERVAL_MS / 60000} min when healthy.`,
      `On real KV limit/1101 → hard-stop until UTC midnight.`,
    ].join(" "),
    resets_in_ms: msUntilUtcMidnight(),
  };
}
