/**
 * Cheap pre-screen before a full handshake probe.
 * Avoids wasting probes on targets that will almost certainly fail.

 *
 * High-confidence fail → delist / skip (no budget spend)
 * Promising / unknown → full probe
 */
import type { ProbeTarget } from "./probe";
import { dataRoot } from "@/lib/data-root";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadDurableJson } from "./durable-json";

export type PreflightVerdict = {
  /** true = run full probe; false = do not spend budget */
  proceed: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  /** if !proceed, treat as fail for delist */
  predict_fail: boolean;
  primary_url?: string;
  status?: number;
};

const DEAD_HOST_PATHS: Array<{ host: RegExp; path: RegExp; why: string }> = [
  {
    host: /^github\.com$/i,
    path: /^\/\.well-known\//i,
    why: "github.com/.well-known/* is never a valid agent/MCP card (repo pages only)",
  },
  {
    host: /^github\.com$/i,
    path: /^\/well-known\//i,
    why: "typo path /well-known on github.com (missing dot) — always 404",
  },
  {
    host: /^www\.github\.com$/i,
    path: /^\/\.well-known\//i,
    why: "www.github.com/.well-known is not a publishable agent card",
  },
  {
    host: /^(localhost|127\.0\.0\.1)$/i,
    path: /.*/,
    why: "localhost/127.0.0.1 is not publicly probeable",
  },
];

let delistedIdCache: { at: number; ids: Set<string> } | null = null;

/** IDs already delisted — never re-probe until resubmit */
export async function loadDelistedIdSet(): Promise<Set<string>> {
  if (delistedIdCache && Date.now() - delistedIdCache.at < 30_000) {
    return delistedIdCache.ids;
  }
  const ids = new Set<string>();
  try {
    const remote = await loadDurableJson<{
      items?: Array<{ id?: string }>;
      active_ids?: string[];
    }>("delisted.json", () => ({ items: [], active_ids: [] }));
    for (const id of remote.active_ids || []) if (id) ids.add(id);
    for (const it of remote.items || []) if (it?.id) ids.add(it.id);
  } catch {
    /* */
  }
  try {
    const raw = await readFile(
      join(dataRoot(), "products", "delisted.json"),
      "utf8",
    );
    const j = JSON.parse(raw) as {
      items?: Array<{ id?: string }>;
      active_ids?: string[];
    };
    for (const id of j.active_ids || []) if (id) ids.add(id);
    for (const it of j.items || []) if (it?.id) ids.add(it.id);
  } catch {
    /* */
  }
  delistedIdCache = { at: Date.now(), ids };
  return ids;
}

export function invalidateDelistedCache() {
  delistedIdCache = null;
}

function candidateUrls(item: ProbeTarget): string[] {
  const out: string[] = [];
  const push = (u?: string) => {
    if (u && u.startsWith("http") && !out.includes(u)) out.push(u);
  };
  push(item.agent_card_url);
  push(item.remote_url);
  push(item.endpoint_url);
  if (item.website?.startsWith("http")) {
    try {
      const origin = new URL(item.website).origin;
      if (item.kind === "agent" || item.agent_card_url || item.endpoint_url) {
        push(`${origin}/.well-known/agent.json`);
        push(`${origin}/.well-known/ai-agent.json`);
        push(`${origin}/.well-known/agent-card.json`);
      } else {
        push(`${origin}/.well-known/mcp/server-card.json`);
        push(item.website);
      }
    } catch {
      /* */
    }
  }
  return out;
}

function patternFail(url: string): string | null {
  try {
    const u = new URL(url);
    for (const rule of DEAD_HOST_PATHS) {
      if (rule.host.test(u.hostname) && rule.path.test(u.pathname)) {
        return rule.why;
      }
    }
    if (u.hostname === "github.com" && /^\/?$/.test(u.pathname)) {
      return "github.com root is not an agent card URL";
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return "non-http URL";
    }
  } catch {
    return "invalid URL";
  }
  return null;
}

