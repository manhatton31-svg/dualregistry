/**
 * Vercel Pro + Fluid compute — rates & estimators aligned to dashboard dimensions.
 *
 * Dashboard bills (Fluid / Active CPU pricing):
 *   1. Active CPU        — CPU ms your code actively executes (I/O wait free)
 *   2. Provisioned Memory — GB-hours while the instance serves a request
 *   3. Invocations       — per request
 *   4. Fast Data Transfer / Bandwidth (optional proxy)
 *   5. Edge Requests / CDN cache (hits avoid origin Active CPU)
 *
 * Rates are Pro on-demand for default region (iad1-class). Recalibrate via
 * VERCEL_RATE_* env if dashboard diverges — rates_version stamped on every rollup.
 *
 * Sources: vercel.com/docs/fluid-compute · /docs/functions/usage-and-pricing
 */
export const VERCEL_PLAN: "hobby" | "pro" | "enterprise" = "pro";
export const FLUID_ENABLED = true;
export const RATES_VERSION = "2026-07-fluid-pro-iad1-v1";

/** Standard Fluid machine: 1 vCPU · 2 GB (Pro default) */
export const FLUID_MEMORY_MB = 2048;
export const FLUID_VCPU = 1;

/**
 * Pro on-demand rates (USD). Active CPU starts ~$0.128/vCPU-hr;
 * provisioned memory ~$0.0106/GB-hr (Standard 2 GB pair ≈ $0.149/hr fully busy).
 * Invocations: first 1M often covered by Pro credit; on-demand ~$0.60/M.
 */
export const PRO_RATES = {
  active_cpu_usd_per_hour: numEnv(
    "VERCEL_RATE_ACTIVE_CPU_USD_PER_HR",
    0.128,
  ),
  provisioned_memory_usd_per_gb_hour: numEnv(
    "VERCEL_RATE_MEM_USD_PER_GB_HR",
    0.0106,
  ),
  invocation_usd: numEnv("VERCEL_RATE_INVOCATION_USD", 0.6 / 1_000_000),
  /** Fast Origin Transfer approx — used only when bytes recorded */
  bandwidth_usd_per_gb: numEnv("VERCEL_RATE_BANDWIDTH_USD_PER_GB", 0.15),
} as const;

/** Pro plan monthly credit (informational — does not auto-zero ledger) */
export const PRO_MONTHLY_CREDIT_USD = 20;

export type CostClass =
  | "cron_probe"
  | "cron_prefilter"
  | "mcp"
  | "api_read"
  | "api_write"
  | "dashboard"
  | "discovery"
  | "product"
  | "agent_tool"
  | "other";

/**
 * Fraction of wall-clock that is typically Active CPU (rest is I/O wait).
 * Fluid only bills the active share — estimating correctly prevents over-count.
 */
export const ACTIVE_CPU_RATIO: Record<CostClass, number> = {
  cron_probe: 0.18, // network handshakes dominate
  cron_prefilter: 0.35,
  mcp: 0.45,
  api_read: 0.4,
  api_write: 0.55,
  dashboard: 0.5,
  discovery: 0.35,
  product: 0.5,
  agent_tool: 0.5,
  other: 0.45,
};

function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type UsageSample = {
  wall_ms: number;
  active_cpu_ms: number;
  provisioned_memory_mb: number;
  invocations: number;
  response_bytes?: number;
  cache_hit?: boolean;
  class: CostClass;
  route?: string;
  label?: string;
};

export type CostBreakdown = {
  active_cpu_hours: number;
  provisioned_gb_hours: number;
  invocations: number;
  bandwidth_gb: number;
  usd_active_cpu: number;
  usd_provisioned_memory: number;
  usd_invocations: number;
  usd_bandwidth: number;
  usd_total: number;
  rates_version: string;
};

export function estimateActiveCpuMs(
  wallMs: number,
  costClass: CostClass,
  opts?: { active_cpu_ms?: number },
): number {
  if (opts?.active_cpu_ms != null && Number.isFinite(opts.active_cpu_ms)) {
    return Math.max(0, opts.active_cpu_ms);
  }
  const ratio = ACTIVE_CPU_RATIO[costClass] ?? ACTIVE_CPU_RATIO.other;
  return Math.max(0, Math.round(wallMs * ratio));
}

export function costFromUsage(u: {
  active_cpu_ms: number;
  wall_ms: number;
  provisioned_memory_mb?: number;
  invocations?: number;
  response_bytes?: number;
}): CostBreakdown {
  const memMb = u.provisioned_memory_mb ?? FLUID_MEMORY_MB;
  const inv = u.invocations ?? 1;
  const active_cpu_hours = u.active_cpu_ms / 3_600_000;
  const provisioned_gb_hours =
    (memMb / 1024) * (Math.max(0, u.wall_ms) / 3_600_000);
  const bandwidth_gb = Math.max(0, (u.response_bytes || 0) / (1024 * 1024 * 1024));

  const usd_active_cpu =
    active_cpu_hours * PRO_RATES.active_cpu_usd_per_hour * FLUID_VCPU;
  const usd_provisioned_memory =
    provisioned_gb_hours * PRO_RATES.provisioned_memory_usd_per_gb_hour;
  const usd_invocations = inv * PRO_RATES.invocation_usd;
  const usd_bandwidth = bandwidth_gb * PRO_RATES.bandwidth_usd_per_gb;
  const usd_total =
    usd_active_cpu +
    usd_provisioned_memory +
    usd_invocations +
    usd_bandwidth;

  return {
    active_cpu_hours,
    provisioned_gb_hours,
    invocations: inv,
    bandwidth_gb,
    usd_active_cpu,
    usd_provisioned_memory,
    usd_invocations,
    usd_bandwidth,
    usd_total,
    rates_version: RATES_VERSION,
  };
}

export function platformPublicMeta() {
  return {
    plan: VERCEL_PLAN,
    fluid: FLUID_ENABLED,
    fluid_memory_mb: FLUID_MEMORY_MB,
    fluid_vcpu: FLUID_VCPU,
    rates_version: RATES_VERSION,
    rates: {
      active_cpu_usd_per_hour: PRO_RATES.active_cpu_usd_per_hour,
      provisioned_memory_usd_per_gb_hour:
        PRO_RATES.provisioned_memory_usd_per_gb_hour,
      invocation_usd: PRO_RATES.invocation_usd,
      bandwidth_usd_per_gb: PRO_RATES.bandwidth_usd_per_gb,
    },
    pro_monthly_credit_usd: PRO_MONTHLY_CREDIT_USD,
    dashboard_dimensions: [
      "Active CPU",
      "Provisioned Memory",
      "Invocations",
      "Fast Data Transfer (approx)",
      "CDN / Edge cache hits (saved origin)",
    ],
    note:
      "Internal ledger mirrors Vercel Fluid dashboard dimensions. Absolute $ uses published Pro rates (recalibrate with VERCEL_RATE_* if needed). Cache hits are origin-avoided and reduce Active CPU.",
  };
}
