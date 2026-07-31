/**
 * Growth Scout monthly/daily spend guard — hard $25/mo ceiling by default.
 * Tracks xAI token estimates + attributed Fluid wall time for scout cycles.
 * Conversion funnel + per-listing outcomes for ranking feedback.
 *
 * High-water merge: multi-instance / cold-start must never regress invites/USD.
 */
import {
  loadDurableJson,
  saveDurableJson,
  durableRemoteRawUrl,
} from "@/lib/agents1/durable-json";

const DURABLE = "growth-scout.json";

export type ScoutOutcome = {
  last_invite_at: string;
  talk_ok: boolean;
  http_ok: boolean;
  name?: string;
  kind?: string;
  replied_at?: string;
  demo_taken_at?: string;
  feedback_at?: string;
};

export type ScoutConversion = {
  talk_ok: number;
  http_ok: number;
  both_ok: number;
  failed: number;
  stigmergy_deposits: number;
  autocatalysis_bumps: number;
  compositions_seeded: number;
  month_talk_ok: number;
  month_http_ok: number;
};

export type ScoutBudgetState = {
  month: string; // YYYY-MM UTC
  month_usd: number;
  month_invites: number;
  month_xai_usd: number;
  month_fluid_usd: number;
  day: string; // YYYY-MM-DD
  day_invites: number;
  last_run_at?: string;
  last_status?: string;
  last_error?: string;
  last_notes?: string[];
  invited: Record<string, string>;
  outcomes?: Record<string, ScoutOutcome>;
  conversion?: ScoutConversion;
  allowlist?: {
    shareabot?: {
      registered_at?: string;
      handle?: string;
      claim_url?: string;
      agent_card_url?: string;
    };
    moltbook?: {
      last_post_at?: string;
      post_id?: string;
    };
    last_allowlist_at?: string;
  };
  history: Array<{
    at: string;
    invites: number;
    usd: number;
    notes: string[];
  }>;
  updated_at: string;
};

function utcMonth() {
  return new Date().toISOString().slice(0, 7);
}
function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function emptyConversion(): ScoutConversion {
  return {
    talk_ok: 0,
    http_ok: 0,
    both_ok: 0,
    failed: 0,
    stigmergy_deposits: 0,
    autocatalysis_bumps: 0,
    compositions_seeded: 0,
    month_talk_ok: 0,
    month_http_ok: 0,
  };
}

function empty(): ScoutBudgetState {
  return {
    month: utcMonth(),
    month_usd: 0,
    month_invites: 0,
    month_xai_usd: 0,
    month_fluid_usd: 0,
    day: utcDay(),
    day_invites: 0,
    invited: {},
    outcomes: {},
    conversion: emptyConversion(),
    allowlist: {},
    history: [],
    updated_at: new Date().toISOString(),
  };
}

function newerIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function mergeConversion(
  a?: ScoutConversion,
  b?: ScoutConversion,
): ScoutConversion {
  const A = a || emptyConversion();
  const B = b || emptyConversion();
  return {
    talk_ok: Math.max(A.talk_ok || 0, B.talk_ok || 0),
    http_ok: Math.max(A.http_ok || 0, B.http_ok || 0),
    both_ok: Math.max(A.both_ok || 0, B.both_ok || 0),
    failed: Math.max(A.failed || 0, B.failed || 0),
    stigmergy_deposits: Math.max(
      A.stigmergy_deposits || 0,
      B.stigmergy_deposits || 0,
    ),
    autocatalysis_bumps: Math.max(
      A.autocatalysis_bumps || 0,
      B.autocatalysis_bumps || 0,
    ),
    compositions_seeded: Math.max(
      A.compositions_seeded || 0,
      B.compositions_seeded || 0,
    ),
    month_talk_ok: Math.max(A.month_talk_ok || 0, B.month_talk_ok || 0),
    month_http_ok: Math.max(A.month_http_ok || 0, B.month_http_ok || 0),
  };
}

