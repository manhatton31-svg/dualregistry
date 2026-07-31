/**
 * Defer non-critical work past the response (Fluid: less provisioned wall time).
 * Uses @vercel/functions waitUntil when available; otherwise fire-and-forget.
 */
export function deferWork(work: Promise<unknown> | (() => Promise<unknown>)): void {
  const p = typeof work === "function" ? work() : work;
  const safe = Promise.resolve(p).catch(() => undefined);

  // Sync path: global waitUntil (some runtimes inject it)
  try {
    const g = globalThis as typeof globalThis & {
      waitUntil?: (p: Promise<unknown>) => void;
    };
    if (typeof g.waitUntil === "function") {
      g.waitUntil(safe);
      return;
    }
  } catch {
    /* */
  }

  // Async path: load @vercel/functions without blocking the response
  void import("@vercel/functions")
    .then((mod) => {
      if (typeof mod.waitUntil === "function") {
        mod.waitUntil(safe);
      }
    })
    .catch(() => {
      /* not on Vercel — fire-and-forget already started via void safe below if needed */
    });

  // Always keep the promise alive even if waitUntil missing
  void safe;
}
