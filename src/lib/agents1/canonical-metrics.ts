/**
 * Single source of truth for public metrics.
 *
 * Production (Vercel / dualregistry.dev): local durable + GitHub data/prod.
 * Grok sandbox / local preview: ALWAYS prefer production API so the phone
 * site and sandbox dashboard show the same probes, demos, feedback, times.
 */
import { CANONICAL_PUBLIC_ORIGIN } from "./public-origin";

export const CANONICAL_API = CANONICAL_PUBLIC_ORIGIN;

export function isProductionRuntime(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env.VERCEL) return true;
  if (process.env.AGENTS1_CANONICAL_WRITER === "1") return true;
  // Explicit dualregistry production host bind
  if (process.env.AGENTS1_PUBLIC_ORIGIN === CANONICAL_PUBLIC_ORIGIN) {
    // still may be sandbox with origin set — only Vercel is writer
    return Boolean(process.env.VERCEL);
  }
  return false;
}

/** Sandbox / preview / local — must mirror production public numbers */
export function shouldMirrorProductionMetrics(): boolean {
  if (isProductionRuntime()) return false;
  if (process.env.AGENTS1_MIRROR_PRODUCTION === "0") return false;
  return true;
}

export type CanonicalDashboardSlice = {
  product_engagement: unknown;
  protocol: { probes: unknown };
  listing_lanes?: { counts?: unknown } | null;
  source: "production" | "local";
  mirrored_from?: string;
  mirrored_at?: string;
};

let mirrorCache: { at: number; data: CanonicalDashboardSlice } | null = null;
const MIRROR_TTL_MS = 8_000;

export async function fetchProductionDashboardSlice(): Promise<CanonicalDashboardSlice | null> {
  if (mirrorCache && Date.now() - mirrorCache.at < MIRROR_TTL_MS) {
    return mirrorCache.data;
  }
  try {
    const url = `${CANONICAL_API}/api/dashboard?refresh=1&mirror=1`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryMirror/1.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      product_engagement?: unknown;
      protocol?: { probes?: unknown };
      listing_lanes?: { counts?: unknown };
    };
    const slice: CanonicalDashboardSlice = {
      product_engagement: d.product_engagement ?? null,
      protocol: { probes: d.protocol?.probes ?? null },
      listing_lanes: d.listing_lanes
        ? { counts: d.listing_lanes.counts }
        : null,
      source: "production",
      mirrored_from: CANONICAL_API,
      mirrored_at: new Date().toISOString(),
    };
    mirrorCache = { at: Date.now(), data: slice };
    return slice;
  } catch {
    return null;
  }
}
