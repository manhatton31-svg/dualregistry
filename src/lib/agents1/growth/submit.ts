import { STORE_BASE } from "../types";
import { deriveAgentIntentMeta } from "../intent-meta";
import { loadStoreCache, mergeLiveIntoCache } from "../store-cache";
import {
  canSubmit,
  detectKvLimitMessage,
  getRemaining,
  isReadSafe,
  loadFreeTier,
  markLiveOk,
  recordGet,
  recordPut,
  shouldLiveFetch,
  tripGetLimit,
  tripPutLimit,
} from "../free-tier";
import type { GrowthCandidate } from "./types";

const UA =
  "Agents1GrowthBot/1.0 (+https://github.com/manhatton31-svg/grok-agent-store)";

export type StoreSubmitResult = {
  ok: boolean;
  created?: boolean;
  status?: string;
  reason?: string;
  message?: string;
  error?: string;
  safety_score?: number;
  item?: { id?: string; slug?: string; name?: string };
  raw: unknown;
  kv_limited?: boolean;
  kv_kind?: "get" | "put";
  duplicate?: boolean;
  approved?: boolean;
  counts_as_put: boolean;
};

export async function submitCandidate(
  c: GrowthCandidate,
): Promise<StoreSubmitResult> {
  const gate = await canSubmit();
  if (!gate.allow) {
    return {
      ok: false,
      error: gate.reason,
      message: gate.reason,
      raw: null,
      kv_limited: true,
      kv_kind: isReadSafe(gate.state) ? "get" : "put",
      counts_as_put: false,
    };
  }

  const path =
    c.kind === "agent" ? "/v1/agents/submit" : "/v1/registry/submit";
  let body: Record<string, unknown>;
  if (c.kind === "agent") {
    const intent = deriveAgentIntentMeta(c);
    const endpoint =
      c.endpoint_url || c.website || c.repository || c.agent_card_url;
    body = {
      name: c.name,
      description: c.description,
      repository: c.repository,
      website: c.website || c.repository || endpoint,
      endpoint_url: endpoint,
      agent_card_url: c.agent_card_url,
      mcp_url: c.mcp_url,
      framework: c.framework || "open",
      protocols: c.protocols?.length ? c.protocols : ["a2a", "rest"],
      capabilities: intent.capabilities,
      skills: intent.skills,
      author: c.author || "agents1-growth",
      tags: ["agents1-autogrowth", "intent-complete"],
      source: c.source,
    };
  } else {
    body = {
      name: c.name,
      description: c.description,
      repository: c.repository,
      website: c.website || c.repository,
      remote_url: c.remote_url,
      author: c.author || "agents1-growth",
      tags: ["agents1-autogrowth"],
      source: c.source,
    };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);
  try {
    // Submit implies worker get (dedupe) + put
    await recordGet(1);
    const res = await fetch(`${STORE_BASE}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "user-agent": UA,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const limitKind = detectKvLimitMessage(text);
    if (limitKind === "get") {
      await tripGetLimit(`submit ${path}: get() limit`);
      return {
        ok: false,
        error: "KV get() limit exceeded for the day.",
        message: "Store read quota exhausted — safe until UTC midnight",
        raw: text,
        kv_limited: true,
        kv_kind: "get",
        counts_as_put: false,
      };
    }
    if (limitKind === "put") {
      await tripPutLimit(`submit ${path}: put() limit`);
      return {
        ok: false,
        error: "KV put() limit exceeded for the day.",
        message: "Store write quota exhausted — safe until UTC midnight",
        raw: text,
        kv_limited: true,
        kv_kind: "put",
        counts_as_put: true,
      };
    }

    let raw: unknown = text;
    try {
      raw = JSON.parse(text);
    } catch {
      /* keep */
    }
    const obj =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const err =
      (typeof obj.error === "string" && obj.error) ||
      (res.ok ? undefined : `HTTP ${res.status}`);
    const msg =
      (typeof obj.message === "string" && obj.message) ||
      err ||
      (typeof obj.reason === "string" ? obj.reason : "");

    // Count put if request reached store and wasn't a pure client abort
    await recordPut(1);

    const reason = typeof obj.reason === "string" ? obj.reason : undefined;
    const duplicate =
      reason === "duplicate_approved" ||
      reason === "duplicate" ||
      /duplicate/i.test(reason || "") ||
      /already/i.test(msg || "");
    const approved =
      obj.auto_approved === true ||
      obj.status === "approved" ||
      (obj.item &&
        typeof obj.item === "object" &&
        (obj.item as { status?: string }).status === "approved");

    return {
      ok: obj.ok === true || res.ok,
      created: obj.created === true,
      status: typeof obj.status === "string" ? obj.status : undefined,
      reason,
      message: msg,
      error: err,
      safety_score:
        typeof obj.safety_score === "number" ? obj.safety_score : undefined,
      item:
        obj.item && typeof obj.item === "object"
          ? (obj.item as { id?: string; slug?: string; name?: string })
          : undefined,
      raw,
      duplicate,
      approved: Boolean(approved),
      counts_as_put: true,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: message,
      message,
      raw: null,
      kv_limited: false,
      counts_as_put: false,
    };
  } finally {
    clearTimeout(t);
  }
}

export type StoreIndex = {
  mcp_names: string[];
  agent_names: string[];
  mcp_repos: string[];
  agent_repos: string[];
  agent_cards: string[];
  mcp_total: number;
  agent_total: number;
  from_cache: boolean;
};

export async function fetchStoreIndex(): Promise<StoreIndex> {
  const cache = await loadStoreCache();
  const empty: StoreIndex = {
    mcp_names: [...(cache.mcp_names || [])],
    agent_names: [...(cache.agent_names || [])],
    mcp_repos: [...(cache.mcp_repos || [])],
    agent_repos: [...(cache.agent_repos || [])],
    agent_cards: [...(cache.agent_cards || [])],
    mcp_total: cache.mcp_approved,
    agent_total: cache.agents_approved,
    from_cache: true,
  };

  const ft = await loadFreeTier();
  if (isReadSafe(ft)) {
    return empty;
  }
  // Prefer cache unless live refresh is due — index is the #1 get burner
  const liveGate = await shouldLiveFetch();
  if (!liveGate.allow) {
    return empty;
  }

  async function get(path: string) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);
    try {
      await recordGet(1);
      const res = await fetch(`${STORE_BASE}${path}`, {
        signal: controller.signal,
        headers: { "user-agent": UA, accept: "application/json" },
      });
      const text = await res.text();
      const kind = detectKvLimitMessage(text);
      if (kind === "get") {
        await tripGetLimit(`index ${path}`);
        return null;
      }
      if (kind === "put") {
        await tripPutLimit(`index ${path}`);
        return null;
      }
      if (!res.ok) return null;
      if (!text.trim().startsWith("{") && !text.trim().startsWith("["))
        return null;
      return JSON.parse(text);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  // Sequential heavy gets (max 2–3) — never fan-out parallel on free tier
  const agents = await get("/agents.json");
  if (isReadSafe(await loadFreeTier())) {
    return empty;
  }
  const mcp = await get("/registry.json?limit=100");
  let milestones: unknown = null;
  const ftAfter = await loadFreeTier();
  if (!isReadSafe(ftAfter) && getRemaining(ftAfter) > 20) {
    milestones = await get("/v1/milestones");
  }

  let liveAny = false;
  const out: StoreIndex = { ...empty, from_cache: true };

  if (agents && typeof agents === "object") {
    liveAny = true;
    const a = agents as {
      total?: number;
      items?: Array<{
        name?: string;
        repository?: string;
        agent_card_url?: string;
      }>;
    };
    out.agent_total = Math.max(
      out.agent_total,
      a.total ?? a.items?.length ?? 0,
    );
    // MERGE with cache — paginated /agents.json is partial; never drop known names
    const names = new Set(out.agent_names.map((n) => n.toLowerCase()));
    const repos = new Set(out.agent_repos.map((r) => r.toLowerCase()));
    const cards = new Set(out.agent_cards.map((c) => c.toLowerCase()));
    for (const item of a.items || []) {
      if (item.name) names.add(item.name.toLowerCase());
      if (item.repository) repos.add(item.repository.toLowerCase());
      if (item.agent_card_url) cards.add(item.agent_card_url.toLowerCase());
    }
    out.agent_names = [...names];
    out.agent_repos = [...repos];
    out.agent_cards = [...cards];
  }
  if (mcp && typeof mcp === "object") {
    liveAny = true;
    const m = mcp as {
      total?: number;
      items?: Array<{ name?: string; repository?: string }>;
    };
    out.mcp_total = Math.max(out.mcp_total, m.total ?? m.items?.length ?? 0);
    const names = new Set(out.mcp_names.map((n) => n.toLowerCase()));
    const repos = new Set(out.mcp_repos.map((r) => r.toLowerCase()));
    for (const item of m.items || []) {
      if (item.name) names.add(item.name.toLowerCase());
      if (item.repository) repos.add(item.repository.toLowerCase());
    }
    out.mcp_names = [...names];
    out.mcp_repos = [...repos];
  }
  if (milestones && typeof milestones === "object") {
    liveAny = true;
    const mil = milestones as {
      mcp?: { approved?: number };
      agents?: { approved?: number };
    };
    if (mil.mcp?.approved != null)
      out.mcp_total = Math.max(out.mcp_total, mil.mcp.approved);
    if (mil.agents?.approved != null)
      out.agent_total = Math.max(out.agent_total, mil.agents.approved);
  }

  out.mcp_total = Math.max(out.mcp_total, cache.mcp_approved);
  out.agent_total = Math.max(out.agent_total, cache.agents_approved);
  out.from_cache = !liveAny;

  if (liveAny) await markLiveOk();

  await mergeLiveIntoCache({
    live: liveAny,
    source: STORE_BASE,
    milestones:
      milestones && typeof milestones === "object"
        ? (milestones as never)
        : null,
    mcp: mcp && typeof mcp === "object" ? (mcp as never) : null,
    agents: agents && typeof agents === "object" ? (agents as never) : null,
  });

  return out;
}
