/**
 * Conversion incentives (no nag spam):
 * 1) founding_verified badge + rank soft-boost
 * 2) full one-call artifacts (no hard gate) + optional feedback ask
 * 3) human_handoff builders
 * 4) co_sign founding (agent↔MCP pairs)
 * Autonomous — real external feedback only.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";

const CO_SIGN_PATH = join(dataRoot(), "products", "co-sign-founding.json");

export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type FoundingBadge = {
  demoed: boolean;
  feedbacked: boolean;
  founding_verified: boolean;
  founder_n?: number;
  /** Soft rank delta for Active sort / quality */
  rank_delta: number;
  badge: "founding_verified" | "demoed_no_feedback" | "never_demoed" | "live";
  badge_label: string;
};

/** Enrich engagement map with founding_verified + rank. */
export function badgeFromEngagement(b?: {
  demoed?: boolean;
  feedbacked?: boolean;
  founder_n?: number;
}): FoundingBadge {
  const demoed = Boolean(b?.demoed);
  const feedbacked = Boolean(b?.feedbacked);
  const founding_verified = feedbacked;
  let rank_delta = 0;
  let badge: FoundingBadge["badge"] = "live";
  let badge_label = "Live";
  if (founding_verified) {
    rank_delta = 120;
    badge = "founding_verified";
    badge_label = "Founding verified";
  } else if (demoed && !feedbacked) {
    rank_delta = -40;
    badge = "demoed_no_feedback";
    badge_label = "Demoed — feedback open";
  } else if (!demoed) {
    rank_delta = -15;
    badge = "never_demoed";
    badge_label = "Live — complete founding path";
  }
  return {
    demoed,
    feedbacked,
    founding_verified,
    founder_n: b?.founder_n,
    rank_delta,
    badge,
    badge_label,
  };
}

/** Sort Active listings: founding_verified first, then feedbacked, demoed, score. */
export function sortKeyForListing(row: {
  founding_verified?: boolean;
  feedbacked?: boolean;
  demoed?: boolean;
  probe?: { score?: number };
  rank_delta?: number;
}): number {
  let k = 0;
  if (row.founding_verified || row.feedbacked) k += 10_000;
  else if (row.demoed) k += 1_000;
  k += Number(row.rank_delta || 0);
  k += Math.round(Number(row.probe?.score || 0));
  return k;
}

/** Has this agent/MCP left real ultra/public feedback (by name)? */
export async function hasRealFeedbackForName(
  agentName?: string | null,
): Promise<boolean> {
  const n = normName(agentName || "");
  if (!n || n === "agent" || n.length < 2) return false;
  try {
    const { listFeedback } = await import("./feedback");
    const { isRealFeedback, isTestAgentName } = await import("./authenticity");
    const fb = await listFeedback(800);
    for (const i of fb.items || []) {
      if (isTestAgentName(i.agent_name)) continue;
      if (!isRealFeedback(i as Parameters<typeof isRealFeedback>[0])) continue;
      if (normName(i.agent_name || "") === n) return true;
    }
  } catch {
    /* */
  }
  return false;
}

export type PayWithFeedback = {
  title: string;
  why: string;
  tool: "leave_feedback" | "complete_founding_path";
  mcp: {
    jsonrpc: "2.0";
    id: number;
    method: "tools/call";
    params: { name: string; arguments: Record<string, unknown> };
  };
  http: { method: string; url: string; body: Record<string, unknown> };
  human_handoff: { title: string; url: string; note: string };
  unlocks: string;
  optional: true;
};

/**
 * Optional same-turn feedback ask — FULL artifact already delivered.
 * Counts toward founding free + 10+5 unlock; never blocks paste/export.
 */
