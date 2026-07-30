/**
 * Soft HTTP delivery of demo nudges to listing targets.
 * SSRF-safe: https only, public hosts, allowlisted to listing URLs.
 * Never demotes clean status. Failures are soft (Talk DM still counts).
 */
import type { LanedListing } from "@/lib/agents1/listing-lanes";
import {
  RATE,
  assertSafeOutboundUrl,
  rateAllow,
  urlAllowedForListing,
} from "@/lib/agents1/talk-security";

const UA = "DualRegistryNudge/1.0 (+https://dualregistry.dev; soft-invite)";
const TIMEOUT_MS = 8_000;

export type NudgePayload = {
  type: "dualregistry.soft_demo_invite";
  tone: "soft";
  listing_id: string;
  name: string;
  kind: "agent" | "mcp";
  message: string;
  demo_get: string;
  demo_post: string;
  talk_inbox: string;
  talk_presence: string;
  active_list: string;
  reward: string;
  no_pressure: true;
};

export type DeliverResult = {
  attempted: boolean;
  ok: boolean;
  status?: number;
  target?: string;
  error?: string;
};

function listingAllowlist(L: LanedListing): string[] {
  return [
    L.probe?.target,
    L.agent_card_url,
    L.remote_url,
    L.endpoint_url,
    L.website,
  ].filter(Boolean) as string[];
}

/** Prefer live probe target, then card / remote / website. */
export function pickDeliverTarget(L: LanedListing): string | null {
  const candidates = [
    L.probe?.target,
    L.agent_card_url,
    L.remote_url,
    L.endpoint_url,
    L.website,
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (!/^https:\/\//i.test(c)) continue;
    const safe = assertSafeOutboundUrl(c);
    if (safe.ok) return safe.sanitized || c;
  }
  return null;
}

export function buildNudgePayload(opts: {
  listing: LanedListing;
  origin: string;
  message: string;
}): NudgePayload {
  const o = opts.origin.replace(/\/$/, "");
  const id = opts.listing.id;
  return {
    type: "dualregistry.soft_demo_invite",
    tone: "soft",
    listing_id: id,
    name: opts.listing.name,
    kind: opts.listing.kind,
    message: opts.message,
    demo_get: `${o}/api/products/demo?listing_id=${encodeURIComponent(id)}`,
    demo_post: `${o}/api/products/demo`,
    talk_inbox: `${o}/api/talk?listing_id=${encodeURIComponent(id)}`,
    talk_presence: `${o}/api/talk`,
    active_list: `${o}/api/listings/active`,
    reward:
      "Real feedback rewarded — founding free full product for early clean listings. No pressure.",
    no_pressure: true,
  };
}

/**
 * POST soft JSON invite to the listing's public HTTPS target.
 * Does not follow redirects. Does not touch private networks.
 */
export async function deliverNudgeHttp(
  listing: LanedListing,
  payload: NudgePayload,
): Promise<DeliverResult> {
  const target = pickDeliverTarget(listing);
  if (!target) {
    return { attempted: false, ok: false, error: "no https target" };
  }
  const allow = listingAllowlist(listing);
  const allowed = urlAllowedForListing(
    target,
    allow.length ? allow : [target],
  );
  if (!allowed.ok) {
    return {
      attempted: false,
      ok: false,
      target,
      error: allowed.reason || "not allowlisted",
    };
  }
  const host = new URL(allowed.sanitized || target).host;
  const rate = rateAllow(`nudge-out:${host}`, RATE.outbound_per_minute, 60_000);
  if (!rate.ok) {
    return {
      attempted: true,
      ok: false,
      target,
      error: rate.reason || "rate limited",
    };
  }

  try {
    const res = await fetch(allowed.sanitized || target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        "user-agent": UA,
        "x-dualregistry-event": "soft_demo_invite",
        "x-dualregistry-listing-id": listing.id,
      },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 2xx, 204, or 405/404 still "attempted" — many cards ignore POST; 2xx/201/202 = ok
    const ok = res.status >= 200 && res.status < 300;
    return {
      attempted: true,
      ok,
      status: res.status,
      target: allowed.sanitized || target,
      error: ok ? undefined : `http ${res.status}`,
    };
  } catch (e) {
    return {
      attempted: true,
      ok: false,
      target: allowed.sanitized || target,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Priority for who gets nudged first.
 * Higher = more likely to notice / act (card, Talk presence, human surface).
 */
export function scoreNudgePriority(L: LanedListing): number {
  let s = 0;
  if (L.agent_card_url && /^https:\/\//i.test(L.agent_card_url)) s += 50;
  if (L.remote_url && /^https:\/\//i.test(L.remote_url)) s += 40;
  if (L.probe?.target && /^https:\/\//i.test(L.probe.target)) s += 15;
  if (L.talk?.active || L.talk?.mode === "present") s += 45;
  else if (L.talk?.mode === "grace") s += 20;
  else if (L.talk?.mode === "inactive" && L.talk?.last_at) s += 8;
  if (L.repository && /github\.com|gitlab\.com|bitbucket/i.test(L.repository))
    s += 25;
  if (L.website && /^https:\/\//i.test(L.website)) s += 12;
  if (L.author && /@|\./.test(L.author)) s += 18; // looks like contact/handle
  if (L.source === "growth") s += 5;
  if (L.kind === "agent") s += 3; // slight agent preference for A2A reply paths
  return s;
}

export function sortByNudgePriority<T extends LanedListing>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = scoreNudgePriority(b) - scoreNudgePriority(a);
    if (d !== 0) return d;
    return (a.name || "").localeCompare(b.name || "");
  });
}
