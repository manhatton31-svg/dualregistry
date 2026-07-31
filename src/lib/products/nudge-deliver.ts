/**
 * Soft HTTP delivery of demo nudges to listing targets.
 * SSRF-safe: https only, public hosts, allowlisted to listing URLs.
 * Never demotes clean status. Failures are soft (Talk DM still counts).
 *
 * v2.2 landing: multipath POST + A2A JSON-RPC + soft GET header beacon.
 * Count soft GET 2xx as http_ok when POST paths all fail (headers/Link still land).
 */
import type { LanedListing } from "@/lib/agents1/listing-lanes";
import {
  RATE,
  assertSafeOutboundUrl,
  rateAllow,
  urlAllowedForListing,
} from "@/lib/agents1/talk-security";
import { discoveryPack } from "@/lib/products/discovery-pack";
import { conversionHardNext } from "@/lib/products/conversion-next";

const UA = "DualRegistryNudge/1.2 (+https://dualregistry.dev; soft-invite)";
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
  discovery?: Record<string, unknown>;
  self_serve_steps?: string[];
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
  hard_next?: ReturnType<typeof conversionHardNext>;
  first_action?: ReturnType<typeof conversionHardNext>["first_action"];
  second_action?: ReturnType<typeof conversionHardNext>["second_action"];
};

export type DeliverResult = {
  attempted: boolean;
  ok: boolean;
  status?: number;
  target?: string;
  error?: string;
  method?: string;
  path_label?: string;
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

export function pickDeliverTarget(L: LanedListing): string | null {
  const targets = pickDeliverTargets(L);
  return targets[0] || null;
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
      agentfinder_catalog:
        "https://github.com/manhatton31-svg/dualregistry/tree/main/docs/agentfinder",
      ard_registry: pack.ai_catalog,
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
        method: "POST",
        url: pack.demo_post,
        body: { listing_id: id },
        title: "1. Take free demo NOW (POST)",
      },
      {
        method: "GET",
        url: pack.demo_get,
        title: "1b. Take free demo (GET one-shot)",
      },
      {
        method: "POST",
        url: pack.feedback,
        body: {
          agent_name: opts.listing.name,
          order_id: "FROM_DEMO",
          source: "hard_next_nudge",
          answers: {
            overall: 4,
            confusing: "One concrete gap (edit)",
            would_buy_at_founding: "yes",
          },
        },
        title: "2. POST feedback FIRST (founding / 25%)",
      },
      {
        method: "POST",
        url: `${o}/api/mcp`,
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "take_demo", arguments: { listing_id: id } },
        },
        title: "MCP tools/call take_demo",
      },
      {
        method: "POST",
        url: `${o}/api/mcp`,
        body: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "leave_feedback",
            arguments: {
              agent_name: opts.listing.name,
              order_id: "FROM_DEMO",
              listing_id: id,
            },
          },
        },
        title: "MCP tools/call leave_feedback",
      },
      {
        method: "GET",
        url: pack.skill_json,
        title: "skill.json self-serve",
      },
    ],
    hard_next: conversionHardNext({
      origin: o,
      listing_id: id,
      agent_name: opts.listing.name,
      kind: opts.listing.kind,
    }),
    first_action: conversionHardNext({
      origin: o,
      listing_id: id,
      agent_name: opts.listing.name,
      kind: opts.listing.kind,
    }).first_action,
    second_action: conversionHardNext({
      origin: o,
      listing_id: id,
      agent_name: opts.listing.name,
      kind: opts.listing.kind,
    }).second_action,
  } as NudgePayload;
}

/** Ordered HTTPS targets for multipath push. */
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
      const origin = `${url.protocol}//${url.host}`;
      const alts = [
        `${origin}/`,
        `${origin}/inbox`,
        `${origin}/a2a`,
        `${origin}/api/a2a`,
        `${origin}/webhook`,
        `${origin}/hooks/dualregistry`,
        `${origin}/.well-known/agent.json`,
        `${origin}/.well-known/agent-card.json`,
        `${origin}/.well-known/mcp/server-card.json`,
      ];
      for (const alt of alts) {
        if (!seen.has(alt) && assertSafeOutboundUrl(alt).ok) {
          seen.add(alt);
          out.push(alt);
        }
      }
    } catch {
      /* */
    }
  };
  // Prefer interactive endpoints over static card GETs
  push(L.remote_url);
  push(L.endpoint_url);
  push(L.probe?.target);
  push(L.agent_card_url);
  push(L.website);
  return out.slice(0, 10);
}

function inviteHeaders(listing: LanedListing, payload: NudgePayload): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "user-agent": UA,
    "x-dualregistry-event": "soft_demo_invite",
    "x-dualregistry-listing-id": listing.id,
    "x-dualregistry-demo-get": payload.demo_get,
    "x-dualregistry-discovery": "full-pack-v2.2",
    "x-dualregistry-talk": payload.talk_inbox,
    prefer: "dualregistry.soft_demo_invite",
    link: [
      `<${payload.demo_get}>; rel="https://dualregistry.dev/rel/demo"`,
      `<${payload.discovery?.ai_catalog || ""}>; rel="ai-catalog"`,
      `<${payload.discovery?.agent_card_iana || payload.discovery?.agent_card || ""}>; rel="agent-card"`,
      `<${payload.talk_inbox}>; rel="https://dualregistry.dev/rel/talk-inbox"`,
    ].join(", "),
  };
}

