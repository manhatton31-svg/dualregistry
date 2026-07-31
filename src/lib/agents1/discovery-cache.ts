/**
 * CDN-aware cache headers + ETag / 304 for discovery surfaces.
 *
 * Vercel Fluid often ignores s-maxage on Cache-Control alone.
 * CDN-Cache-Control / Vercel-CDN-Cache-Control stop at the edge and cut
 * Active CPU on hot discovery paths (llms.txt, agent-card, MCP card, etc.).
 */
import { createHash } from "node:crypto";

export function discoveryCacheHeaders(opts?: {
  /** Browser max-age seconds (default 60) */
  browser?: number;
  /** CDN / edge max-age seconds (default 300) */
  cdn?: number;
  /** stale-while-revalidate seconds (default 2× cdn) */
  swr?: number;
  /** weak ETag value (with or without W/ quotes) */
  etag?: string;
  /** vary header extras */
  vary?: string;
}): Record<string, string> {
  const browser = opts?.browser ?? 60;
  const cdn = opts?.cdn ?? 300;
  const swr = opts?.swr ?? cdn * 2;
  const browserCC = `public, max-age=${browser}, s-maxage=${cdn}, stale-while-revalidate=${swr}`;
  const edgeCC = `public, s-maxage=${cdn}, stale-while-revalidate=${swr}`;
  const headers: Record<string, string> = {
    "cache-control": browserCC,
    "cdn-cache-control": edgeCC,
    "vercel-cdn-cache-control": edgeCC,
    "access-control-allow-origin": "*",
  };
  if (opts?.etag) {
    headers.etag = normalizeEtag(opts.etag);
  }
  if (opts?.vary) {
    headers.vary = opts.vary;
  }
  return headers;
}

/** Soft private cache for operator UIs (never public CDN). */
export function softPrivateCacheHeaders(opts?: {
  browser?: number;
  swr?: number;
}): Record<string, string> {
  const browser = opts?.browser ?? 30;
  const swr = opts?.swr ?? 60;
  return {
    "cache-control": `private, max-age=${browser}, stale-while-revalidate=${swr}`,
  };
}

export function normalizeEtag(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("W/") || t.startsWith('"')) return t;
  return `W/"${t}"`;
}

/** Stable weak ETag from JSON-serializable body or string. */
export function etagFromBody(body: unknown): string {
  const raw =
    typeof body === "string" ? body : JSON.stringify(body ?? null);
  const hash = createHash("sha1").update(raw).digest("base64url").slice(0, 20);
  return `W/"${hash}"`;
}

/**
 * If client's If-None-Match matches etag → 304 Response; else null.
 */
export function maybeNotModified(
  request: Request,
  etag: string,
  extraHeaders?: Record<string, string>,
): Response | null {
  const inm = request.headers.get("if-none-match");
  if (!inm) return null;
  const want = normalizeEtag(etag);
  const tokens = inm.split(",").map((s) => s.trim());
  const hit = tokens.some(
    (t) => t === "*" || t === want || t === want.replace(/^W\//, ""),
  );
  if (!hit) return null;
  return new Response(null, {
    status: 304,
    headers: {
      etag: want,
      ...extraHeaders,
    },
  });
}

/**
 * JSON response with discovery CDN headers + ETag / 304 support.
 * Call with the same body you would put in Response.json.
 */
export function discoveryJsonResponse(
  request: Request,
  body: unknown,
  opts?: {
    browser?: number;
    cdn?: number;
    swr?: number;
    status?: number;
    extraHeaders?: Record<string, string>;
    /** fingerprint override (default: hash of body) */
    fingerprint?: string;
  },
): Response {
  const etag = opts?.fingerprint
    ? normalizeEtag(opts.fingerprint)
    : etagFromBody(body);
  const cache = discoveryCacheHeaders({
    browser: opts?.browser,
    cdn: opts?.cdn,
    swr: opts?.swr,
    etag,
  });
  const headers = { ...cache, ...(opts?.extraHeaders || {}) };
  const notMod = maybeNotModified(request, etag, headers);
  if (notMod) return notMod;
  return Response.json(body, {
    status: opts?.status ?? 200,
    headers: {
      ...headers,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

/**
 * Parse Vercel edge cache status from request/response headers.
 * HIT / STALE / REVALIDATED = origin avoided or near-zero work.
 */
export function parseVercelCacheStatus(
  headers: Headers | Record<string, string | null | undefined>,
): {
  status: string | null;
  hit: boolean;
  origin_avoided: boolean;
} {
  const get = (k: string) => {
    if (headers instanceof Headers) return headers.get(k);
    const lower = k.toLowerCase();
    for (const [key, val] of Object.entries(headers)) {
      if (key.toLowerCase() === lower) return val ?? null;
    }
    return null;
  };
  const status = (
    get("x-vercel-cache") ||
    get("x-cache") ||
    get("cf-cache-status") ||
    ""
  )
    .toString()
    .trim()
    .toUpperCase() || null;
  const hit =
    status === "HIT" ||
    status === "STALE" ||
    status === "REVALIDATED" ||
    status === "UPDATING";
  return {
    status,
    hit,
    origin_avoided: status === "HIT" || status === "STALE",
  };
}
