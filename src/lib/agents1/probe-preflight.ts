/**
 * Cheap pre-screen before a full handshake probe.
 * Avoids burning the daily 240 budget on targets that will almost certainly fail.
 *
 * High-confidence fail → delist / skip (no budget spend)
 * Promising / unknown → full probe
 */
import type { ProbeTarget } from "./probe";

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
  // Bare github.com well-known — never a real agent card
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
];

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
    // Empty / bare host homepage as only candidate for agents is weak but not auto-fail
    if (u.hostname === "github.com" && /^\/?$/.test(u.pathname)) {
      return "github.com root is not an agent card URL";
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
  const urls = candidateUrls(item);
  if (!urls.length) {
    return {
      proceed: false,
      confidence: "high",
      reason: "no probeable URL (agent_card_url / remote_url / website)",
      predict_fail: true,
    };
  }
  // If EVERY candidate is a known-dead pattern → fail early
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
  // Prefer first non-dead URL
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
    // Hard dead
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
    // Paywall / forbidden — might still be a real service; full probe can mark partial/fail
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
      // HTML marketing page as only response is usually fail for agent cards
      if (ct.includes("text/html") && !ct.includes("json")) {
        // Peek body start if small
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
    // Network error — still try full probe once (could be transient)
    return {
      proceed: true,
      confidence: "low",
      reason: `preflight network: ${msg.slice(0, 80)}`,
      predict_fail: false,
      primary_url: url,
    };
  }
}
