/**
 * CDN-aware cache headers for discovery surfaces.
 *
 * Vercel Fluid serverless often ignores s-maxage on Cache-Control alone.
 * CDN-Cache-Control / Vercel-CDN-Cache-Control actually stop at the edge
 * and cut Active CPU on hot discovery paths (llms.txt, agent-card, etc.).
 */
export function discoveryCacheHeaders(opts?: {
  /** Browser max-age seconds (default 60) */
  browser?: number;
  /** CDN / edge max-age seconds (default 300) */
  cdn?: number;
  /** stale-while-revalidate seconds (default 2× cdn) */
  swr?: number;
}): Record<string, string> {
  const browser = opts?.browser ?? 60;
  const cdn = opts?.cdn ?? 300;
  const swr = opts?.swr ?? cdn * 2;
  const browserCC = `public, max-age=${browser}, s-maxage=${cdn}, stale-while-revalidate=${swr}`;
  const edgeCC = `public, s-maxage=${cdn}, stale-while-revalidate=${swr}`;
  return {
    "cache-control": browserCC,
    "cdn-cache-control": edgeCC,
    "vercel-cdn-cache-control": edgeCC,
  };
}
