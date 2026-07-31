/**
 * Growth Scout monthly/daily spend guard — hard $25/mo ceiling by default.
 * Tracks xAI token estimates + attributed Fluid wall time for scout cycles.
 * Conversion funnel + per-listing outcomes for ranking feedback.
 */
import { loadDurableJson, saveDurableJson } from "@/lib/agents1/durable-json";

const DURABLE = "growth-scout.json";

export type ScoutOutcome = {
  last_invite_at: string;
  talk_ok: boolean;
  http_ok: boolean;
  name?: string;
  kind?: string;
  /** filled when reply-capture / demo later matches this listing */
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
  /** month-scoped invite delivers (resets on month roll) */
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
  /** listing_id → last invite ISO */
  invited: Record<string, string>;
  /** listing_id → last invite outcome (learning loop) */
  outcomes?: Record<string, ScoutOutcome>;
  conversion?: ScoutConversion;
  /** allowlist registry state */
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
        // lifetime-ish counters kept across months for dashboard continuity
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

export async function loadScoutBudget(): Promise<ScoutBudgetState> {
  try {
    const s = await loadDurableJson<ScoutBudgetState>(DURABLE, empty);
    return roll(s || empty());
  } catch {
    return empty();
  }
}

export async function saveScoutBudget(s: ScoutBudgetState): Promise<void> {
  const next = { ...roll(s), updated_at: new Date().toISOString() };
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

/** Estimate Fluid cost for a wall_ms scout tick (product-class ratios). */
export function estimateFluidUsd(wall_ms: number): number {
  const wall_h = Math.max(0, wall_ms) / 3_600_000;
  // Active CPU ~35% of wall for I/O-heavy scout; 2GB provisioned
  const active_cpu_h = wall_h * 0.35;
  const mem_gb_h = wall_h * 2;
  const cpu = active_cpu_h * 0.128;
  const mem = mem_gb_h * 0.0106;
  const inv = 0.6 / 1_000_000;
  return Number((cpu + mem + inv).toFixed(6));
}

/** grok-build-0.1: $1/M in, $2/M out */
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
      /** filled by getGrowthScoutStatus when reply-capture is available */
      demos: 0,
      feedback: 0,
      replies: 0,
    },
  };
}
