/**
 * Strong GET demo CTAs + full discovery pack for every probe / Active / status response.
 * Agents that only read headers still see demo + skill + cards + ARD + OpenAPI.
 *
 * IMPORTANT: HTTP header values MUST be ByteString (code points ≤ 255).
 * Never put Unicode arrows (→), emojis, or fancy dashes in header values —
 * undici Response.json throws TypeError and the whole route 500s.
 */
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";
import {
  discoveryLinkHeader,
  discoveryPack,
} from "@/lib/products/discovery-pack";

/** Strip / replace non-Latin-1 so HeadersInit never throws. */
function headerSafe(s: string): string {
  return s
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/[—–·]/g, "-")
    .replace(/[^\x00-\xFF]/g, "");
}

export function demoCtaHeaders(opts?: {
  origin?: string;
  listing_id?: string | null;
}): Record<string, string> {
  const o = (opts?.origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  const id = (opts?.listing_id || "").trim();
  const pack = discoveryPack(o, id);
  const link = discoveryLinkHeader(o, id);

  const raw: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-expose-headers":
      "link, x-dualregistry-demo-get, x-dualregistry-demo-post, x-dualregistry-talk, x-dualregistry-active, x-dualregistry-skill, x-dualregistry-cta, x-dualregistry-agent-card, x-dualregistry-ai-catalog, x-dualregistry-openapi, x-dualregistry-discovery",
    link,
    "x-dualregistry-demo-get": pack.demo_get,
    "x-dualregistry-demo-post": pack.demo_post,
    "x-dualregistry-talk": pack.talk,
    "x-dualregistry-active": pack.active,
    "x-dualregistry-skill": pack.skill_json,
    "x-dualregistry-agent-card": pack.agent_card_iana,
    "x-dualregistry-ai-catalog": pack.ai_catalog,
    "x-dualregistry-openapi": pack.openapi,
    "x-dualregistry-discovery": pack.discovery_json,
    "x-dualregistry-cta":
      "GET free demo -> feedback -> first 100 agents+MCPs full product free. Dual strategy: outbound + inbound. No pressure.",
    "x-dualregistry-deal":
      "first_100_combined_100_percent_no_stripe · then 25% until 10+5 feedback unlock",
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = headerSafe(v);
  }
  return out;
}

/** Merge demo CTA headers into an existing header bag (later keys win only if not set). */
export function withDemoCtaHeaders(
  base: HeadersInit | undefined,
  opts?: { origin?: string; listing_id?: string | null },
): Record<string, string> {
  const out: Record<string, string> = { ...demoCtaHeaders(opts) };
  if (!base) return out;
  const entries =
    base instanceof Headers
      ? [...base.entries()]
      : Array.isArray(base)
        ? base
        : Object.entries(base);
  for (const [k, v] of entries) {
    if (v != null && v !== "") out[String(k).toLowerCase()] = headerSafe(String(v));
  }
  // Always re-assert CTA headers last so callers cannot drop them by accident
  return { ...out, ...demoCtaHeaders(opts) };
}
