/**
 * Growth Scout monthly/daily spend guard — hard $25/mo ceiling by default.
 * Tracks xAI token estimates + attributed Fluid wall time for scout cycles.
 */
import { loadDurableJson, saveDurableJson } from "@/lib/agents1/durable-json";

const DURABLE = "growth-scout.json";

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
      allowlist: s.allowlist || {},
      history: (s.history || []).slice(0, 40),
    };
  } else if (s.day !== d) {
    next = { ...s, day: d, day_invites: 0 };
  }
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

export function scoutBudgetPublic(s: ScoutBudgetState) {
  const budget = monthlyBudgetUsd();
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
  };
}
