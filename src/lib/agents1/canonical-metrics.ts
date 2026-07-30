/**
 * Single source of truth for public metrics.
 *
 * Production (Vercel / dualregistry.dev): local durable + GitHub data/prod.
 * Grok sandbox / local preview: ALWAYS prefer production API so the phone
 * site and sandbox dashboard show the same probes, demos, feedback, times,
 * In Registry, and Live counts.
 */
import { CANONICAL_PUBLIC_ORIGIN } from "./public-origin";

export const CANONICAL_API = CANONICAL_PUBLIC_ORIGIN;

export function isProductionRuntime(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env.VERCEL) return true;
  if (process.env.AGENTS1_CANONICAL_WRITER === "1") return true;
  if (process.env.AGENTS1_PUBLIC_ORIGIN === CANONICAL_PUBLIC_ORIGIN) {
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
  /** In Registry card */
  mcp?: { total?: number } | null;
  agents?: { total?: number } | null;
  delist?: unknown;
  milestones?: unknown;
  source: "production" | "local";
  mirrored_from?: string;
  mirrored_at?: string;
};

let mirrorCache: { at: number; data: CanonicalDashboardSlice } | null = null;
const MIRROR_TTL_MS = 3_000;

export async function fetchProductionDashboardSlice(): Promise<CanonicalDashboardSlice | null> {
  if (mirrorCache && Date.now() - mirrorCache.at < MIRROR_TTL_MS) {
    return mirrorCache.data;
  }
  try {
    // Soft poll path on production is fast and already includes probes/engagement
    const url = `${CANONICAL_API}/api/dashboard?mirror=1`;
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
      mcp?: { total?: number };
      agents?: { total?: number };
      delist?: unknown;
      milestones?: unknown;
    };
    const slice: CanonicalDashboardSlice = {
      product_engagement: d.product_engagement ?? null,
      protocol: { probes: d.protocol?.probes ?? null },
      listing_lanes: d.listing_lanes
        ? { counts: d.listing_lanes.counts }
        : null,
      mcp: d.mcp ? { total: d.mcp.total } : null,
      agents: d.agents ? { total: d.agents.total } : null,
      delist: d.delist ?? null,
      milestones: d.milestones ?? null,
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

export function invalidateMirrorCache() {
  mirrorCache = null;
}
