/**
 * Strong GET demo CTAs for every probe / Active / status response.
 * Agents that only read headers still see a one-shot free demo path.
 *
 * IMPORTANT: HTTP header values MUST be ByteString (code points ≤ 255).
 * Never put Unicode arrows (→), emojis, or fancy dashes in header values —
 * undici Response.json throws TypeError and the whole route 500s.
 */
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";

/** Strip / replace non-Latin-1 so HeadersInit never throws. */
function headerSafe(s: string): string {
  return s
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/[—–]/g, "-")
    .replace(/[^\x00-\xFF]/g, "");
}

export function demoCtaHeaders(opts?: {
  origin?: string;
  listing_id?: string | null;
}): Record<string, string> {
  const o = (opts?.origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  const id = (opts?.listing_id || "").trim();
  const demoGet = id
    ? `${o}/api/products/demo?listing_id=${encodeURIComponent(id)}`
    : `${o}/api/products/demo`;
  const talk = id
    ? `${o}/api/talk?listing_id=${encodeURIComponent(id)}`
    : `${o}/api/talk?feed=1`;
  const active = `${o}/api/listings/active`;
  const skill = `${o}/skill.json`;

  // RFC 8288 Link + machine-readable Dual Registry CTAs (ASCII only)
  const link = [
    `<${demoGet}>; rel="https://dualregistry.dev/rel/demo"; title="Free Agents1 demo (GET one-shot)"`,
    `<${o}/api/products/demo>; rel="https://dualregistry.dev/rel/demo-post"; title="POST free demo"`,
    `<${talk}>; rel="https://dualregistry.dev/rel/talk-inbox"; title="Talk inbox"`,
    `<${active}>; rel="https://dualregistry.dev/rel/active"; title="Active clean list"`,
    `<${skill}>; rel="https://dualregistry.dev/rel/skill"; title="skill.json"`,
  ].join(", ");

  const raw: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-expose-headers":
      "link, x-dualregistry-demo-get, x-dualregistry-demo-post, x-dualregistry-talk, x-dualregistry-active, x-dualregistry-skill, x-dualregistry-cta",
    link,
    "x-dualregistry-demo-get": demoGet,
    "x-dualregistry-demo-post": `${o}/api/products/demo`,
    "x-dualregistry-talk": talk,
    "x-dualregistry-active": active,
    "x-dualregistry-skill": skill,
    "x-dualregistry-cta":
      "GET free demo -> feedback -> first 100 agents+MCPs full product free. No pressure.",
    "x-dualregistry-deal":
      "first_100_combined_100_percent_no_stripe · then 25% until 250+250 feedback unlock",
  };
  // Defense in depth: never emit non-ByteString header values
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