/**
 * Pattern-only check (0 network). Use to rank / filter queue.
 */
export function preflightPatterns(item: ProbeTarget): PreflightVerdict {
  // Already delisted — never select
  if (item.id && delistedIdCache?.ids.has(item.id)) {
    return {
      proceed: false,
      confidence: "high",
      reason: "already delisted — resubmit required",
      predict_fail: true,
    };
  }
  if (item.store_id && delistedIdCache?.ids.has(item.store_id)) {
    return {
      proceed: false,
      confidence: "high",
      reason: "already delisted — resubmit required",
      predict_fail: true,
    };
  }

  const urls = candidateUrls(item);
  if (!urls.length) {
    return {
      proceed: false,
      confidence: "high",
      reason: "no probeable URL (agent_card_url / remote_url / website)",
      predict_fail: true,
    };
  }
  const reasons = urls.map((u) => patternFail(u));
  if (reasons.every(Boolean)) {
    return {
      proceed: false,
      confidence: "high",
      reason: reasons.find(Boolean) || "known-dead URL pattern",
      predict_fail: true,
      primary_url: urls[0],
    };
  }
  const primary = urls.find((u) => !patternFail(u)) || urls[0]!;
  return {
    proceed: true,
    confidence: "low",
    reason: "patterns ok — needs live check",
    predict_fail: false,
    primary_url: primary,
  };
}

/**
 * Optional cheap GET (short timeout). 404/410 on primary → high-confidence fail.
 * Does not count as a full handshake probe.
 */
export async function preflightLive(
  item: ProbeTarget,
  opts?: { timeoutMs?: number },
): Promise<PreflightVerdict> {
  // Refresh delisted set
  try {
    await loadDelistedIdSet();
  } catch {
    /* */
  }
  const pat = preflightPatterns(item);
  if (!pat.proceed) return pat;

  const url = pat.primary_url!;
  const timeoutMs = opts?.timeoutMs ?? 2500;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "DualRegistry-Preflight/1.0 (+https://dualregistry.dev)",
      },
    });
    clearTimeout(t);
    const status = res.status;
    if (status === 404 || status === 410) {
      return {
        proceed: false,
        confidence: "high",
        reason: `preflight ${status} on ${url.slice(0, 80)} — card missing`,
        predict_fail: true,
        primary_url: url,
        status,
      };
    }
    if (status === 401 || status === 403 || status === 402) {
      return {
        proceed: true,
        confidence: "medium",
        reason: `preflight ${status} — reachable but gated; full probe will score`,
        predict_fail: false,
        primary_url: url,
        status,
      };
    }
    if (status >= 200 && status < 400) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("text/html") && !ct.includes("json")) {
        try {
          const text = (await res.text()).slice(0, 200).trim();
          if (text.startsWith("<") || /^<!doctype/i.test(text)) {
            return {
              proceed: false,
              confidence: "medium",
              reason: `preflight HTML body (not JSON card) at ${url.slice(0, 60)}`,
              predict_fail: true,
              primary_url: url,
              status,
            };
          }
        } catch {
          /* */
        }
      }
      return {
        proceed: true,
        confidence: "medium",
        reason: `preflight ${status} — looks reachable`,
        predict_fail: false,
        primary_url: url,
        status,
      };
    }
    return {
      proceed: true,
      confidence: "low",
      reason: `preflight status ${status} — full probe`,
      predict_fail: false,
      primary_url: url,
      status,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort|timeout/i.test(msg)) {
      return {
        proceed: false,
        confidence: "medium",
        reason: `preflight timeout (${timeoutMs}ms) — endpoint not reachable`,
        predict_fail: true,
        primary_url: url,
      };
    }
    return {
      proceed: true,
      confidence: "low",
      reason: `preflight network: ${msg.slice(0, 80)}`,
      predict_fail: false,
      primary_url: url,
    };
  }
}
