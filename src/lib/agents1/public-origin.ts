/**
 * Public origin for cards, DNS, dual-publish docs.
 * Production domain: dualregistry.dev
 * Override with AGENTS1_PUBLIC_ORIGIN if needed.
 */

/** Canonical production host for agents/MCP discovery. */
export const CANONICAL_PUBLIC_ORIGIN = "https://dualregistry.dev";

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
      const fwd =
        request.headers.get("x-forwarded-host") ||
        request.headers.get("host");
      const proto =
        request.headers.get("x-forwarded-proto") ||
        (u.protocol === "https:" ? "https" : "http");
      if (fwd) {
        const host = fwd.split(",")[0].trim().toLowerCase();
        // Live preview / local: keep request host so HMR and soft polls work
        if (
          host.includes("localhost") ||
          host.includes("127.0.0.1") ||
          host.includes("preview") ||
          /^\d+\.\d+\.\d+\.\d+$/.test(host)
        ) {
          return `${proto}://${host}`.replace(/\/$/, "");
        }
        // Canonical brand domain (strip www)
        if (host === "dualregistry.dev" || host === "www.dualregistry.dev") {
          return CANONICAL_PUBLIC_ORIGIN;
        }
        return `${proto}://${host}`.replace(/\/$/, "");
      }
      return u.origin;
    } catch {
      /* */
    }
  }
  // Default for workers, mail, skill builders when no request context
  return CANONICAL_PUBLIC_ORIGIN;
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
      "Canonical public origin is https://dualregistry.dev — set AGENTS1_PUBLIC_ORIGIN to override",
    );
  } else {
    notes.push(
      `Public host ${host} — publish _mcp.${host} TXT for free inbound discovery`,
    );
    if (host === "dualregistry.dev" || host.endsWith(".dualregistry.dev")) {
      notes.push("Receive: hello@dualregistry.dev · Resend outbound TBD");
    }
  }
  return {
    has_custom_domain,
    host,
    is_localhost,
    dns_ready: has_custom_domain,
    notes,
  };
}
