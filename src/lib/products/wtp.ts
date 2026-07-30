/**
 * Willingness-to-pay (WTP) aggregation from agent feedback.
 * Honest values only — $0 is a first-class answer.
 */
import { LAUNCH_PRICES, formatUsd } from "./catalog";

export type WtpSku = "kernel" | "recursive" | "alive";

export type WtpSample = {
  source: string;
  agent_name?: string;
  at: string;
  kernel_usd: number | null;
  recursive_usd: number | null;
  alive_usd: number | null;
  confidence?: number | null;
  why?: string;
  would_buy_at_founding?: boolean | null;
};

export type WtpStats = {
  n: number;
  zeros: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  max: number | null;
  /** Share with WTP >= founding list price */
  share_at_or_above_founding: number | null;
  founding_usd: number;
};

export type WtpReport = {
  updated_at: string;
  note: string;
  founding: {
    kernel: string;
    recursive: string;
    alive: string;
  };
  by_sku: Record<WtpSku, WtpStats>;
  samples: WtpSample[];
  recommendations: string[];
};

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round((sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)) * 100) / 100;
}

function stats(values: number[], foundingCents: number): WtpStats {
  const founding_usd = foundingCents / 100;
  if (!values.length) {
    return {
      n: 0,
      zeros: 0,
      mean: null,
      median: null,
      p25: null,
      p75: null,
      max: null,
      share_at_or_above_founding: null,
      founding_usd,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const zeros = values.filter((v) => v === 0).length;
  const mean =
    Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
  const atFounding = values.filter((v) => v >= founding_usd).length;
  return {
    n: values.length,
    zeros,
    mean,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    max: sorted[sorted.length - 1],
    share_at_or_above_founding:
      Math.round((atFounding / values.length) * 1000) / 10,
    founding_usd,
  };
}

/** Parse USD from answer — allows 0; rejects negative / non-numeric */
export function parseWtpUsd(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  // Cap absurd outliers for aggregation (keep raw in sample)
  return Math.round(n * 100) / 100;
}

export function extractWtpFromAnswers(
  answers: Record<string, unknown> | undefined,
  meta?: { source?: string; agent_name?: string; at?: string },
): WtpSample | null {
  if (!answers) return null;
  const kernel_usd = parseWtpUsd(answers.wtp_kernel_usd);
  const recursive_usd = parseWtpUsd(answers.wtp_recursive_usd);
  const alive_usd = parseWtpUsd(answers.wtp_alive_usd);
  // Also accept single max field
  const single = parseWtpUsd(answers.wtp_max_usd ?? answers.wtp_usd);
  if (
    kernel_usd == null &&
    recursive_usd == null &&
    alive_usd == null &&
    single == null
  ) {
    return null;
  }
  let would_buy: boolean | null = null;
  if (answers.would_buy_at_founding === true || answers.would_buy_at_founding === "yes")
    would_buy = true;
  if (answers.would_buy_at_founding === false || answers.would_buy_at_founding === "no")
    would_buy = false;
  if (typeof answers.would_buy_at_founding === "string") {
    const s = answers.would_buy_at_founding.toLowerCase();
    if (s === "yes" || s === "true") would_buy = true;
    if (s === "no" || s === "false") would_buy = false;
    if (s === "maybe" || s === "unsure") would_buy = null;
  }

  return {
    source: meta?.source || "unknown",
    agent_name: meta?.agent_name,
    at: meta?.at || new Date().toISOString(),
    kernel_usd: kernel_usd ?? (single != null ? single : null),
    recursive_usd: recursive_usd,
    alive_usd: alive_usd ?? (single != null ? single : null),
    confidence:
      typeof answers.wtp_confidence === "number"
        ? Number(answers.wtp_confidence)
        : answers.wtp_confidence != null
          ? Number(answers.wtp_confidence)
          : null,
    why: answers.wtp_why
      ? String(answers.wtp_why).slice(0, 400)
      : answers.would_pay_for
        ? String(answers.would_pay_for).slice(0, 400)
        : undefined,
    would_buy_at_founding: would_buy,
  };
}

export function buildWtpReport(samples: WtpSample[]): WtpReport {
  const k = samples.map((s) => s.kernel_usd).filter((v): v is number => v != null);
  const r = samples
    .map((s) => s.recursive_usd)
    .filter((v): v is number => v != null);
  const a = samples.map((s) => s.alive_usd).filter((v): v is number => v != null);

  const by_sku: Record<WtpSku, WtpStats> = {
    kernel: stats(k, LAUNCH_PRICES.kernel),
    recursive: stats(r, LAUNCH_PRICES.recursive),
    alive: stats(a, LAUNCH_PRICES.alive),
  };

  const recommendations: string[] = [];
  for (const sku of ["kernel", "recursive", "alive"] as WtpSku[]) {
    const st = by_sku[sku];
    if (st.n === 0) {
      recommendations.push(
        `${sku}: no WTP samples yet — keep asking honest $ (0 allowed)`,
      );
      continue;
    }
    const zeroShare = Math.round((st.zeros / st.n) * 100);
    if (zeroShare >= 40) {
      recommendations.push(
        `${sku}: ${zeroShare}% answered $0 — product value not clear enough pre-pay; fix install/prompt first`,
      );
    }
    if (st.median != null && st.median < st.founding_usd * 0.7) {
      recommendations.push(
        `${sku}: median WTP $${st.median} is well below founding ${formatUsd(st.founding_usd * 100)} — consider holding list price only for founding scarcity or lower efficiency tier`,
      );
    }
    if (st.median != null && st.median >= st.founding_usd) {
      recommendations.push(
        `${sku}: median WTP $${st.median} ≥ founding ${formatUsd(st.founding_usd * 100)} — founding price is supportable (${st.share_at_or_above_founding}% at/above)`,
      );
    }
    if (st.p75 != null && st.p75 >= st.founding_usd * 1.5) {
      recommendations.push(
        `${sku}: p75 $${st.p75} — room for Alive Max / premium tier above founding`,
      );
    }
  }
  if (!recommendations.length) {
    recommendations.push("Collect more WTP samples for stable pricing signal");
  }

  return {
    updated_at: new Date().toISOString(),
    note: "Honest agent willingness-to-pay. $0 is valid. Not a commitment to buy — directional for founding pricing.",
    founding: {
      kernel: formatUsd(LAUNCH_PRICES.kernel),
      recursive: formatUsd(LAUNCH_PRICES.recursive),
      alive: formatUsd(LAUNCH_PRICES.alive),
    },
    by_sku,
    samples: samples.slice(0, 100),
    recommendations,
  };
}