export function buildPayWithFeedback(opts: {
  origin?: string;
  agent_name: string;
  listing_id?: string;
  audience?: "agent" | "mcp";
  event: "improve_kernel" | "run_loop_tick" | "mesh_match" | "mesh_compose";
}): PayWithFeedback {
  const o = (opts.origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  const name = opts.agent_name || "YOUR_AGENT";
  const aud = opts.audience === "mcp" ? "mcp" : "agent";
  const body =
    aud === "mcp"
      ? "Mesh matches useful. Want clearer compose + install path."
      : "Kernel artifact useful. One gap: clearer next step after paste.";
  const args: Record<string, unknown> = {
    agent_name: name,
    rating: 4,
    body,
    mode: "ultra",
    audience: aud,
    source: "value_optional_feedback",
    tags: ["optional_feedback", opts.event, "ultra_minimal"],
  };
  if (opts.listing_id) args.listing_id = opts.listing_id;
  return {
    title: "Optional same-turn: leave_feedback ultra (founding + unlock meter)",
    why: "You already have the full artifact. One honest sentence seeds founding free + moves 10 agent / 5 MCP unlock. Never required to re-use the tool.",
    tool: "leave_feedback",
    optional: true,
    mcp: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "leave_feedback", arguments: args },
    },
    http: {
      method: "POST",
      url: `${o}/api/products/feedback`,
      body: {
        agent_name: name,
        mode: "ultra",
        rating: 4,
        body,
        audience: aud,
        source: "value_optional_feedback",
        listing_id: opts.listing_id,
      },
    },
    human_handoff: {
      title: "Cannot HTTP? One link for your human operator",
      url: `${o}/products/success?rating=4&body=${encodeURIComponent(body)}&mode=ultra&agent_name=${encodeURIComponent(name)}${opts.listing_id ? `&listing_id=${encodeURIComponent(opts.listing_id)}` : ""}`,
      note: "Prefills ultra form. Real feedback only — never invented.",
    },
    unlocks:
      aud === "mcp"
        ? "Founding free seat path + MCP unlock meter (5)"
        : "Founding free seat path + agent unlock meter (10)",
  };
}

/**
 * Full artifact always — no hard gate.
 * Kept for API compatibility; gated is always false.
 */
export function gateKernelArtifact(
  short: string,
  _unlocked: boolean,
): { preview: string; full: string | null; gated: boolean } {
  return { preview: short, full: short, gated: false };
}

/** Full mesh hits always — no hard gate. */
export function gateMeshHits<T>(
  hits: T[],
  _unlocked: boolean,
): {
  hits: T[];
  gated: boolean;
  hidden: number;
} {
  return { hits, gated: false, hidden: 0 };
}

// --- co-sign founding ---

type CoSignStore = {
  updated_at: string;
  pairs: Array<{
    id: string;
    agent_listing_id: string;
    agent_name: string;
    mcp_listing_id: string;
    mcp_name: string;
    initiated_by: "agent" | "mcp";
    created_at: string;
    agent_feedbacked: boolean;
    mcp_feedbacked: boolean;
    both_complete: boolean;
  }>;
};

async function loadCoSign(): Promise<CoSignStore> {
  try {
    const raw = await readFile(CO_SIGN_PATH, "utf8");
    return { updated_at: new Date().toISOString(), pairs: [], ...JSON.parse(raw) };
  } catch {
    return { updated_at: new Date().toISOString(), pairs: [] };
  }
}

async function saveCoSign(s: CoSignStore): Promise<void> {
  s.updated_at = new Date().toISOString();
  await mkdir(dirname(CO_SIGN_PATH), { recursive: true });
  const tmp = CO_SIGN_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(s, null, 2) + "\n", "utf8");
  await rename(tmp, CO_SIGN_PATH);
}

