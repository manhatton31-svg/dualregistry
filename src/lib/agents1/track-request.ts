/**
 * Lightweight request tracking — platform cost + optional agent-run.
 * Prefer deferWork so cost ledger never extends provisioned wall time.
 */
import { deferWork } from "./defer-work";
import type { CostClass } from "./vercel-platform";
import {
  type RecordUsageInput,
  recordPlatformUsage,
} from "./platform-cost";
import { parseVercelCacheStatus } from "./discovery-cache";

export type TrackOpts = {
  class: CostClass;
  route: string;
  label?: string;
  cache_hit?: boolean;
  skipped?: boolean;
  response_bytes?: number;
  /** When true (default), bill after response via waitUntil */
  defer?: boolean;
};

export function trackPlatformCost(
  input: RecordUsageInput,
  opts?: { defer?: boolean },
): void {
  const run = () => recordPlatformUsage(input).then(() => undefined);
  if (opts?.defer === false) {
    void run().catch(() => undefined);
    return;
  }
  deferWork(run);
}

/** Wrap a handler: measure wall, bill Active CPU estimate, optional cache_hit. */
export async function withTrackedRequest<T extends Response>(
  opts: TrackOpts,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const res = await fn();
    const wall_ms = Date.now() - t0;
    let cache_hit = opts.cache_hit;
    if (cache_hit == null && res.headers) {
      const parsed = parseVercelCacheStatus(res.headers);
      if (res.status === 304) cache_hit = true;
      else if (parsed.hit) cache_hit = true;
    }
    const cl = Number(res.headers.get("content-length") || 0);
    const bytes =
      opts.response_bytes !== undefined
        ? opts.response_bytes
        : cl > 0
          ? cl
          : undefined;
    trackPlatformCost(
      {
        class: opts.class,
        wall_ms,
        route: opts.route,
        label: opts.label,
        cache_hit,
        skipped: opts.skipped || res.status === 304,
        response_bytes: bytes,
      },
      { defer: opts.defer !== false },
    );
    return res;
  } catch (e) {
    const wall_ms = Date.now() - t0;
    trackPlatformCost(
      {
        class: opts.class,
        wall_ms,
        route: opts.route,
        label: `${opts.label || "error"}:fail`,
      },
      { defer: opts.defer !== false },
    );
    throw e;
  }
}
