/**
 * Public origin for cards, DNS, dual-publish docs.
 * Domain prep: set AGENTS1_PUBLIC_ORIGIN=https://your.domain when you buy one.
 * Until then, request origin (live preview) is used.
 */

export function resolvePublicOrigin(request?: Request): string {
  const env =
    typeof process !== "undefined"
      ? process.env.AGENTS1_PUBLIC_ORIGIN || process.env.PUBLIC_ORIGIN
      : undefined;
  if (env && /^https?:\/\//i.test(env)) {
    return env.replace(/\/$/, "");
  }
  if (request) {
    try {
      const u = new URL(request.url);
      // Prefer forwarded host when behind preview proxy
      const fwd =
        request.headers.get("x-forwarded-host") ||
        request.headers.get("host");
      const proto =
        request.headers.get("x-forwarded-proto") ||
        (u.protocol === "https:" ? "https" : "http");
      if (fwd) return `${proto}://${fwd.split(",")[0].trim()}`.replace(/\/$/, "");
      return u.origin;
    } catch {
      /* */
    }
  }
  return "http://127.0.0.1:8080";
}

export function domainReadyStatus(origin: string): {
  has_custom_domain: boolean;
  host: string;
  is_localhost: boolean;
  dns_ready: boolean;
  notes: string[];
} {
  let host = "localhost";
  try {
    host = new URL(origin).hostname;
  } catch {
    /* */
  }
  const is_localhost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const has_custom_domain = !is_localhost && host.includes(".");
  const notes: string[] = [];
  if (!has_custom_domain) {
    notes.push(
      "Set AGENTS1_PUBLIC_ORIGIN=https://YOUR_DOMAIN after DNS points at this app",
    );
    notes.push(
      "Then publish DNS TXT: _mcp.YOUR_DOMAIN → value from /discovery.json",
    );
  } else {
    notes.push(`Public host ${host} — publish _mcp.${host} TXT for free inbound discovery`);
  }
  return {
    has_custom_domain,
    host,
    is_localhost,
    dns_ready: has_custom_domain,
    notes,
  };
}
