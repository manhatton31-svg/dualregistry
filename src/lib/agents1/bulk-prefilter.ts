/**
 * One-shot bulk prefilter of the full store registry.
 * Delists + blocks known-fail listings WITHOUT spending probe budget.
 */
import { STORE_BASE } from "./types";
import { delistOnProbeFail, delistStats } from "./delist-on-fail";
import {
  loadCounterFloors,
  raiseDelistedFloor,
  blockProbeTarget,
  saveCounterFloors,
} from "./counter-floors";
import { loadDelistedIdSet, preflightPatterns } from "./probe-preflight";
import type { ProbeTarget } from "./probe";
import { loadStoreCache, saveStoreCache } from "./store-cache";

export type BulkPrefilterResult = {
  scanned: number;
  mcp_scanned: number;
  agents_scanned: number;
  pattern_fail: number;
  live_fail: number;
  keep: number;
  already_delisted: number;
  newly_delisted: number;
  blocked_urls: number;
  samples: Array<{
    id: string;
    kind: string;
    name?: string;
    reason: string;
    url?: string;
  }>;
  delisted_total: number;
  kept_ids: { mcp: number; agents: number };
};

async function fetchJson(path: string): Promise<any> {
  const url = path.startsWith("http") ? path : `${STORE_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "DualRegistry-BulkPrefilter/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function fetchAllItems(path: string): Promise<{
  total: number;
  items: Record<string, any>[];
}> {
  const items: Record<string, any>[] = [];
  let total = 0;
  let offset = 0;
  const limit = 200;
  for (let page = 0; page < 20; page++) {
    const data = await fetchJson(`${path}?offset=${offset}&limit=${limit}`);
    total = Number(data.total) || total;
    const batch: Record<string, any>[] =
      data.items || data.mcps || data.agents || [];
    if (!batch.length) break;
    items.push(...batch);
    offset += batch.length;
    if (batch.length < limit) break;
    if (total && items.length >= total) break;
  }
  const seen = new Set<string>();
  const uniq: Record<string, any>[] = [];
  for (const it of items) {
    const id = String(it.id || it.slug || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniq.push(it);
  }
  return { total: total || uniq.length, items: uniq };
}

function toTarget(
  kind: "agent" | "mcp",
  item: Record<string, any>,
): ProbeTarget {
  return {
    id: String(item.id || item.slug || item.name),
    store_id: item.id ? String(item.id) : undefined,
    kind,
    name: item.name || item.slug,
    agent_card_url: item.agent_card_url,
    endpoint_url: item.endpoint_url,
    remote_url: item.remote_url,
    website: item.website || item.repository,
    repository: item.repository,
  };
}

function primaryUrl(t: ProbeTarget): string | undefined {
  return (
    t.agent_card_url ||
    t.remote_url ||
    t.endpoint_url ||
    (t.website?.startsWith("http") ? t.website : undefined)
  );
}

async function cheapGet(
  url: string,
  timeoutMs = 2500,
): Promise<{ status: number; html: boolean; err?: string }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "DualRegistry-BulkPrefilter/1.0",
      },
    });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let html = ct.includes("text/html") && !ct.includes("json");
    if (html && res.ok) {
      try {
        const t = (await res.text()).slice(0, 120).trim();
        html = t.startsWith("<") || /^<!doctype/i.test(t);
      } catch {
        /* */
      }
    }
    return { status: res.status, html };
  } catch (e) {
    return {
      status: 0,
      html: false,
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return out;
}

export async function runBulkPrefilter(opts?: {
  liveCheck?: boolean;
  concurrency?: number;
  dryRun?: boolean;
}): Promise<BulkPrefilterResult> {
  const liveCheck = opts?.liveCheck !== false;
  const concurrency = opts?.concurrency ?? 14;
  const dryRun = !!opts?.dryRun;

  const [reg, agents] = await Promise.all([
    fetchAllItems("/v1/registry"),
    fetchAllItems("/v1/agents"),
  ]);
  const mcpItems = reg.items;
  const agentItems = agents.items;

  const already = await loadDelistedIdSet();
  const floors = await loadCounterFloors();
  const blockedIds = new Set(floors.blocked_ids || []);
  const blockedUrls = new Set(floors.blocked_urls || []);

  const targets: ProbeTarget[] = [
    ...mcpItems.map((m) => toTarget("mcp", m)),
    ...agentItems.map((a) => toTarget("agent", a)),
  ];

  const samples: BulkPrefilterResult["samples"] = [];
  let pattern_fail = 0;
  let live_fail = 0;
  let keep = 0;
  let already_delisted = 0;
  let newly_delisted = 0;
  const keepIds = { mcp: 0, agents: 0 };

  type Verdict = {
    t: ProbeTarget;
    fail: boolean;
    reason: string;
    url?: string;
    stage: "pattern" | "live" | "keep" | "skip";
  };

  const firstPass: Verdict[] = [];
  for (const t of targets) {
    const id = t.store_id || t.id;
    if (already.has(id) || blockedIds.has(id)) {
      already_delisted++;
      firstPass.push({
        t,
        fail: true,
        reason: "already delisted/blocked",
        stage: "skip",
      });
      continue;
    }
    const pf = preflightPatterns(t);
    if (!pf.proceed) {
      pattern_fail++;
      firstPass.push({
        t,
        fail: true,
        reason: pf.reason,
        url: pf.primary_url || primaryUrl(t),
        stage: "pattern",
      });
      continue;
    }
    const urls = [t.agent_card_url, t.remote_url, t.endpoint_url].filter(
      Boolean,
    ) as string[];
    let hard: string | null = null;
    for (const u of urls) {
      try {
        const x = new URL(u);
        if (
          /github\.com$/i.test(x.hostname) &&
          /\/\.well-known\//i.test(x.pathname)
        ) {
          hard = "github.com/.well-known card (never valid)";
        }
        if (/^(localhost|127\.0\.0\.1)$/i.test(x.hostname)) hard = "localhost";
        if (
          t.kind === "agent" &&
          t.agent_card_url &&
          /github\.com/i.test(t.agent_card_url) &&
          t.endpoint_url &&
          /github\.com/i.test(t.endpoint_url)
        ) {
          hard = "agent card/endpoint on github.com (not probeable)";
        }
      } catch {
        hard = "invalid URL";
      }
    }
    if (hard) {
      pattern_fail++;
      firstPass.push({
        t,
        fail: true,
        reason: hard,
        url: primaryUrl(t),
        stage: "pattern",
      });
      continue;
    }
    firstPass.push({
      t,
      fail: false,
      reason: "pending live",
      url: primaryUrl(t),
      stage: "keep",
    });
  }

  const pending = firstPass.filter((v) => !v.fail && v.stage === "keep");
  if (liveCheck && pending.length) {
    const liveResults = await mapPool(pending, concurrency, async (v) => {
      const url = v.url || primaryUrl(v.t);
      if (!url) {
        return {
          ...v,
          fail: true,
          reason: "no probeable URL",
          stage: "pattern" as const,
        };
      }
      if (blockedUrls.has(url.split("?")[0]!.toLowerCase())) {
        return {
          ...v,
          fail: true,
          reason: "blocked URL",
          url,
          stage: "skip" as const,
        };
      }
      const g = await cheapGet(url);
      if (g.status === 404 || g.status === 410) {
        return {
          ...v,
          fail: true,
          reason: `live ${g.status} on ${url.slice(0, 70)}`,
          url,
          stage: "live" as const,
        };
      }
      if (g.status === 0 && g.err && /abort|timeout/i.test(g.err)) {
        return {
          ...v,
          fail: true,
          reason: `timeout ${url.slice(0, 60)}`,
          url,
          stage: "live" as const,
        };
      }
      if (g.html && g.status >= 200 && g.status < 400) {
        if (
          v.t.agent_card_url === url ||
          (v.t.remote_url === url && /smithery|mcp/i.test(url))
        ) {
          return {
            ...v,
            fail: true,
            reason: `HTML body (not JSON card) ${url.slice(0, 60)}`,
            url,
            stage: "live" as const,
          };
        }
      }
      return { ...v, fail: false, reason: "ok", url, stage: "keep" as const };
    });
    const byId = new Map(liveResults.map((r) => [r.t.id, r]));
    for (let i = 0; i < firstPass.length; i++) {
      const v = firstPass[i]!;
      if (!v.fail && v.stage === "keep") {
        firstPass[i] = byId.get(v.t.id) || v;
      }
    }
  }

  for (const v of firstPass) {
    if (v.stage === "skip" && v.reason.startsWith("already")) continue;
    if (!v.fail) {
      keep++;
      if (v.t.kind === "mcp") keepIds.mcp++;
      else keepIds.agents++;
      continue;
    }
    if (v.stage === "live") live_fail++;
    if (samples.length < 50) {
      samples.push({
        id: v.t.store_id || v.t.id,
        kind: v.t.kind || "?",
        name: v.t.name,
        reason: v.reason,
        url: v.url,
      });
    }
    if (dryRun) {
      newly_delisted++;
      continue;
    }
    const fakeProbe = {
      id: v.t.store_id || v.t.id,
      kind: (v.t.kind || "agent") as "agent" | "mcp",
      target: v.url || "",
      ok: false,
      latency_ms: 0,
      score: 0,
      signals: ["bulk-prefilter", v.reason.slice(0, 120)],
      handshake: "fail" as const,
      protocol_hints: [] as string[],
      probed_at: new Date().toISOString(),
    };
    try {
      const del = await delistOnProbeFail({
        id: v.t.store_id || v.t.id,
        kind: (v.t.kind || "agent") as "agent" | "mcp",
        name: v.t.name,
        agent_card_url: v.t.agent_card_url,
        remote_url: v.t.remote_url,
        website: v.t.website,
        probe: fakeProbe,
      });
      if (del) newly_delisted++;
      await blockProbeTarget({
        id: v.t.store_id || v.t.id,
        url: v.url,
      });
    } catch {
      newly_delisted++;
    }
  }

  const stats = await delistStats();
  await raiseDelistedFloor(stats.total);

  try {
    const cache = await loadStoreCache();
    cache.mcp_approved = reg.total || mcpItems.length;
    cache.agents_approved = agents.total || agentItems.length;
    cache.mcp_items = mcpItems as any;
    cache.agent_items = agentItems as any;
    cache.updated_at = new Date().toISOString();
    cache.source = "bulk-prefilter";
    await saveStoreCache(cache);
  } catch {
    /* */
  }

  const floors2 = await loadCounterFloors();
  await saveCounterFloors(floors2);

  return {
    scanned: targets.length,
    mcp_scanned: mcpItems.length,
    agents_scanned: agentItems.length,
    pattern_fail,
    live_fail,
    keep,
    already_delisted,
    newly_delisted,
    blocked_urls: (floors2.blocked_urls || []).length,
    samples,
    delisted_total: Math.max(stats.total, floors2.delisted_floor || 0),
    kept_ids: keepIds,
  };
}
