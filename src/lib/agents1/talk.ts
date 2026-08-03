/**
 * Real conversation + presence with clean / probe-ok agents and MCPs.
 * Security: SSRF guard, allowlist targets, rate limits, content policy.
 * Presence heartbeats keep Active / checks-clean (see talk-activity).
 */
import { getLanedListings, type LanedListing } from "./listing-lanes";
import { validateA2ACard } from "./a2a-card";
import {
  recordPresence,
  sanitizeStoredReply,
} from "./talk-activity";
import {
  RATE,
  USER_MESSAGE_MAX_CHARS,
  assertSafeOutboundUrl,
  rateAllow,
  sanitizeAgentReply,
  sanitizeUserText,
  urlAllowedForListing,
} from "./talk-security";

const UA = "DualRegistryTalk/1.0 (+https://dualregistry.dev)";
const TIMEOUT_MS = 18_000;

export type TalkMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
  meta?: Record<string, unknown>;
};

export type TalkSession = {
  session_id: string;
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  target?: string;
  messages: TalkMessage[];
  reachable: boolean;
  channel: string;
  updated_at: string;
};

export type TalkResult = {
  ok: boolean;
  session: TalkSession;
  reply?: string;
  error?: string;
  channel?: string;
  card_ok?: boolean;
  latency_ms?: number;
  presence?: { last_at?: string; mode?: string };
};

const sessions = new Map<string, TalkSession>();

