/**
 * Real conversation with clean/active agents and MCPs.
 * Routes to the listing's own card URL / endpoint / MCP transport — never faked.
 */
import { getLanedListings, type LanedListing } from "./listing-lanes";
import { validateA2ACard } from "./a2a-card";

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
};

const sessions = new Map<string, TalkSession>();

function sid() {
  return `talk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json?: unknown; text?: string }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        "user-agent": UA,
        ...(init?.headers || {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
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

export async function findCleanListing(
  listingId: string,
): Promise<LanedListing | null> {
  const lanes = await getLanedListings();
  const all = [...lanes.agents_active, ...lanes.mcp_active];
  return all.find((x) => x.id === listingId) || null;
}

/** Confirm card/endpoint still returns a valid surface. */
export async function verifyListingReachable(L: LanedListing): Promise<{
  ok: boolean;
  target: string;
  channel: string;
  detail: string;
  card?: unknown;
}> {
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

  if (L.kind === "agent" || /agent\.json|agent-card/i.test(target)) {
    const r = await fetchJson(target);
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

  // MCP: server-card or transport
  if (/server-card|well-known\/mcp/i.test(target)) {
    const r = await fetchJson(target);
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

  // MCP JSON-RPC initialize against remote_url
  const remote = L.remote_url || target;
  const init = await fetchJson(remote, {
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
  });
  if (init.ok || (init.json && typeof init.json === "object")) {
    return {
      ok: true,
      target: remote,
      channel: "mcp-jsonrpc",
      detail: `MCP initialize HTTP ${init.status}`,
      card: init.json,
    };
  }

  // Soft GET reachability
  const get = await fetchJson(remote);
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
  history: TalkMessage[],
): Promise<{ ok: boolean; reply: string; channel: string }> {
  const endpoint =
    (typeof card?.url === "string" && card.url) ||
    L.endpoint_url ||
    L.website ||
    "";
  const cardUrl = L.agent_card_url || L.probe?.target || "";

  // A2A-style message/send (JSON-RPC)
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
    const r = await fetchJson(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.json && typeof r.json === "object") {
      const j = r.json as {
        result?: { parts?: Array<{ text?: string }>; message?: { parts?: Array<{ text?: string }> } };
        error?: { message?: string };
      };
      const parts =
        j.result?.parts ||
        j.result?.message?.parts ||
        [];
      const text = parts
        .map((p) => p.text)
        .filter(Boolean)
        .join("\n");
      if (text) {
        return { ok: true, reply: text, channel: "a2a-message/send" };
      }
      if (j.error?.message) {
        return {
          ok: false,
          reply: `Agent error: ${j.error.message}`,
          channel: "a2a-message/send",
        };
      }
      // Some agents return free-form
      const raw = JSON.stringify(r.json).slice(0, 1500);
      if (r.ok) {
        return {
          ok: true,
          reply: `Agent responded (structured):\n\`\`\`json\n${raw}\n\`\`\``,
          channel: "a2a-raw",
        };
      }
    }

    // Plain text POST fallback
    const t = await fetchJson(endpoint, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: userText,
    });
    if (t.ok && t.text && !t.text.trim().startsWith("<!")) {
      return {
        ok: true,
        reply: t.text.slice(0, 2000),
        channel: "http-post-text",
      };
    }
  }

  // Card-only: return grounded intro from live card (still real fetch)
  if (cardUrl) {
    const r = await fetchJson(cardUrl);
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
        reply: [
          `Connected to **${c.name || L.name}** via live agent card.`,
          c.description || L.description || "",
          skills ? `\nSkills:\n${skills}` : "",
          c.url ? `\nAgent endpoint: ${c.url}` : "",
          `\nYour message: “${userText}”`,
          endpoint
            ? `\n(Direct message/send to ${endpoint} did not return text — card is live; endpoint may require auth or a different protocol.)`
            : "\n(No message endpoint on card — use skills/endpoint when published.)",
        ]
          .filter(Boolean)
          .join("\n"),
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
    const init = await fetchJson(remote, {
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
    });
    initOk = Boolean(init.ok || init.json);
    if (init.json) {
      const tools = await fetchJson(remote, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      });
      const tj = tools.json as {
        result?: { tools?: Array<{ name?: string; description?: string }> };
      };
      const list = tj?.result?.tools || [];
      if (list.length) {
        toolsSummary = list
          .slice(0, 12)
          .map((t) => `• ${t.name}${t.description ? `: ${t.description}` : ""}`)
          .join("\n");

        // Try a lightweight tools/call if user mentions a tool name
        const lower = userText.toLowerCase();
        const hit = list.find(
          (t) => t.name && lower.includes(String(t.name).toLowerCase()),
        );
        if (hit?.name) {
          const call = await fetchJson(remote, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: { name: hit.name, arguments: { query: userText } },
            }),
          });
          if (call.json) {
            return {
              ok: true,
              reply: `MCP tool \`${hit.name}\` response:\n\`\`\`json\n${JSON.stringify(call.json, null, 2).slice(0, 1800)}\n\`\`\``,
              channel: "mcp-tools/call",
            };
          }
        }
      }
    }
  }

  if (cardUrl) {
    const r = await fetchJson(cardUrl);
    if (r.json) {
      const c = r.json as {
        name?: string;
        title?: string;
        description?: string;
        remotes?: Array<{ url?: string }>;
      };
      return {
        ok: true,
        reply: [
          `Connected to **${c.title || c.name || L.name}** via live MCP card.`,
          c.description || L.description || "",
          c.remotes?.[0]?.url ? `Transport: ${c.remotes[0].url}` : remote ? `Transport: ${remote}` : "",
          initOk ? "JSON-RPC initialize: ok" : "",
          toolsSummary ? `\nTools:\n${toolsSummary}` : "",
          `\nYour message: “${userText}”`,
          toolsSummary
            ? "\nTip: name a tool in your message to invoke tools/call."
            : "\n(Live card confirmed. Transport may need auth for tools.)",
        ]
          .filter(Boolean)
          .join("\n"),
        channel: initOk ? "mcp-jsonrpc+card" : "mcp-card-live",
      };
    }
  }

  if (initOk) {
    return {
      ok: true,
      reply: [
        `MCP transport at ${remote} accepted initialize.`,
        toolsSummary ? `Tools:\n${toolsSummary}` : "No tools/list payload.",
        `Your message: “${userText}”`,
      ].join("\n"),
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
): Promise<TalkResult> {
  const L = await findCleanListing(listingId);
  if (!L) {
    return {
      ok: false,
      error: "Listing not found in clean/active registry",
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
          ? `Live channel open to ${L.name} (${reach.channel}). ${reach.detail}`
          : `Channel check failed for ${L.name}: ${reach.detail}`,
        at: new Date().toISOString(),
        meta: { channel: reach.channel, detail: reach.detail },
      },
    ],
    reachable: reach.ok,
    channel: reach.channel,
    updated_at: new Date().toISOString(),
  };
  sessions.set(session.session_id, session);

  return {
    ok: reach.ok,
    session,
    reply: session.messages[0]?.content,
    channel: reach.channel,
    card_ok: reach.ok,
    latency_ms: Date.now() - t0,
    error: reach.ok ? undefined : reach.detail,
  };
}

export async function sendTalkMessage(
  sessionId: string,
  listingId: string,
  text: string,
): Promise<TalkResult> {
  const L = await findCleanListing(listingId);
  if (!L) {
    return {
      ok: false,
      error: "Listing not in clean registry",
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
    content: text.slice(0, 4000),
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
      text,
      session.messages,
    );
  } else {
    out = await messageMcp(L, text);
  }

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

  return {
    ok: out.ok,
    session,
    reply: out.reply,
    channel: out.channel,
    card_ok: reach.ok,
    latency_ms: Date.now() - t0,
    error: out.ok ? undefined : out.reply,
  };
}

/** Batch verify all clean listings (for QA). */
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