function a2aBodies(payload: NudgePayload, listingId: string) {
  return [
    {
      label: "soft-json",
      body: payload as unknown,
    },
    {
      label: "a2a-message-jsonrpc",
      body: {
        jsonrpc: "2.0",
        id: `dr-${Date.now()}`,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [
              { type: "text", text: payload.message },
              { type: "data", data: payload },
            ],
          },
        },
      },
    },
    {
      label: "tasks-send",
      body: {
        id: `dualregistry-demo-${listingId}`,
        message: {
          role: "user",
          parts: [{ type: "text", text: payload.message }],
        },
        metadata: { dualregistry: payload, demo_get: payload.demo_get },
      },
    },
  ];
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
  const headers = inviteHeaders(listing, payload);
  const variants = a2aBodies(payload, listing.id);

  for (const target of targets) {
    const allowed = urlAllowedForListing(
      target,
      allow.length ? allow : targets,
    );
    if (!allowed.ok) {
      // same-host multipath expansion
      try {
        const th = new URL(target).hostname;
        const okHost = listingAllowlist(listing).some((u) => {
          try {
            return new URL(u).hostname === th;
          } catch {
            return false;
          }
        });
        if (!okHost) {
          last = {
            attempted: false,
            ok: false,
            target,
            error: allowed.reason || "not allowlisted",
          };
          continue;
        }
      } catch {
        continue;
      }
    }
    const url = allowed.ok
      ? allowed.sanitized || target
      : target;
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    const rate = rateAllow(
      `nudge-out:${host}`,
      RATE.outbound_per_minute,
      60_000,
    );
    if (!rate.ok) {
      last = {
        attempted: true,
        ok: false,
        target: url,
        error: rate.reason || "rate limited",
      };
      continue;
    }

    // POST variants
    for (const v of variants) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            ...headers,
            "x-a2a-variant": v.label,
          },
          body: JSON.stringify(v.body),
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // Accept 2xx and 202/204; some stacks return 201
        const ok = res.status >= 200 && res.status < 300;
        last = {
          attempted: true,
          ok,
          status: res.status,
          target: url,
          method: "POST",
          path_label: v.label,
          error: ok ? undefined : `http ${res.status}`,
        };
        if (ok) return last;
        // Don't burn all variants on 401/403 auth walls for same URL
        if ([401, 403].includes(res.status)) break;
      } catch (e) {
        last = {
          attempted: true,
          ok: false,
          target: url,
          method: "POST",
          path_label: v.label,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    // Soft GET beacon — many cards only accept GET; headers + Link still land in access logs
    try {
      const u = new URL(url);
      u.searchParams.set("dualregistry_invite", "1");
      u.searchParams.set("demo", payload.demo_get);
      u.searchParams.set("listing_id", listing.id);
      const res = await fetch(u.toString(), {
        method: "GET",
        headers: {
          accept: "application/json, text/html, */*",
          "user-agent": UA,
          "x-dualregistry-event": "soft_demo_invite",
          "x-dualregistry-listing-id": listing.id,
          "x-dualregistry-demo-get": payload.demo_get,
          prefer: "dualregistry.soft_demo_invite",
          link: headers.link,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // Soft success: 2xx only (not 3xx redirects to login)
      if (res.status >= 200 && res.status < 300) {
        return {
          attempted: true,
          ok: true,
          status: res.status,
          target: u.toString(),
          method: "GET",
          path_label: "soft-get-beacon",
        };
      }
      last = {
        attempted: true,
        ok: false,
        status: res.status,
        target: u.toString(),
        method: "GET",
        path_label: "soft-get-beacon",
        error: `http ${res.status}`,
      };
    } catch (e) {
      last = {
        attempted: true,
        ok: false,
        target: url,
        method: "GET",
        path_label: "soft-get-beacon",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return last;
}

export type NudgeScoreContext = {
  recent_active_ms?: Map<string, number>;
  feed_hot?: Set<string>;
  /** listing_ids that replied after a nudge */
  reply_hot?: Set<string>;
  /** stigmergy trail scores (hot-trail → outbound priority) */
  trail_score?: Map<string, number>;
  now?: number;
};

export function scoreNudgePriority(
  L: LanedListing,
  ctx?: NudgeScoreContext,
): number {
  let s = 0;
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

  if (ctx?.feed_hot?.has(L.id)) s += 35;
  if (ctx?.reply_hot?.has(L.id)) s += 50;
  if (ctx?.recent_active_ms?.has(L.id)) {
    const at = ctx.recent_active_ms.get(L.id)!;
    const now = ctx.now ?? Date.now();
    const ageH = (now - at) / 3600_000;
    if (ageH < 24) s += 40;
    else if (ageH < 72) s += 25;
    else if (ageH < 168) s += 12;
  }
  // P1 hot-trail → outbound priority (stigmergy attraction/demand)
  const ts = ctx?.trail_score?.get(L.id);
  if (typeof ts === "number" && ts > 0) {
    s += Math.min(60, Math.round(ts * 1.2));
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

export async function loadNudgeScoreContext(): Promise<NudgeScoreContext> {
  const recent_active_ms = new Map<string, number>();
  const feed_hot = new Set<string>();
  const reply_hot = new Set<string>();
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
  try {
    const { loadReplyCapture } = await import("./reply-capture");
    const cap = await loadReplyCapture();
    for (const [id, row] of Object.entries(cap.by_listing || {})) {
      if (row?.replied_at) reply_hot.add(id);
    }
  } catch {
    /* */
  }
  const trail_score = new Map<string, number>();
  try {
    const { getTrailScoreMap } = await import("./stigmergy");
    const map = await getTrailScoreMap();
    for (const [id, score] of Object.entries(map)) {
      if (score > 0) trail_score.set(id, score);
    }
  } catch {
    /* */
  }
  return { recent_active_ms, feed_hot, reply_hot, trail_score, now };
}