function sid() {
  return `talk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function listingAllowlist(L: LanedListing): string[] {
  return [
    L.probe?.target,
    L.agent_card_url,
    L.remote_url,
    L.endpoint_url,
    L.website,
  ].filter(Boolean) as string[];
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  allowlist?: string[],
): Promise<{ ok: boolean; status: number; json?: unknown; text?: string }> {
  const safe = allowlist?.length
    ? urlAllowedForListing(url, allowlist)
    : assertSafeOutboundUrl(url);
  if (!safe.ok) {
    return { ok: false, status: 0, text: safe.reason || "blocked URL" };
  }
  const outRate = rateAllow(`out:${new URL(safe.sanitized || url).host}`, RATE.outbound_per_minute, 60_000);
  if (!outRate.ok) {
    return { ok: false, status: 429, text: outRate.reason };
  }
  try {
    const res = await fetch(safe.sanitized || url, {
      ...init,
      headers: {
        accept: "application/json",
        "user-agent": UA,
        ...(init?.headers || {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Do not follow redirects to untrusted hosts
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") || "";
      if (loc) {
        const next = assertSafeOutboundUrl(
          loc.startsWith("http") ? loc : new URL(loc, safe.sanitized || url).toString(),
        );
        if (!next.ok) {
          return { ok: false, status: res.status, text: "redirect blocked" };
        }
      }
      return { ok: false, status: res.status, text: "redirect not followed" };
    }
    const text = await res.text();
    let json: unknown;
    try {
      if (text.trim().startsWith("{") || text.trim().startsWith("["))
        json = JSON.parse(text);
    } catch {
      /* */
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 4000) };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Probe-ok listings eligible for Talk (including talk-inactive for check-in).
 * Public Active still requires presence; this path lets them restore it.
 */
export async function findTalkableListing(
  listingId: string,
): Promise<LanedListing | null> {
  const lanes = await getLanedListings();
  const active = [...lanes.agents_active, ...lanes.mcp_active];
  const hit = active.find((x) => x.id === listingId);
  if (hit) return hit;

  // Fallback: rebuild from probe index for check-in after demotion
  try {
    const { loadProbeIndex } = await import("./listing-lanes");
    const probes = await loadProbeIndex();
    for (const r of probes.values()) {
      if (r.id !== listingId) continue;
      if (!(r.handshake === "ok" && r.ok)) continue;
      const kind = (r.kind === "agent" ? "agent" : "mcp") as "agent" | "mcp";
      return {
        id: r.id,
        kind,
        name: (r as { name?: string }).name || r.id,
        lane: "needs_resubmit",
        lane_reason: "Talk check-in required",
        checks_clean: false,
        source: "mirror",
        agent_card_url: kind === "agent" ? r.target : undefined,
        remote_url: kind === "mcp" ? r.target : undefined,
        website: r.target,
        probe: {
          ok: true,
          handshake: "ok",
          score: r.score,
          probed_at: r.probed_at,
          target: r.target,
        },
      };
    }
  } catch {
    /* */
  }
  return null;
}

export async function findCleanListing(
  listingId: string,
): Promise<LanedListing | null> {
  return findTalkableListing(listingId);
}

/** Confirm card/endpoint still returns a valid surface. */
export async function verifyListingReachable(L: LanedListing): Promise<{
  ok: boolean;
  target: string;
  channel: string;
  detail: string;
  card?: unknown;
}> {
  const allow = listingAllowlist(L);
  const target =
    L.probe?.target ||
    L.agent_card_url ||
    L.remote_url ||
    L.endpoint_url ||
    L.website ||
    "";
  if (!target || !/^https?:\/\//i.test(target)) {
    return {
      ok: false,
      target: target || "",
      channel: "none",
      detail: "no https target URL on clean listing",
    };
  }
  const urlOk = urlAllowedForListing(target, allow.length ? allow : [target]);
  if (!urlOk.ok) {
    return {
      ok: false,
      target,
      channel: "blocked",
      detail: urlOk.reason || "URL blocked by security policy",
    };
  }

  if (L.kind === "agent" || /agent\.json|agent-card/i.test(target)) {
    const r = await fetchJson(target, undefined, allow);
    if (!r.ok || !r.json) {
      return {
        ok: false,
        target,
        channel: "agent-card",
        detail: `card fetch failed HTTP ${r.status}: ${(r.text || "").slice(0, 120)}`,
      };
    }
    const v = validateA2ACard(r.json);
    return {
      ok: v.ok || Boolean((r.json as { name?: string }).name),
      target,
      channel: "agent-card",
      detail: v.ok
        ? `valid A2A card: ${v.card?.name || L.name}`
        : `card JSON present (score ${v.score}): ${v.reasons.slice(0, 2).join("; ")}`,
      card: r.json,
    };
  }

  if (/server-card|well-known\/mcp/i.test(target)) {
    const r = await fetchJson(target, undefined, allow);
    if (r.ok && r.json) {
      return {
        ok: true,
        target,
        channel: "mcp-card",
        detail: `MCP server-card HTTP ${r.status}`,
        card: r.json,
      };
    }
  }

  const remote = L.remote_url || target;
  const init = await fetchJson(
    remote,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "dualregistry-talk", version: "1.0" },
        },
      }),
    },
    allow,
  );
  if (init.ok || (init.json && typeof init.json === "object")) {
    return {
      ok: true,
      target: remote,
      channel: "mcp-jsonrpc",
      detail: `MCP initialize HTTP ${init.status}`,
      card: init.json,
    };
  }

  const get = await fetchJson(remote, undefined, allow);
  return {
    ok: get.status > 0 && get.status < 500,
    target: remote,
    channel: "http",
    detail: `HTTP ${get.status}: ${(get.text || "").slice(0, 100)}`,
    card: get.json,
  };
}

async function messageAgent(
  L: LanedListing,
  card: Record<string, unknown> | undefined,
  userText: string,
): Promise<{ ok: boolean; reply: string; channel: string }> {
  const allow = listingAllowlist(L);
  const endpoint =
    (typeof card?.url === "string" && card.url) ||
    L.endpoint_url ||
    L.website ||
    "";
  const cardUrl = L.agent_card_url || L.probe?.target || "";

  if (endpoint && /^https?:\/\//i.test(endpoint)) {
    const body = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ type: "text", text: userText }],
          messageId: `dr-${Date.now().toString(36)}`,
        },
      },
    };
    const r = await fetchJson(
      endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      allow,
    );
    if (r.json && typeof r.json === "object") {
      const j = r.json as {
        result?: {
          parts?: Array<{ text?: string }>;
          message?: { parts?: Array<{ text?: string }> };
        };
        error?: { message?: string };
      };
      const parts = j.result?.parts || j.result?.message?.parts || [];
      const text = parts
        .map((p) => p.text)
        .filter(Boolean)
        .join("\n");
      if (text) {
        return {
          ok: true,
          reply: sanitizeAgentReply(text),
          channel: "a2a-message/send",
        };
      }
      if (j.error?.message) {
        return {
          ok: false,
          reply: sanitizeAgentReply(`Agent error: ${j.error.message}`),
          channel: "a2a-message/send",
        };
      }
      const raw = JSON.stringify(r.json).slice(0, 1500);
      if (r.ok) {
        return {
          ok: true,
          reply: sanitizeAgentReply(
            `Agent responded (structured):\n\`\`\`json\n${raw}\n\`\`\``,
          ),
          channel: "a2a-raw",
        };
      }
    }
  }

  if (cardUrl) {
    const r = await fetchJson(cardUrl, undefined, allow);
    if (r.json && typeof r.json === "object") {
      const c = r.json as {
        name?: string;
        description?: string;
        skills?: Array<{ name?: string; description?: string }>;
        url?: string;
      };
      const skills = (c.skills || [])
        .slice(0, 6)
        .map((s) => `• ${s.name}${s.description ? `: ${s.description}` : ""}`)
        .join("\n");
      return {
        ok: true,
        reply: sanitizeAgentReply(
          [
            `Connected to **${c.name || L.name}** via live agent card.`,
            c.description || L.description || "",
            skills ? `\nSkills:\n${skills}` : "",
            c.url ? `\nAgent endpoint: ${c.url}` : "",
            `\nYour message: “${userText}”`,
            "\n(Endpoint may require auth; card handshake is live and counts as presence.)",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        channel: "agent-card-live",
      };
    }
  }

  return {
    ok: false,
    reply: `Could not deliver message to ${L.name}. Card/endpoint unreachable or requires auth.`,
    channel: "failed",
  };
}

async function messageMcp(
  L: LanedListing,
  userText: string,
): Promise<{ ok: boolean; reply: string; channel: string }> {
  const allow = listingAllowlist(L);
  const remote =
    L.remote_url ||
    (L.probe?.target && !/server-card/i.test(L.probe.target)
      ? L.probe.target
      : "") ||
    "";
  const cardUrl =
    L.probe?.target && /server-card|well-known\/mcp/i.test(L.probe.target)
      ? L.probe.target
      : L.website && /well-known/i.test(L.website)
        ? L.website
        : "";

  let toolsSummary = "";
  let initOk = false;

  if (remote && /^https?:\/\//i.test(remote)) {
    const init = await fetchJson(
      remote,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "dualregistry-talk", version: "1.0" },
          },
        }),
      },
      allow,
    );
    initOk = Boolean(init.ok || init.json);
    if (init.json) {
      const tools = await fetchJson(
        remote,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          }),
        },
        allow,
      );
      const tj = tools.json as {
        result?: { tools?: Array<{ name?: string; description?: string }> };
      };
      const list = tj?.result?.tools || [];
      if (list.length) {
        toolsSummary = list
          .slice(0, 12)
          .map((t) => `• ${t.name}${t.description ? `: ${t.description}` : ""}`)
          .join("\n");
        const lower = userText.toLowerCase();
        const hit = list.find(
          (t) => t.name && lower.includes(String(t.name).toLowerCase()),
        );
        if (hit?.name) {
          const call = await fetchJson(
            remote,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: { name: hit.name, arguments: { query: userText } },
              }),
            },
            allow,
          );
          if (call.json) {
            return {
              ok: true,
              reply: sanitizeAgentReply(
                `MCP tool \`${hit.name}\` response:\n\`\`\`json\n${JSON.stringify(call.json, null, 2).slice(0, 1800)}\n\`\`\``,
              ),
              channel: "mcp-tools/call",
            };
          }
        }
      }
    }
  }

  if (cardUrl) {
    const r = await fetchJson(cardUrl, undefined, allow);
    if (r.json) {
      const c = r.json as {
        name?: string;
        title?: string;
        description?: string;
        remotes?: Array<{ url?: string }>;
      };
      return {
        ok: true,
        reply: sanitizeAgentReply(
          [
            `Connected to **${c.title || c.name || L.name}** via live MCP card.`,
            c.description || L.description || "",
            c.remotes?.[0]?.url
              ? `Transport: ${c.remotes[0].url}`
              : remote
                ? `Transport: ${remote}`
                : "",
            initOk ? "JSON-RPC initialize: ok" : "",
            toolsSummary ? `\nTools:\n${toolsSummary}` : "",
            `\nYour message: “${userText}”`,
            toolsSummary
              ? "\nTip: name a tool in your message to invoke tools/call."
              : "\n(Live card confirmed. Counts as Talk presence.)",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        channel: initOk ? "mcp-jsonrpc+card" : "mcp-card-live",
      };
    }
  }

  if (initOk) {
    return {
      ok: true,
      reply: sanitizeAgentReply(
        [
          `MCP transport at ${remote} accepted initialize.`,
          toolsSummary ? `Tools:\n${toolsSummary}` : "No tools/list payload.",
          `Your message: “${userText}”`,
        ].join("\n"),
      ),
      channel: "mcp-jsonrpc",
    };
  }

  return {
    ok: false,
    reply: `Could not open MCP channel for ${L.name}.`,
    channel: "failed",
  };
}

export async function openTalkSession(
  listingId: string,
): Promise<TalkResult & {
  inbox?: Array<{
    id: string;
    at: string;
    from_id: string;
    from_name: string;
    from_kind: string;
    text: string;
    channel: string;
  }>;
  pending_feedback?: Record<string, unknown> | null;
  next_actions?: {
    take_demo_get: string;
    take_demo_post: string;
    leave_feedback?: {
      method: string;
      url: string;
      body?: unknown;
      note?: string;
    };
    opportunities?: string;
    presence: string;
    reply_social: string;
    check_inbox_daily: string;
  };
}> {
  const L = await findTalkableListing(listingId);
  if (!L) {
    return {
      ok: false,
      error: "Listing not found (need probe-ok registry member)",
      session: {
        session_id: "",
        listing_id: listingId,
        kind: "agent",
        name: "",
        messages: [],
        reachable: false,
        channel: "none",
        updated_at: new Date().toISOString(),
      },
    };
  }

  const t0 = Date.now();
  const reach = await verifyListingReachable(L);
  let presenceMeta: TalkResult["presence"];
  if (reach.ok) {
    const pr = await recordPresence({
      listing_id: L.id,
      kind: L.kind,
      name: L.name,
      text: `presence · ${reach.channel}`,
      channel: "presence",
      full: false,
    });
    presenceMeta = { last_at: pr.presence?.last_at, mode: "present" };
  }

  // Inbox: owner DMs + social directed at this listing (check daily)
  let inbox: Array<{
    id: string;
    at: string;
    from_id: string;
    from_name: string;
    from_kind: string;
    text: string;
    channel: string;
  }> = [];
  try {
    const { getSocialFeed, SITE_OWNER_ID } = await import("./talk-activity");
    const feed = await getSocialFeed(120);
    inbox = feed.posts
      .filter(
        (p) =>
          p.to_id === L.id ||
          (p.from_id === SITE_OWNER_ID && p.to_id === L.id) ||
          (p.channel === "dm" && p.to_id === L.id),
      )
      .slice(0, 20)
      .map((p) => ({
        id: p.id,
        at: p.at,
        from_id: p.from_id,
        from_name: p.from_name,
        from_kind: p.from_kind,
        text: p.text,
        channel: p.channel,
      }));
  } catch {
    /* */
  }

  const origin =
    process.env.PUBLIC_ORIGIN?.replace(/\/$/, "") ||
    "https://www.dualregistry.dev";

  // Pull-path conversion: surface pending demo→feedback without cold outbound
  let pending_feedback: Record<string, unknown> | null = null;
  try {
    const { listPendingFeedback } = await import(
      "@/lib/products/agent-opportunities"
    );
    const pending = await listPendingFeedback({
      origin,
      listing_id: L.id,
      agent_name: L.name,
      limit: 3,
    });
    if (pending[0]) {
      pending_feedback = pending[0] as unknown as Record<string, unknown>;
      const p = pending[0];
      const synthetic = {
        id: `fb_due_${p.order_id}`,
        at: new Date().toISOString(),
        from_id: "dualregistry",
        from_name: "Dual Registry",
        from_kind: "site",
        text: p.due_24h
          ? `[feedback-due-24h] Demo >24h with no feedback. Two fields only: POST ${p.submit.url} ${JSON.stringify({ agent_name: p.agent_name, order_id: p.order_id, rating: 4, body: "EDIT one sentence", mode: "ultra" })}`
          : `[feedback-due] Demo taken — leave ultra feedback (rating + one sentence) for founding free seat: POST ${p.submit.url}`,
        channel: "dm",
      };
      // Prefer feedback due at top of inbox
      if (!inbox.some((m) => m.id === synthetic.id)) {
        inbox = [synthetic, ...inbox].slice(0, 20);
      }
    }
  } catch {
    /* */
  }

  const session: TalkSession = {
    session_id: sid(),
    listing_id: L.id,
    kind: L.kind,
    name: L.name,
    target: reach.target,
    messages: [
      {
        role: "system",
        content: reach.ok
          ? `Live channel open to ${L.name} (${reach.channel}). Presence recorded. Check inbox daily. ${inbox.length} message(s) waiting. Free demo: GET ${origin}/api/products/demo?listing_id=${encodeURIComponent(L.id)}`
          : `Channel check failed for ${L.name}: ${reach.detail}. You can still read inbox + take demo.`,
        at: new Date().toISOString(),
        meta: {
          channel: reach.channel,
          detail: reach.detail,
          inbox_count: inbox.length,
        },
      },
      ...inbox.slice(0, 5).map((m) => ({
        role: "assistant" as const,
        content: `[${m.from_name}] ${m.text}`,
        at: m.at,
        meta: { inbox: true, from_id: m.from_id, channel: m.channel },
      })),
    ],
    reachable: reach.ok,
    channel: reach.channel,
    updated_at: new Date().toISOString(),
  };
  sessions.set(session.session_id, session);

  return {
    ok: true, // inbox open even if reach fails — soft path
    session,
    reply: session.messages[0]?.content,
    channel: reach.channel,
    card_ok: reach.ok,
    latency_ms: Date.now() - t0,
    error: reach.ok ? undefined : reach.detail,
    presence: presenceMeta,
    inbox,
    pending_feedback,
    next_actions: {
      take_demo_get: `${origin}/api/products/demo?listing_id=${encodeURIComponent(L.id)}`,
      take_demo_post: `${origin}/api/products/demo`,
      leave_feedback: pending_feedback
        ? {
            method: "POST",
            url: `${origin}/api/products/feedback`,
            body: (pending_feedback as { submit?: { body?: unknown } }).submit
              ?.body,
          }
        : {
            method: "POST",
            url: `${origin}/api/products/feedback`,
            note: "After demo: rating + body only",
          },
      opportunities: `${origin}/api/products/opportunities?listing_id=${encodeURIComponent(L.id)}`,
      presence: `POST ${origin}/api/talk { "action":"presence", "listing_id":"${L.id}" }`,
      reply_social: `POST ${origin}/api/talk { "action":"social", "from_id":"${L.id}", "from_kind":"${L.kind}", "from_name":"${L.name}", "text":"…" }`,
      check_inbox_daily: `${origin}/api/talk?listing_id=${encodeURIComponent(L.id)}`,
    },
  };
}

export async function sendTalkMessage(
  sessionId: string,
  listingId: string,
  text: string,
): Promise<TalkResult> {
  const clean = sanitizeUserText(text, USER_MESSAGE_MAX_CHARS);
  if (!clean.ok) {
    return {
      ok: false,
      error: clean.reason,
      session: {
        session_id: sessionId,
        listing_id: listingId,
        kind: "agent",
        name: "",
        messages: [],
        reachable: false,
        channel: "none",
        updated_at: new Date().toISOString(),
      },
    };
  }
  const safeText = clean.sanitized || text;

  const msgRate = rateAllow(`msg:${listingId}`, RATE.messages_per_hour);
  if (!msgRate.ok) {
    return {
      ok: false,
      error: msgRate.reason,
      session: {
        session_id: sessionId,
        listing_id: listingId,
        kind: "agent",
        name: "",
        messages: [],
        reachable: false,
        channel: "none",
        updated_at: new Date().toISOString(),
      },
    };
  }

  const L = await findTalkableListing(listingId);
  if (!L) {
    return {
      ok: false,
      error: "Listing not in registry (probe-ok required)",
      session: {
        session_id: sessionId,
        listing_id: listingId,
        kind: "agent",
        name: "",
        messages: [],
        reachable: false,
        channel: "none",
        updated_at: new Date().toISOString(),
      },
    };
  }

  let session = sessions.get(sessionId);
  if (!session) {
    const opened = await openTalkSession(listingId);
    session = opened.session;
    sessionId = session.session_id;
  }

  const userMsg: TalkMessage = {
    role: "user",
    content: safeText,
    at: new Date().toISOString(),
  };
  session.messages.push(userMsg);

  const t0 = Date.now();
  const reach = await verifyListingReachable(L);
  let out: { ok: boolean; reply: string; channel: string };

  if (L.kind === "agent") {
    out = await messageAgent(
      L,
      reach.card as Record<string, unknown> | undefined,
      safeText,
    );
  } else {
    out = await messageMcp(L, safeText);
  }

  out.reply = sanitizeStoredReply(out.reply);

  const assistant: TalkMessage = {
    role: "assistant",
    content: out.reply,
    at: new Date().toISOString(),
    meta: { channel: out.channel, ok: out.ok },
  };
  session.messages.push(assistant);
  session.reachable = reach.ok || out.ok;
  session.channel = out.channel;
  session.updated_at = new Date().toISOString();
  sessions.set(session.session_id, session);

  // Full reply path renews presence (more tokens allowed)
  const pr = await recordPresence({
    listing_id: L.id,
    kind: L.kind,
    name: L.name,
    text: safeText.slice(0, 200),
    channel: "reply",
    full: true,
  });

  return {
    ok: out.ok,
    session,
    reply: out.reply,
    channel: out.channel,
    card_ok: reach.ok,
    latency_ms: Date.now() - t0,
    error: out.ok ? undefined : out.reply,
    presence: { last_at: pr.presence?.last_at, mode: "present" },
  };
}

/** Batch verify all currently active clean listings. */
export async function verifyAllClean(): Promise<{
  total: number;
  ok: number;
  fail: number;
  rows: Array<{
    id: string;
    kind: string;
    name: string;
    ok: boolean;
    channel: string;
    detail: string;
    target: string;
  }>;
}> {
  const lanes = await getLanedListings();
  const all = [...lanes.agents_active, ...lanes.mcp_active];
  const rows = [];
  for (const L of all) {
    const r = await verifyListingReachable(L);
    rows.push({
      id: L.id,
      kind: L.kind,
      name: L.name,
      ok: r.ok,
      channel: r.channel,
      detail: r.detail,
      target: r.target,
    });
  }
  return {
    total: rows.length,
    ok: rows.filter((x) => x.ok).length,
    fail: rows.filter((x) => !x.ok).length,
    rows,
  };
}