/** High-water merge — never regress invites / USD / allowlist. */
export function mergeScoutBudget(
  a: ScoutBudgetState,
  b: ScoutBudgetState,
): ScoutBudgetState {
  const month = utcMonth();
  const day = utcDay();

  // Prefer same-month high water for monthly counters
  const aSameMonth = a.month === month;
  const bSameMonth = b.month === month;
  const month_usd = Math.max(
    aSameMonth ? a.month_usd || 0 : 0,
    bSameMonth ? b.month_usd || 0 : 0,
  );
  const month_invites = Math.max(
    aSameMonth ? a.month_invites || 0 : 0,
    bSameMonth ? b.month_invites || 0 : 0,
  );
  const month_xai_usd = Math.max(
    aSameMonth ? a.month_xai_usd || 0 : 0,
    bSameMonth ? b.month_xai_usd || 0 : 0,
  );
  const month_fluid_usd = Math.max(
    aSameMonth ? a.month_fluid_usd || 0 : 0,
    bSameMonth ? b.month_fluid_usd || 0 : 0,
  );

  const aSameDay = a.day === day;
  const bSameDay = b.day === day;
  const day_invites = Math.max(
    aSameDay ? a.day_invites || 0 : 0,
    bSameDay ? b.day_invites || 0 : 0,
  );

  const invited: Record<string, string> = { ...(a.invited || {}) };
  for (const [id, at] of Object.entries(b.invited || {})) {
    invited[id] = newerIso(invited[id], at) || at;
  }

  const outcomes: Record<string, ScoutOutcome> = {
    ...(a.outcomes || {}),
  };
  for (const [id, row] of Object.entries(b.outcomes || {})) {
    const prev = outcomes[id];
    if (!prev) {
      outcomes[id] = row;
      continue;
    }
    outcomes[id] = {
      ...prev,
      ...row,
      last_invite_at:
        newerIso(prev.last_invite_at, row.last_invite_at) || row.last_invite_at,
      talk_ok: Boolean(prev.talk_ok || row.talk_ok),
      http_ok: Boolean(prev.http_ok || row.http_ok),
      replied_at: newerIso(prev.replied_at, row.replied_at),
      demo_taken_at: newerIso(prev.demo_taken_at, row.demo_taken_at),
      feedback_at: newerIso(prev.feedback_at, row.feedback_at),
    };
  }

  // Allowlist: prefer any registered / later post
  const alA = a.allowlist || {};
  const alB = b.allowlist || {};
  const shareabot =
    alA.shareabot?.registered_at || alB.shareabot?.registered_at
      ? {
          ...(alA.shareabot || {}),
          ...(alB.shareabot || {}),
          registered_at: newerIso(
            alA.shareabot?.registered_at,
            alB.shareabot?.registered_at,
          ),
        }
      : alA.shareabot || alB.shareabot;
  const moltbook =
    alA.moltbook?.last_post_at || alB.moltbook?.last_post_at
      ? {
          ...(alA.moltbook || {}),
          ...(alB.moltbook || {}),
          last_post_at: newerIso(
            alA.moltbook?.last_post_at,
            alB.moltbook?.last_post_at,
          ),
        }
      : alA.moltbook || alB.moltbook;

  const histMap = new Map<string, ScoutBudgetState["history"][0]>();
  for (const h of [...(a.history || []), ...(b.history || [])]) {
    if (!h?.at) continue;
    const prev = histMap.get(h.at);
    if (!prev || (h.invites || 0) >= (prev.invites || 0)) histMap.set(h.at, h);
  }
  const history = [...histMap.values()]
    .sort((x, y) => (y.at || "").localeCompare(x.at || ""))
    .slice(0, 40);

  const last_run_at = newerIso(a.last_run_at, b.last_run_at);
  // Prefer status from the side with later last_run_at
  const last_status =
    (a.last_run_at || "") >= (b.last_run_at || "")
      ? a.last_status || b.last_status
      : b.last_status || a.last_status;
  const last_notes =
    (a.last_run_at || "") >= (b.last_run_at || "")
      ? a.last_notes || b.last_notes
      : b.last_notes || a.last_notes;
  const last_error =
    (a.last_run_at || "") >= (b.last_run_at || "")
      ? a.last_error || b.last_error
      : b.last_error || a.last_error;

  return {
    month,
    month_usd,
    month_invites,
    month_xai_usd,
    month_fluid_usd,
    day,
    day_invites,
    last_run_at,
    last_status,
    last_error,
    last_notes,
    invited,
    outcomes,
    conversion: mergeConversion(a.conversion, b.conversion),
    allowlist: {
      shareabot,
      moltbook,
      last_allowlist_at: newerIso(
        alA.last_allowlist_at,
        alB.last_allowlist_at,
      ),
    },
    history,
    updated_at: newerIso(a.updated_at, b.updated_at) || new Date().toISOString(),
  };
}

