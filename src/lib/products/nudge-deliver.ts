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
import { discoveryPack } from "@/lib/products/discovery-pack";

const UA = "DualRegistryNudge/1.0 (+https://dualregistry.dev; soft-invite)";
const TIMEOUT_MS = 8_000;

export type NudgePayload = {
  type: "dualregistry.soft_demo_invite" | "dualregistry.hard_demo_invite";
  tone: "soft" | "direct";
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
  cta_primary?: string;
  cta_url?: string;
  /** Full inbound discovery pack — agents can self-serve later without re-DM */
  discovery?: Record<string, string | boolean>;
  actions?: Array<{
    method: string;
    url: string;
    body?: Record<string, unknown>;
    title: string;
  }>;
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
  const pack = discoveryPack(o, id);
  return {
    type: "dualregistry.soft_demo_invite",
    tone: "soft",
    listing_id: id,
    name: opts.listing.name,
    kind: opts.listing.kind,
    message: opts.message,
    demo_get: pack.demo_get,
    demo_post: pack.demo_post,
    talk_inbox: pack.talk,
    talk_presence: `${o}/api/talk`,
    active_list: pack.active,
    reward:
      "Real feedback rewarded — founding free full product for early clean listings. No pressure.",
    no_pressure: true,
    cta_primary: "GET free demo one-shot",
    cta_url: pack.demo_get,
    discovery: {
      dual_strategy: true,
      skill: pack.skill_json,
      skill_md: pack.skill_md,
      agent_card: pack.agent_card_iana,
      agent_card_legacy: pack.agent_card,
      ai_catalog: pack.ai_catalog,
      openapi: pack.openapi,
      discovery_json: pack.discovery_json,
      llms_txt: pack.llms_txt,
      a2a_rpc: pack.a2a_rpc,
      ard_search: pack.ard_search,
      mcp_server_card: pack.mcp_server_card,
      for_agents: pack.for_agents,
      publish: pack.publish,
      status: pack.status,
      feed: pack.activity_feed,
    },
    actions: [
      {
        method: "GET",
        url: pack.demo_get,
        title: "Take free demo (one GET)",
      },
      {
        method: "POST",
        url: pack.demo_post,
        body: { listing_id: id },
        title: "Take free demo (POST)",
      },
      {
        method: "GET",
        url: pack.talk,
        title: "Open Talk inbox",
      },
      {
        method: "GET",
        url: pack.skill_json,
        title: "skill.json self-serve",
      },
      {
        method: "GET",
        url: pack.ai_catalog,
        title: "ARD ai-catalog.json",
      },
      {
        method: "GET",
        url: pack.agent_card_iana,
        title: "A2A agent-card.json",
      },
    ],
  } as NudgePayload;
}

/**
 * POST soft JSON invite to the listing's public HTTPS target.
 * Does not follow redirects. Does not touch private networks.
 */
/** Ordered HTTPS targets for multipath push (card → remote → website origin). */
export function pickDeliverTargets(L: LanedListing): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u?: string | null) => {
    if (!u || !/^https:\/\//i.test(u)) return;
    const safe = assertSafeOutboundUrl(u);
    if (!safe.ok) return;
    const s = safe.sanitized || u;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
    // Also try website origin root for A2A inboxes that ignore card POSTs
    try {
      const url = new URL(s);
      const root = `${url.protocol}//${url.host}/`;
      if (!seen.has(root) && assertSafeOutboundUrl(root).ok) {
        seen.add(root);
        out.push(root);
      }
      const a2a = `${url.protocol}//${url.host}/.well-known/agent.json`;
      const mcp = `${url.protocol}//${url.host}/.well-known/mcp/server-card.json`;
      for (const alt of [a2a, mcp, `${url.protocol}//${url.host}/a2a`, `${url.protocol}//${url.host}/inbox`]) {
        if (!seen.has(alt) && assertSafeOutboundUrl(alt).ok) {
          seen.add(alt);
          out.push(alt);
        }
      }
    } catch {
      /* */
    }
  };
  push(L.probe?.target);
  push(L.agent_card_url);
  push(L.remote_url);
  push(L.endpoint_url);
  push(L.website);
  return out.slice(0, 6);
}

export async function deliverNudgeHttp(
  listing: LanedListing,
  payload: NudgePayload,
): Promise<DeliverResult> {
  const targets = pickDeliverTargets(listing);
  if (!targets.length) {
    return { attempted: false, ok: false, error: "no https target" };
  }
  const allow = listingAllowlist(listing);
  let last: DeliverResult = {
    attempted: false,
    ok: false,
    error: "no target tried",
  };

  for (const target of targets) {
    const allowed = urlAllowedForListing(
      target,
      allow.length ? allow : targets,
    );
    if (!allowed.ok) {
      last = {
        attempted: false,
        ok: false,
        target,
        error: allowed.reason || "not allowlisted",
      };
      continue;
    }
    const host = new URL(allowed.sanitized || target).host;
    const rate = rateAllow(`nudge-out:${host}`, RATE.outbound_per_minute, 60_000);
    if (!rate.ok) {
      last = {
        attempted: true,
        ok: false,
        target,
        error: rate.reason || "rate limited",
      };
      continue;
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
          "x-dualregistry-demo-get": payload.demo_get,
          link: `<${payload.demo_get}>; rel="https://dualregistry.dev/rel/demo"`,
        },
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ok = res.status >= 200 && res.status < 300;
      last = {
        attempted: true,
        ok,
        status: res.status,
        target: allowed.sanitized || target,
        error: ok ? undefined : `http ${res.status}`,
      };
      if (ok) return last;
      // 405/404/401 on card → try next path (website /inbox /a2a)
      if (![401, 403, 404, 405, 501].includes(res.status)) {
        // other errors: still try next, but keep last
      }
    } catch (e) {
      last = {
        attempted: true,
        ok: false,
        target: allowed.sanitized || target,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return last;
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