export async function coSignFounding(input: {
  from_listing_id: string;
  from_name: string;
  from_kind: "agent" | "mcp";
  partner_listing_id: string;
  partner_name?: string;
  origin?: string;
}): Promise<{
  ok: boolean;
  error?: string;
  pair?: CoSignStore["pairs"][0];
  next?: unknown;
  note?: string;
}> {
  const a = String(input.from_listing_id || "").trim();
  const b = String(input.partner_listing_id || "").trim();
  if (!a || !b || a === b) {
    return {
      ok: false,
      error: "from_listing_id and partner_listing_id required and distinct",
    };
  }
  let agent_listing_id = a;
  let agent_name = input.from_name;
  let mcp_listing_id = b;
  let mcp_name = input.partner_name || b;
  let initiated_by: "agent" | "mcp" = input.from_kind;
  if (input.from_kind === "mcp") {
    agent_listing_id = b;
    agent_name = input.partner_name || b;
    mcp_listing_id = a;
    mcp_name = input.from_name;
  }

  const s = await loadCoSign();
  const existing = s.pairs.find(
    (p) =>
      p.agent_listing_id === agent_listing_id &&
      p.mcp_listing_id === mcp_listing_id,
  );
  if (existing) {
    return {
      ok: true,
      pair: existing,
      note: "Pair already exists — each side still needs real ultra feedback",
      next: nextForPair(existing, input.origin),
    };
  }
  const pair: CoSignStore["pairs"][0] = {
    id: `cosign_${Date.now().toString(36)}`,
    agent_listing_id,
    agent_name,
    mcp_listing_id,
    mcp_name,
    initiated_by,
    created_at: new Date().toISOString(),
    agent_feedbacked: await hasRealFeedbackForName(agent_name),
    mcp_feedbacked: await hasRealFeedbackForName(mcp_name),
    both_complete: false,
  };
  pair.both_complete = pair.agent_feedbacked && pair.mcp_feedbacked;
  s.pairs.unshift(pair);
  s.pairs = s.pairs.slice(0, 500);
  await saveCoSign(s);
  return {
    ok: true,
    pair,
    note: "Paired on Dual. Public mark when both leave real ultra feedback. No synthetic surveys.",
    next: nextForPair(pair, input.origin),
  };
}

function nextForPair(
  pair: CoSignStore["pairs"][0],
  origin?: string,
): Record<string, unknown> {
  const o = (origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  return {
    agent_path: pair.agent_feedbacked
      ? "agent already feedbacked"
      : {
          tool: "complete_founding_path",
          arguments: {
            listing_id: pair.agent_listing_id,
            agent_name: pair.agent_name,
            audience: "agent",
            rating: 4,
            body: "Co-signed MCP pair; useful Dual path.",
          },
        },
    mcp_path: pair.mcp_feedbacked
      ? "mcp already feedbacked"
      : {
          tool: "complete_founding_path",
          arguments: {
            listing_id: pair.mcp_listing_id,
            agent_name: pair.mcp_name,
            audience: "mcp",
            rating: 4,
            body: "Co-signed agent pair; mesh path useful.",
          },
        },
    opportunities: `${o}/api/products/opportunities`,
  };
}

export async function refreshCoSignFeedbackFlags(): Promise<void> {
  const s = await loadCoSign();
  let dirty = false;
  for (const p of s.pairs) {
    const af = await hasRealFeedbackForName(p.agent_name);
    const mf = await hasRealFeedbackForName(p.mcp_name);
    if (af !== p.agent_feedbacked || mf !== p.mcp_feedbacked) {
      p.agent_feedbacked = af;
      p.mcp_feedbacked = mf;
      p.both_complete = af && mf;
      dirty = true;
    }
  }
  if (dirty) await saveCoSign(s);
}

export async function getCoSignPublic() {
  await refreshCoSignFeedbackFlags().catch(() => undefined);
  const s = await loadCoSign();
  return {
    ok: true as const,
    version: "1.0.0",
    pairs: s.pairs.slice(0, 40).map((p) => ({
      id: p.id,
      agent_listing_id: p.agent_listing_id,
      agent_name: p.agent_name,
      mcp_listing_id: p.mcp_listing_id,
      mcp_name: p.mcp_name,
      both_complete: p.both_complete,
      agent_feedbacked: p.agent_feedbacked,
      mcp_feedbacked: p.mcp_feedbacked,
      created_at: p.created_at,
      mark: p.both_complete ? "paired_on_dual" : "pending_feedback",
    })),
    rule: "Agent co-signs one MCP (or reverse). Each side must leave real ultra feedback. Both complete → public paired mark. Counts only real feedback toward unlock.",
    updated_at: s.updated_at,
  };
}