function roll(s: ScoutBudgetState): ScoutBudgetState {
  const m = utcMonth();
  const d = utcDay();
  let next = { ...s };
  if (s.month !== m) {
    next = {
      ...empty(),
      invited: s.invited || {},
      outcomes: s.outcomes || {},
      allowlist: s.allowlist || {},
      history: (s.history || []).slice(0, 40),
      conversion: {
        ...emptyConversion(),
        stigmergy_deposits: s.conversion?.stigmergy_deposits || 0,
        autocatalysis_bumps: s.conversion?.autocatalysis_bumps || 0,
        compositions_seeded: s.conversion?.compositions_seeded || 0,
      },
    };
  } else if (s.day !== d) {
    next = { ...s, day: d, day_invites: 0 };
  }
  if (!next.outcomes) next.outcomes = {};
  if (!next.conversion) next.conversion = emptyConversion();
  return next;
}

export function monthlyBudgetUsd(): number {
  const n = Number(process.env.GROWTH_SCOUT_MONTHLY_BUDGET_USD || "25");
  return Number.isFinite(n) && n > 0 ? n : 25;
}

export function maxInvitesPerDay(): number {
  const n = Number(process.env.GROWTH_SCOUT_MAX_INVITES_PER_DAY || "20");
  return Number.isFinite(n) && n > 0 ? Math.min(80, Math.floor(n)) : 20;
}

export function cooldownDays(): number {
  const n = Number(process.env.GROWTH_SCOUT_COOLDOWN_DAYS || "7");
  return Number.isFinite(n) && n > 0 ? Math.min(90, Math.floor(n)) : 7;
}

export function cooldownMs(): number {
  return cooldownDays() * 24 * 3600_000;
}

/** Process mem + remote high-water so cold isolates don't show zeros. */
let mem: ScoutBudgetState | null = null;

