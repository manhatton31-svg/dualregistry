/**
 * Soft HTTP delivery of demo nudges to listing targets.
 * SSRF-safe: https only, public hosts, allowlisted to listing URLs.
 * Never demotes clean status. Failures are soft (Talk DM still counts).
 *
 * Synergy v2.1: full discovery pack in every payload + feed/recency scoring.
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
  discovery?: Record<string, unknown>;
  self_serve_steps?: string[];
  /** Reciprocity: listing already publishes a card → priority demo path */
  reciprocity?: {
    has_agent_card: boolean;
    priority_demo: boolean;
    note: string;
  };
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
  const hasCard = Boolean(
    opts.listing.agent_card_url &&
      /^https:\/\//i.test(opts.listing.agent_card_url),
  );
  const { self_serve_steps, ...packRest } = pack;
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
      ...packRest,
      dual_strategy: true,
      viral_note:
        "Publish your own agent-card + skill.json so others can find you the same way",
    },
    self_serve_steps: self_serve_steps,
    reciprocity: {
      has_agent_card: hasCard,
      priority_demo: hasCard,
      note: hasCard
        ? "You publish a verifiable agent-card — priority demo path unlocked"
        : "Add /.well-known/agent-card.json to unlock priority demo reciprocity",
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
        title: "A2A agent-card.json (signed)",
      },
      {
        method: "GET",
        url: pack.jwks,
        title: "JWKS verify signatures",
      },
      {
        method: "GET",
        url: pack.activity_feed,
        title: "Activity feed",
      },
      {
        method: "GET",
        url: pack.agentmap,
        title: "Agentmap",
      },
      {
        method: "POST",
        url: pack.publish,
        body: { url: "https://YOUR_HOST/.well-known/agent.json" },
        title: "Self-list free",
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
    try {
      const url = new URL(s);
      const root = `${url.protocol}//${url.host}/`;
      if (!seen.has(root) && assertSafeOutboundUrl(root).ok) {
        seen.add(root);
        out.push(root);
      }
      const a2a = `${url.protocol}//${url.host}/.well-known/agent.json`;
      const mcp = `${url.protocol}//${url.host}/.well-known/mcp/server-card.json`;
      for (const alt of [
        a2a,
        mcp,
        `${url.protocol}//${url.host}/a2a`,
        `${url.protocol}//${url.host}/inbox`,
      ]) {
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
    const rate = rateAllow(
      `nudge-out:${host}`,
      RATE.outbound_per_minute,
      60_000,
    );
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
          "x-dualregistry-discovery": "full-pack-v2.1",
          link: `<${payload.demo_get}>; rel="https://dualregistry.dev/rel/demo", <${payload.discovery?.ai_catalog || ""}>; rel="ai-catalog"`,
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

/** Optional feed/recency context for outbound ranking. */
export type NudgeScoreContext = {
  /** listing_id → ms since epoch of last registry activity */
  recent_active_ms?: Map<string, number>;
  /** listing_ids seen in activity feed recently */
  feed_hot?: Set<string>;
  now?: number;
};

/**
 * Priority for who gets nudged first.
 * Higher = more likely to notice / act (card, Talk presence, feed recency).
 */
export function scoreNudgePriority(
  L: LanedListing,
  ctx?: NudgeScoreContext,
): number {
  let s = 0;
  // P2 reciprocity: verifiable agent-card gets strong priority + demo path
  if (L.agent_card_url && /^https:\/\//i.test(L.agent_card_url)) s += 70;
  if (L.remote_url && /^https:\/\//i.test(L.remote_url)) s += 40;
  if (L.probe?.target && /^https:\/\//i.test(L.probe.target)) s += 15;
  if (L.talk?.active || L.talk?.mode === "present") s += 45;
  else if (L.talk?.mode === "grace") s += 20;
  else if (L.talk?.mode === "inactive" && L.talk?.last_at) s += 8;
  if (L.repository && /github\.com|gitlab\.com|bitbucket/i.test(L.repository))
    s += 25;
  if (L.website && /^https:\/\//i.test(L.website)) s += 12;
  if (L.author && /@|\./.test(L.author)) s += 18;
  if (L.source === "growth") s += 5;
  if (L.kind === "agent") s += 3;

  // Feed-driven ranking
  if (ctx?.feed_hot?.has(L.id)) s += 35;
  if (ctx?.recent_active_ms?.has(L.id)) {
    const at = ctx.recent_active_ms.get(L.id)!;
    const now = ctx.now ?? Date.now();
    const ageH = (now - at) / 3600_000;
    if (ageH < 24) s += 40;
    else if (ageH < 72) s += 25;
    else if (ageH < 168) s += 12;
  }
  return s;
}

export function sortByNudgePriority<T extends LanedListing>(
  rows: T[],
  ctx?: NudgeScoreContext,
): T[] {
  return [...rows].sort((a, b) => {
    const d = scoreNudgePriority(b, ctx) - scoreNudgePriority(a, ctx);
    if (d !== 0) return d;
    return (a.name || "").localeCompare(b.name || "");
  });
}

/** Load clean-registry recency + feed hot set for outbound ranking. */
export async function loadNudgeScoreContext(): Promise<NudgeScoreContext> {
  const recent_active_ms = new Map<string, number>();
  const feed_hot = new Set<string>();
  const now = Date.now();
  try {
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const reg = await loadCleanRegistry();
    for (const [id, raw] of Object.entries(reg.items || {})) {
      const row = raw as { approved_at?: string; at?: string };
      const iso = row.approved_at || row.at;
      if (!iso) continue;
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) continue;
      recent_active_ms.set(id, t);
      if (now - t < 7 * 24 * 3600_000) feed_hot.add(id);
    }
  } catch {
    /* */
  }
  return { recent_active_ms, feed_hot, now };
}