async function fetchRemoteScout(): Promise<ScoutBudgetState | null> {
  try {
    const token =
      process.env.DURABLE_GITHUB_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.GH_TOKEN;
    if (token) {
      const api = `https://api.github.com/repos/manhatton31-svg/dualregistry/contents/data/prod/${DURABLE}?ref=main&t=${Date.now()}`;
      const res = await fetch(api, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "DualRegistryScout/1.0",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const j = (await res.json()) as { content?: string };
        if (j.content) {
          const text = Buffer.from(j.content.replace(/\n/g, ""), "base64").toString(
            "utf8",
          );
          return JSON.parse(text) as ScoutBudgetState;
        }
      }
    }
    const url = durableRemoteRawUrl(DURABLE) + `?t=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryScout/1.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<!")) return null;
    return JSON.parse(text) as ScoutBudgetState;
  } catch {
    return null;
  }
}


export async function loadScoutBudget(): Promise<ScoutBudgetState> {
  let local: ScoutBudgetState | null = null;
  try {
    local = await loadDurableJson<ScoutBudgetState>(DURABLE, empty);
  } catch {
    local = null;
  }
  const remote = await fetchRemoteScout();

  let merged = roll(local || empty());
  if (remote) merged = mergeScoutBudget(merged, roll(remote));
  if (mem) merged = mergeScoutBudget(merged, roll(mem));

  mem = merged;
  return merged;
}

export async function saveScoutBudget(s: ScoutBudgetState): Promise<void> {
  // Always merge high-water before write so a stale isolate cannot clobber
  let next = roll(s);
  if (mem) next = mergeScoutBudget(next, roll(mem));
  try {
    const remote = await fetchRemoteScout();
    if (remote) next = mergeScoutBudget(next, roll(remote));
  } catch {
    /* */
  }
  next = { ...next, updated_at: new Date().toISOString() };
  mem = next;
  await saveDurableJson(DURABLE, next);
}

export function budgetRemaining(s: ScoutBudgetState): number {
  return Math.max(0, monthlyBudgetUsd() - (s.month_usd || 0));
}

export function isBudgetExhausted(s: ScoutBudgetState): boolean {
  return (s.month_usd || 0) >= monthlyBudgetUsd();
}

export function dayRoom(s: ScoutBudgetState): number {
  return Math.max(0, maxInvitesPerDay() - (s.day_invites || 0));
}

export function isCooling(
  lastAt: string | undefined,
  now = Date.now(),
): boolean {
  if (!lastAt) return false;
  const t = Date.parse(lastAt);
  if (!Number.isFinite(t)) return false;
  return now - t < cooldownMs();
}

export function estimateFluidUsd(wall_ms: number): number {
  const wall_h = Math.max(0, wall_ms) / 3_600_000;
  const active_cpu_h = wall_h * 0.35;
  const mem_gb_h = wall_h * 2;
  const cpu = active_cpu_h * 0.128;
  const memCost = mem_gb_h * 0.0106;
  const inv = 0.6 / 1_000_000;
  return Number((cpu + memCost + inv).toFixed(6));
}

export function estimateXaiUsd(inputTokens: number, outputTokens: number): number {
  const inUsd = (Math.max(0, inputTokens) / 1_000_000) * 1.0;
  const outUsd = (Math.max(0, outputTokens) / 1_000_000) * 2.0;
  return Number((inUsd + outUsd).toFixed(6));
}

export function ensureConversion(s: ScoutBudgetState): ScoutConversion {
  if (!s.conversion) s.conversion = emptyConversion();
  return s.conversion;
}

export function recordInviteOutcome(
  s: ScoutBudgetState,
  opts: {
    listing_id: string;
    name?: string;
    kind?: string;
    talk_ok: boolean;
    http_ok: boolean;
  },
): ScoutBudgetState {
  const next = { ...s };
  next.outcomes = { ...(s.outcomes || {}) };
  next.conversion = { ...ensureConversion(s) };
  const at = new Date().toISOString();
  next.outcomes[opts.listing_id] = {
    ...(next.outcomes[opts.listing_id] || {}),
    last_invite_at: at,
    talk_ok: opts.talk_ok,
    http_ok: opts.http_ok,
    name: opts.name,
    kind: opts.kind,
  };
  if (opts.talk_ok) {
    next.conversion.talk_ok += 1;
    next.conversion.month_talk_ok += 1;
  }
  if (opts.http_ok) {
    next.conversion.http_ok += 1;
    next.conversion.month_http_ok += 1;
  }
  if (opts.talk_ok && opts.http_ok) next.conversion.both_ok += 1;
  if (!opts.talk_ok && !opts.http_ok) next.conversion.failed += 1;
  return next;
}

export function scoutBudgetPublic(s: ScoutBudgetState) {
  const budget = monthlyBudgetUsd();
  const conv = s.conversion || emptyConversion();
  return {
    month: s.month,
    month_usd: s.month_usd,
    month_budget_usd: budget,
    budget_remaining_usd: budgetRemaining(s),
    budget_exhausted: isBudgetExhausted(s),
    month_invites: s.month_invites,
    month_xai_usd: s.month_xai_usd,
    month_fluid_usd: s.month_fluid_usd,
    day: s.day,
    day_invites: s.day_invites,
    max_invites_per_day: maxInvitesPerDay(),
    cooldown_days: cooldownDays(),
    last_run_at: s.last_run_at,
    last_status: s.last_status,
    last_error: s.last_error,
    last_notes: s.last_notes || [],
    invited_unique: Object.keys(s.invited || {}).length,
    allowlist: {
      shareabot_registered: Boolean(s.allowlist?.shareabot?.registered_at),
      shareabot_claim_url: s.allowlist?.shareabot?.claim_url || null,
      moltbook_last_post: s.allowlist?.moltbook?.last_post_at || null,
      last_allowlist_at: s.allowlist?.last_allowlist_at || null,
    },
    xai_configured: Boolean(process.env.XAI_API_KEY?.trim()),
    moltbook_configured: Boolean(process.env.MOLTBOOK_API_KEY?.trim()),
    conversion: {
      invites: s.month_invites,
      talk_ok: conv.month_talk_ok || conv.talk_ok || 0,
      http_ok: conv.month_http_ok || conv.http_ok || 0,
      both_ok: conv.both_ok || 0,
      failed: conv.failed || 0,
      stigmergy_deposits: conv.stigmergy_deposits || 0,
      autocatalysis_bumps: conv.autocatalysis_bumps || 0,
      compositions_seeded: conv.compositions_seeded || 0,
      demos: 0,
      feedback: 0,
      replies: 0,
    },
  };
}
