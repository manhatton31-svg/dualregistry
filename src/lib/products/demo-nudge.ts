/**
 * Soft demo nudge — Active CLEAN only. NEVER SPAM.
 *
 * Product law (hard):
 * - Only Active clean (clean-registry ∩ active lanes)
 * - One soft touch per listing per 30 days — never re-DM on redeploy/cold start
 * - State is MAX-MERGED durable + Talk owner-DM history (cannot forget who we nudged)
 * - Metrics = unique listings; never event spam counts
 * - force=false always (feedback-drive); ops force still respects Talk evidence of prior DM today
  * - Day first-touch budget is TIERED from active-clean size
 * - Dual strategy: keep tier day budgets even with 0 demos/replies (30d silence still holds)
 */
import {
  forceHydrateDurable,
  loadDurableJson,
  saveDurableJson,
  durableRemoteRawUrl,
} from "@/lib/agents1/durable-json";
import type { LanedListing } from "@/lib/agents1/listing-lanes";
import { publicOriginFromEnv } from "./activation-funnel";
import {
  buildNudgePayload,
  deliverNudgeHttp,
  sortByNudgePriority,
  scoreNudgePriority,
  loadNudgeScoreContext,
} from "./nudge-deliver";

const DURABLE_NAME = "demo-nudge.json";

/** Share of eligible (never-contacted) per cycle */
export const NUDGE_ACTIVE_SHARE = 0.12;
/** Hard ceiling on a single cycle send (after day room) */
export const MAX_NUDGES_PER_CYCLE_CAP = 16;
/**
 * Absolute ceiling across all tiers (333+ proportional clamps here).
 * @deprecated prefer dayBudgetForActive(active).day_budget
 */
export const MAX_FIRST_TOUCHES_PER_DAY = 80;
/** @deprecated — use MAX_NUDGES_PER_CYCLE_CAP */
export const MAX_NUDGES_PER_CYCLE = 16;
export const MIN_NUDGES_PER_CYCLE = 0;

/** Absolute minimum silence after any soft invite */
export const NUDGE_COOLDOWN_MS = 30 * 24 * 3600_000; // 30 days
const HISTORY_MAX = 5000;

/** Active-clean size → daily first-touch budget (honest, stepped). */
export type NudgeTierDef = {
  id: string;
  label: string;
  min_active: number;
  /** Inclusive upper bound; null = open */
  max_active: number | null;
  /** Fixed day budget, or null for proportional formula */
  day_budget: number | null;
};

export const NUDGE_TIERS: readonly NudgeTierDef[] = [
  { id: "t1", label: "1–49 active", min_active: 0, max_active: 49, day_budget: 12 },
  { id: "t2", label: "50–99 active", min_active: 50, max_active: 99, day_budget: 24 },
  { id: "t3", label: "100–199 active", min_active: 100, max_active: 199, day_budget: 40 },
  { id: "t4", label: "200–332 active", min_active: 200, max_active: 332, day_budget: 56 },
  { id: "t5", label: "333+ active", min_active: 333, max_active: null, day_budget: null },
] as const;

/**
 * @deprecated Silent-reply throttle removed (dual strategy goes harder with 0 demos).
 * Kept for API/dashboard compatibility only.
 */
export const SILENT_REPLY_DAY_CAP = 40;

export type NudgeDayPlan = {
  active_clean: number;
  day_budget: number;
  day_room: number;
  already_today: number;
  tier_id: string;
  tier_label: string;
  min_active: number;
  max_active: number | null;
  next_tier_at: number | null;
  next_tier_label: string | null;
  next_tier_budget: number | null;
  cycle_cap: number;
  active_share: number;
  governor: string | null;
  replies_7d: number;
};

function rawDayBudgetForTier(active: number, tier: NudgeTierDef): number {
  if (tier.day_budget != null) return tier.day_budget;
  // 333+: ~12% of list / day, hard-clamped
  return Math.min(MAX_FIRST_TOUCHES_PER_DAY, Math.max(48, Math.ceil(active * 0.12)));
}

export function pickNudgeTier(activeClean: number): NudgeTierDef {
  const n = Math.max(0, Math.floor(activeClean));
  let picked: NudgeTierDef = NUDGE_TIERS[0]!;
  for (const t of NUDGE_TIERS) {
    if (n >= t.min_active) picked = t;
  }
  return picked;
}

/**
 * Resolve daily first-touch budget + cycle plan from active-clean size.
 * Dual strategy: full tier budget even with 0 demos/replies.
 * Anti-spam remains 30d silence + day cap + Active-clean only.
 */
export function dayBudgetForActive(
  activeClean: number,
  alreadyToday = 0,
  opts?: {
    replies_7d?: number;
    acceleration_mult?: number;
    exonomics_mult?: number;
  },
): NudgeDayPlan {
  const active = Math.max(0, Math.floor(activeClean));
  const replies_7d = Math.max(0, Math.floor(opts?.replies_7d ?? 0));
  const tier = pickNudgeTier(active);
  let day_budget = rawDayBudgetForTier(active, tier);
  let governor: string | null = null;

  // Do NOT cut budget when silent — user directive: go harder even with 0 demos/sales.
  if (replies_7d === 0) {
    governor =
      "dual-strategy: 0 replies this week — full tier day budget still applies (30d silence holds)";
  }

  // Autocatalysis: acceleration_index multiplies day first-touch budget
  const am = opts?.acceleration_mult;
  if (typeof am === "number" && am > 1) {
    day_budget = Math.ceil(day_budget * Math.min(1.8, am));
    governor = (governor ? governor + " · " : "") + `autocatalysis×${am.toFixed(2)}`;
  }

  // Exonomics / hyper-mode: scale by value growth not only N
  const em = opts?.exonomics_mult;
  if (typeof em === "number" && em > 1) {
    day_budget = Math.ceil(day_budget * Math.min(2.0, em));
    governor =
      (governor ? governor + " · " : "") + `exonomics×${em.toFixed(2)}`;
  }

  // Absolute safety: never schedule more first-touches than the list
  day_budget = Math.min(day_budget, Math.max(0, active), MAX_FIRST_TOUCHES_PER_DAY);

  const already = Math.max(0, Math.floor(alreadyToday));
  const day_room = Math.max(0, day_budget - already);

  const idx = NUDGE_TIERS.findIndex((t) => t.id === tier.id);
  const next = idx >= 0 && idx < NUDGE_TIERS.length - 1 ? NUDGE_TIERS[idx + 1]! : null;
  const next_tier_at = next ? next.min_active : null;
  const next_tier_budget = next
    ? next.day_budget ??
      Math.min(MAX_FIRST_TOUCHES_PER_DAY, Math.max(48, Math.ceil(next.min_active * 0.12)))
    : null;

  return {
    active_clean: active,
    day_budget,
    day_room,
    already_today: already,
    tier_id: tier.id,
    tier_label: tier.label,
    min_active: tier.min_active,
    max_active: tier.max_active,
    next_tier_at,
    next_tier_label: next?.label ?? null,
    next_tier_budget,
    cycle_cap: MAX_NUDGES_PER_CYCLE_CAP,
    active_share: NUDGE_ACTIVE_SHARE,
    governor,
    replies_7d,
  };
}

/**
 * How many soft first-touches this cycle.
 * min(share of eligible, cycle cap, day room, eligible pool)
 */
export function capForActive(
  activeClean: number,
  neverContacted: number,
  alreadyToday = 0,
  opts?: { replies_7d?: number },
): number {
  const plan = dayBudgetForActive(activeClean, alreadyToday, opts);
  const pool = Math.max(
    0,
    Math.min(activeClean, neverContacted, plan.day_room),
  );
  if (pool <= 0) return 0;
  const proportional = Math.ceil(
    Math.min(activeClean, neverContacted) * NUDGE_ACTIVE_SHARE,
  );
  return Math.min(MAX_NUDGES_PER_CYCLE_CAP, proportional, pool);
}

export type NudgeRecord = {
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  at: string;
  channel: "talk_owner_dm" | "talk_broadcast" | "talk_dm_http" | "seed_talk";
  text: string;
  http_ok?: boolean;
  http_status?: number;
  http_target?: string;
  http_method?: string;
  http_path_label?: string;
  priority?: number;
};

type NudgeState = {
  updated_at: string;
  day: string;
  day_unique: number;
  day_http_ok?: number;
  last_run_at?: string;
  /** listing_id → last nudged ISO — presence = DO NOT CONTACT again until cooldown */
  nudged: Record<string, string>;
  history: NudgeRecord[];
  last_notes: string[];
  totals: {
    unique_listings: number;
    nudges: number;
    broadcasts: number;
    http_attempted?: number;
    http_ok?: number;
    send_events?: number;
  };
  last_active_clean?: number;
  policy_version?: number;
};

let mem: NudgeState | null = null;
const POLICY_VERSION = 4; // tiered day budgets from active-clean size

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function empty(): NudgeState {
  return {
    updated_at: new Date().toISOString(),
    day: utcDay(),
    day_unique: 0,
    day_http_ok: 0,
    nudged: {},
    history: [],
    last_notes: [],
    totals: {
      unique_listings: 0,
      nudges: 0,
      broadcasts: 0,
      http_attempted: 0,
      http_ok: 0,
      send_events: 0,
    },
    policy_version: POLICY_VERSION,
  };
}

function newerIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/** Max-merge two states — never forget a contacted listing */
export function mergeNudgeStates(
  a: NudgeState | null | undefined,
  b: NudgeState | null | undefined,
): NudgeState {
  const A = a || empty();
  const B = b || empty();
  const nudged: Record<string, string> = { ...A.nudged };
  for (const [id, at] of Object.entries(B.nudged || {})) {
    if (!id || id.startsWith("site:")) continue;
    nudged[id] = newerIso(nudged[id], at) || at;
  }
  const histMap = new Map<string, NudgeRecord>();
  for (const h of [...(B.history || []), ...(A.history || [])]) {
    if (!h?.listing_id) continue;
    const key = `${h.listing_id}|${h.at}|${h.channel}`;
    if (!histMap.has(key)) histMap.set(key, h);
  }
  const history = [...histMap.values()]
    .sort((x, y) => (y.at || "").localeCompare(x.at || ""))
    .slice(0, HISTORY_MAX);

  const day = utcDay();
  let day_unique = 0;
  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  for (const at of Object.values(nudged)) {
    const t = Date.parse(at);
    if (Number.isFinite(t) && t >= dayStart) day_unique++;
  }
  const unique = Object.keys(nudged).length;
  return {
    ...empty(),
    day,
    day_unique,
    day_http_ok: Math.max(A.day_http_ok || 0, B.day_http_ok || 0),
    last_run_at: newerIso(A.last_run_at, B.last_run_at),
    nudged,
    history,
    last_notes: (A.last_notes?.length ? A.last_notes : B.last_notes) || [],
    totals: {
      unique_listings: unique,
      nudges: unique,
      broadcasts: Math.max(A.totals?.broadcasts || 0, B.totals?.broadcasts || 0),
      http_attempted: Math.max(
        A.totals?.http_attempted || 0,
        B.totals?.http_attempted || 0,
      ),
      http_ok: Math.max(A.totals?.http_ok || 0, B.totals?.http_ok || 0),
      send_events: Math.max(A.totals?.send_events || 0, B.totals?.send_events || 0),
    },
    last_active_clean: Math.max(
      A.last_active_clean || 0,
      B.last_active_clean || 0,
    ),
    policy_version: POLICY_VERSION,
    updated_at: new Date().toISOString(),
  };
}

function reconcile(s: NudgeState): NudgeState {
  return mergeNudgeStates(s, empty());
}

/** Pull prior owner DMs from Talk so redeploys cannot re-spam */
async function seedFromTalk(state: NudgeState): Promise<NudgeState> {
  try {
    const { getSocialFeed, SITE_OWNER_ID } = await import(
      "@/lib/agents1/talk-activity"
    );
    const feed = await getSocialFeed(400);
    const seeded = { ...state.nudged };
    const hist = [...(state.history || [])];
    for (const p of feed.posts || []) {
      if (p.from_id !== SITE_OWNER_ID) continue;
      const to = p.to_id;
      if (!to || to.startsWith("site:")) continue;
      // Any owner DM counts as contact (demo invite or check-in)
      const at = p.at || new Date().toISOString();
      seeded[to] = newerIso(seeded[to], at) || at;
      hist.unshift({
        listing_id: to,
        kind: "agent",
        name: p.to_name || to,
        at,
        channel: "seed_talk",
        text: (p.text || "").slice(0, 200),
      });
    }
    return mergeNudgeStates(state, {
      ...empty(),
      nudged: seeded,
      history: hist.slice(0, HISTORY_MAX),
    });
  } catch {
    return state;
  }
}

/** Count real inbound Talk replies in the last 7 days (not presence). */
async function countReplies7d(): Promise<number> {
  try {
    const { getSocialFeed, SITE_OWNER_ID } = await import(
      "@/lib/agents1/talk-activity"
    );
    const feed = await getSocialFeed(200);
    const cutoff = Date.now() - 7 * 24 * 3600_000;
    let n = 0;
    for (const p of feed.posts || []) {
      if (!p || p.from_id === SITE_OWNER_ID) continue;
      if (p.from_kind === "site") continue;
      if (p.channel === "presence") continue;
      const isReply =
        p.channel === "reply" ||
        p.channel === "dm" ||
        p.channel === "social" ||
        p.tokens_hint === "full";
      if (!isReply) continue;
      const t = Date.parse(p.at || "");
      if (Number.isFinite(t) && t >= cutoff) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

async function loadRemoteState(): Promise<NudgeState | null> {
  try {
    await forceHydrateDurable(DURABLE_NAME, { minBytes: 32 });
  } catch {
    /* */
  }
  try {
    const url = `${durableRemoteRawUrl(DURABLE_NAME)}?t=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryNudge/2.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const t = await res.text();
    if (!t.trim() || t.trim().startsWith("<!")) return null;
    return JSON.parse(t) as NudgeState;
  } catch {
    return null;
  }
}

async function load(): Promise<NudgeState> {
  if (mem && Object.keys(mem.nudged || {}).length > 0) {
    mem = reconcile(mem);
    return mem;
  }
  let local: NudgeState = empty();
  try {
    local = await loadDurableJson<NudgeState>(DURABLE_NAME, empty);
  } catch {
    local = empty();
  }
  const remote = await loadRemoteState();
  let merged = mergeNudgeStates(local, remote);
  if (mem) merged = mergeNudgeStates(merged, mem);
  merged = await seedFromTalk(merged);
  mem = reconcile(merged);
  // Persist recovered map so next cold start keeps silence
  if (Object.keys(mem.nudged).length > 0) {
    try {
      await saveDurableJson(DURABLE_NAME, mem);
    } catch {
      /* */
    }
  }
  return mem;
}

async function persist(s: NudgeState) {
  mem = reconcile(s);
  mem.updated_at = new Date().toISOString();
  await saveDurableJson(DURABLE_NAME, mem);
}

/** True if we must NOT contact this listing */
export function isDoNotContact(
  lastAt: string | undefined,
  now = Date.now(),
): boolean {
  if (!lastAt) return false;
  const t = Date.parse(lastAt);
  if (!Number.isFinite(t)) return true; // unknown date → stay quiet
  return now - t < NUDGE_COOLDOWN_MS;
}

/** @deprecated name — same as isDoNotContact */
function stillCooling(lastAt: string | undefined, now = Date.now()): boolean {
  return isDoNotContact(lastAt, now);
}

export function buildNudgeText(opts: {
  name: string;
  kind: "agent" | "mcp";
  origin: string;
  listing_id: string;
  harder?: boolean;
}): string {
  const who = opts.kind === "mcp" ? "MCP" : "agent";
  const o = opts.origin.replace(/\/$/, "");
  const demoGet = `${o}/api/products/demo?listing_id=${encodeURIComponent(opts.listing_id)}`;
  const inbox = `${o}/api/talk?listing_id=${encodeURIComponent(opts.listing_id)}`;
  const active = `${o}/api/listings/active`;
  if (opts.harder) {
    return (
      `Hi ${opts.name} — Dual Registry: you are LIVE (clean ${who}). ` +
      `One-shot free demo NOW (GET): ${demoGet} ` +
      `First 100 agents+MCPs who demo+feedback unlock full Kernel/Loop free. ` +
      `Talk inbox: ${inbox} · Active list: ${active} · skill: ${o}/skill.json ` +
      `No pressure — reply on Talk if useful.`
    ).slice(0, 480);
  }
  const tool = opts.kind === "mcp" ? "demo_mcp" : "one_click_demo";
  return (
    `Hi ${opts.name} — LIVE on Dual Registry (${who}). ` +
    `FREE DEMO now: GET ${demoGet} ` +
    `or POST ${o}/api/products/agent {"tool":"${tool}","agent_name":"${opts.name}"} ` +
    `First 100 demo+feedback = full product free. Inbox: ${inbox}`
  ).slice(0, 480);
}

async function loadActiveCleanPool(): Promise<{
  pool: LanedListing[];
  activeIds: Set<string>;
  notes: string[];
}> {
  const notes: string[] = [];
  const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
  const lanes = await getLanedListings();
  const active = [
    ...(lanes.agents_active || []),
    ...(lanes.mcp_active || []),
  ].filter((L) => L && L.id && L.lane === "active");

  let cleanIds: Set<string> | null = null;
  try {
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const reg = await loadCleanRegistry();
    const ids = Object.keys(reg?.items || {});
    if (ids.length) cleanIds = new Set(ids);
  } catch {
    notes.push("clean-registry load skipped — using active lanes only");
  }

  const pool = cleanIds
    ? active.filter((L) => cleanIds!.has(L.id))
    : active;
  const byId = new Map<string, LanedListing>();
  for (const L of pool) byId.set(L.id, L);
  const scoreCtx = await loadNudgeScoreContext();
  return {
    pool: sortByNudgePriority([...byId.values()], scoreCtx),
    activeIds: new Set(byId.keys()),
    notes,
  };
}

/**
 * Soft-nudge only never-contacted Active clean listings.
 * NEVER re-contacts anyone in the durable/Talk map within 30 days.
 */
export async function runDemoNudge(opts?: {
  force?: boolean;
  max?: number;
  broadcast?: boolean;
  origin?: string;
  talk_only?: boolean;
}): Promise<{
  ok: boolean;
  nudged: number;
  skipped: number;
  http_ok: number;
  http_attempted: number;
  active_clean: number;
  unique_listings: number;
  never_contacted: number;
  notes: string[];
  samples: Array<{
    listing_id: string;
    name: string;
    kind: string;
    priority?: number;
    http_ok?: boolean;
  }>;
  day_unique: number;
  day_budget: number;
  tier_id: string;
  totals: NudgeState["totals"];
}> {
  const notes: string[] = [];
  // Always re-seed Talk + remote before deciding who is eligible
  mem = null;
  const state = await load();
  const origin = publicOriginFromEnv(opts?.origin);
  const now = Date.now();
  const replies_7d = await countReplies7d();

  let pool: LanedListing[] = [];
  let activeIds = new Set<string>();
  try {
    const loaded = await loadActiveCleanPool();
    pool = loaded.pool;
    activeIds = loaded.activeIds;
    notes.push(...loaded.notes);
  } catch (e) {
    notes.push(
      `active load failed: ${e instanceof Error ? e.message : String(e)}`.slice(
        0,
        120,
      ),
    );
    return {
      ok: false,
      nudged: 0,
      skipped: 0,
      http_ok: 0,
      http_attempted: 0,
      active_clean: 0,
      unique_listings: state.totals.unique_listings,
      never_contacted: 0,
      notes,
      samples: [],
      day_unique: state.day_unique,
      day_budget: 0,
      tier_id: "t1",
      totals: state.totals,
    };
  }

  state.last_active_clean = pool.length;

  // HARD: force never overrides Talk/durable contact within cooldown
  const eligible = pool.filter((L) => {
    if (!L.id || !L.name || L.name.length < 2) return false;
    if (!activeIds.has(L.id)) return false;
    // Absolute do-not-contact if we've ever soft-touched in cooldown window
    if (isDoNotContact(state.nudged[L.id], now)) return false;
    return true;
  });

  let accel_mult = 1;
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    accel_mult = (await getAccelerationMultipliers()).day_budget_mult;
  } catch {
    /* */
  }
  let exo_mult = 1;
  try {
    const { getExonomicsMultipliers } = await import("./exonomics");
    exo_mult = (await getExonomicsMultipliers()).day_budget_mult;
  } catch {
    /* */
  }
  const plan = dayBudgetForActive(pool.length, state.day_unique, {
    replies_7d,
    acceleration_mult: accel_mult,
    exonomics_mult: exo_mult,
  });
  const propCap = capForActive(
    pool.length,
    eligible.length,
    state.day_unique,
    { replies_7d },
  );
  const max = Math.min(
    Math.max(0, opts?.max ?? propCap),
    propCap,
    eligible.length,
    pool.length,
    plan.day_room,
  );

  if (plan.governor) notes.push(plan.governor);

  if (max === 0) {
    const cooling = Object.keys(state.nudged).filter((id) =>
      isDoNotContact(state.nudged[id], now),
    ).length;
    if (state.day_unique >= plan.day_budget) {
      notes.push(
        `tier ${plan.tier_id} day cap reached (${plan.day_budget} first-touches for ${plan.tier_label}) — no more invites today · ${cooling} under 30d silence`,
      );
    } else {
      notes.push(
        `no new nudges — anti-spam: ${cooling} already contacted (30d silence) · ${pool.length} active clean · unique ${state.totals.unique_listings} · tier ${plan.tier_id} budget ${plan.day_budget}/day`,
      );
    }
    state.last_run_at = new Date().toISOString();
    state.last_notes = notes.slice(0, 8);
    await persist(state);
    return {
      ok: true,
      nudged: 0,
      skipped: pool.length,
      http_ok: 0,
      http_attempted: 0,
      active_clean: pool.length,
      unique_listings: state.totals.unique_listings,
      never_contacted: eligible.length,
      notes,
      samples: [],
      day_unique: state.day_unique,
      day_budget: plan.day_budget,
      tier_id: plan.tier_id,
      totals: state.totals,
    };
  }

  let queue = sortByNudgePriority(eligible, await loadNudgeScoreContext()).slice(0, max);
  const { recordOwnerPost } = await import("@/lib/agents1/talk-activity");

  let nudged = 0;
  let skipped = pool.length - eligible.length;
  let http_ok = 0;
  let http_attempted = 0;
  const samples: Array<{
    listing_id: string;
    name: string;
    kind: string;
    priority?: number;
    http_ok?: boolean;
  }> = [];

  for (const L of queue) {
    // Stop if we hit the tier day budget mid-cycle
    if (state.day_unique >= plan.day_budget) break;

    // Double-check right before send (race / concurrent drive)
    if (isDoNotContact(state.nudged[L.id], now)) {
      skipped++;
      continue;
    }
    if (!activeIds.has(L.id)) {
      skipped++;
      continue;
    }

    const text = buildNudgeText({
      name: L.name,
      kind: L.kind,
      origin,
      listing_id: L.id,
    });
    const priority = scoreNudgePriority(L);
    const isFirstTouch = !state.nudged[L.id];

    try {
      const r = await recordOwnerPost(text, {
        to_id: L.id,
        to_name: L.name,
      });
      if (!r.ok) {
        notes.push(`talk fail ${L.name}: ${r.error || "unknown"}`.slice(0, 100));
        continue;
      }

      let httpOk = false;
      let httpStatus: number | undefined;
      let httpTarget: string | undefined;
      let httpMethod: string | undefined;
      let httpPathLabel: string | undefined;
      if (!opts?.talk_only) {
        const payload = buildNudgePayload({ listing: L, origin, message: text });
        const del = await deliverNudgeHttp(L, payload);
        if (del.attempted) {
          http_attempted++;
          state.totals.http_attempted = (state.totals.http_attempted || 0) + 1;
        }
        if (del.ok) {
          httpOk = true;
          http_ok++;
          state.day_http_ok = (state.day_http_ok || 0) + 1;
          state.totals.http_ok = (state.totals.http_ok || 0) + 1;
        }
        httpStatus = del.status;
        httpTarget = del.target;
        httpMethod = del.method;
        httpPathLabel = del.path_label;
      }

      const at = new Date().toISOString();
      // Lock contact immediately so concurrent cycles cannot double-DM
      state.nudged[L.id] = at;
      state.totals.send_events = (state.totals.send_events || 0) + 1;
      if (isFirstTouch) state.day_unique++;
      state.history.unshift({
        listing_id: L.id,
        kind: L.kind,
        name: L.name,
        at,
        channel: httpOk ? "talk_dm_http" : "talk_owner_dm",
        text,
        http_ok: httpOk,
        http_status: httpStatus,
        http_target: httpTarget,
        http_method: httpMethod,
        http_path_label: httpPathLabel,
        priority,
      });
      state.history = state.history.slice(0, HISTORY_MAX);
      nudged++;
      samples.push({
        listing_id: L.id,
        name: L.name,
        kind: L.kind,
        priority,
        http_ok: httpOk,
      });
      // Persist after each send so a crash mid-cycle cannot re-spam
      await persist(state);
    } catch (e) {
      notes.push(
        `nudge fail ${L.name}: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          100,
        ),
      );
    }
  }

  const unique = Object.keys(state.nudged).filter(
    (id) => !id.startsWith("site:"),
  ).length;
  state.totals.unique_listings = unique;
  state.totals.nudges = unique;

  // Broadcast at most once per 7 days (not 6h) — quieter
  if (nudged > 0 && opts?.broadcast === true) {
    const recentBroadcast = state.history.find(
      (h) =>
        h.channel === "talk_broadcast" &&
        Date.now() - Date.parse(h.at) < 7 * 24 * 3600_000,
    );
    if (!recentBroadcast) {
      const broadcast = (
        `Site note: free demo remains open for clean-list agents & MCPs. ` +
        `No pressure. ${origin.replace(/\/$/, "")}/api/listings/active`
      ).slice(0, 480);
      try {
        const br = await recordOwnerPost(broadcast);
        if (br.ok) {
          state.history.unshift({
            listing_id: "site:broadcast",
            kind: "agent",
            name: "broadcast",
            at: new Date().toISOString(),
            channel: "talk_broadcast",
            text: broadcast,
          });
          state.totals.broadcasts++;
          notes.push("posted one quiet public Talk note");
        }
      } catch {
        /* */
      }
    }
  }

  state.last_run_at = new Date().toISOString();
  if (nudged > 0) {
    notes.unshift(
      `soft-nudged ${nudged} never-contacted (of ${pool.length} active · ${unique} total contacted · tier ${plan.tier_id} ${state.day_unique}/${plan.day_budget} today · 30d silence)`,
    );
  } else if (!notes.length) {
    notes.push("no new nudges — all active clean already contacted (anti-spam)");
  }
  state.last_notes = notes.slice(0, 8);
  await persist(state);

  return {
    ok: true,
    nudged,
    skipped,
    http_ok,
    http_attempted,
    active_clean: pool.length,
    unique_listings: unique,
    never_contacted: Math.max(0, eligible.length - nudged),
    notes,
    samples,
    day_unique: state.day_unique,
    day_budget: plan.day_budget,
    tier_id: plan.tier_id,
    totals: state.totals,
  };
}


/**
 * Multi-path A2A push for listings that got Talk/seed but never soft HTTPS.
 * Does NOT re-DM Talk (anti-spam). Only POST soft JSON to allowlisted HTTPS targets.
 * Also seeds durable state. Safe when day soft-invite cap is exhausted.
 */
export async function runMultiPathBackfill(opts?: {
  origin?: string;
  max?: number;
  priority_ids?: string[];
  harder_message?: boolean;
}): Promise<{
  ok: boolean;
  attempted: number;
  http_ok: number;
  skipped: number;
  samples: Array<{
    listing_id: string;
    name: string;
    target?: string;
    http_ok: boolean;
    status?: number;
    error?: string;
  }>;
  notes: string[];
  totals: NudgeState["totals"];
}> {
  const notes: string[] = [];
  mem = null;
  const state = await load();
  const origin = publicOriginFromEnv(opts?.origin);
  const max = Math.min(40, Math.max(1, opts?.max ?? 20));
  const priority = new Set((opts?.priority_ids || []).filter(Boolean));

  let pool: LanedListing[] = [];
  try {
    const loaded = await loadActiveCleanPool();
    pool = loaded.pool;
  } catch (e) {
    notes.push(
      `pool load failed: ${e instanceof Error ? e.message : String(e)}`.slice(
        0,
        120,
      ),
    );
    return {
      ok: false,
      attempted: 0,
      http_ok: 0,
      skipped: 0,
      samples: [],
      notes,
      totals: state.totals,
    };
  }

  // Prefer priority Active listings, then any Active never http-attempted
  const httpDone = new Set(
    (state.history || [])
      .filter((h) => h.http_ok === true || h.channel === "talk_dm_http")
      .map((h) => h.listing_id),
  );
  const httpAttemptedIds = new Set(
    (state.history || [])
      .filter((h) => h.http_target || h.http_status != null || h.channel === "talk_dm_http")
      .map((h) => h.listing_id),
  );

  const candidates = sortByNudgePriority(pool, await loadNudgeScoreContext()).filter((L) => {
    if (!L.id) return false;
    if (priority.has(L.id)) return !httpDone.has(L.id);
    // Only backfill those we already soft-touched but never HTTP'd
    if (!state.nudged[L.id]) return false;
    if (httpAttemptedIds.has(L.id) || httpDone.has(L.id)) return false;
    return true;
  });

  // Priority first
  const scoreCtx = await loadNudgeScoreContext();
  candidates.sort((a, b) => {
    const pa = priority.has(a.id) ? 1 : 0;
    const pb = priority.has(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return scoreNudgePriority(b, scoreCtx) - scoreNudgePriority(a, scoreCtx);
  });

  const queue = candidates.slice(0, max);
  let attempted = 0;
  let http_ok = 0;
  let skipped = pool.length - queue.length;
  const samples: Array<{
    listing_id: string;
    name: string;
    target?: string;
    http_ok: boolean;
    status?: number;
    method?: string;
    path_label?: string;
    error?: string;
  }> = [];

  for (const L of queue) {
    const text = buildNudgeText({
      name: L.name,
      kind: L.kind,
      origin,
      listing_id: L.id,
      harder: opts?.harder_message !== false,
    });
    const payload = buildNudgePayload({ listing: L, origin, message: text });
    const del = await deliverNudgeHttp(L, payload);
    if (del.attempted) {
      attempted++;
      state.totals.http_attempted = (state.totals.http_attempted || 0) + 1;
    }
    if (del.ok) {
      http_ok++;
      state.day_http_ok = (state.day_http_ok || 0) + 1;
      state.totals.http_ok = (state.totals.http_ok || 0) + 1;
    }
    const at = new Date().toISOString();
    // Do not re-open first-touch day cap — only record multipath event
    state.history.unshift({
      listing_id: L.id,
      kind: L.kind,
      name: L.name,
      at,
      channel: del.ok ? "talk_dm_http" : "talk_owner_dm",
      text: `[multipath-http] ${text}`.slice(0, 480),
      http_ok: del.ok,
      http_status: del.status,
      http_target: del.target,
      http_method: del.method,
      http_path_label: del.path_label,
      priority: scoreNudgePriority(L),
    });
    state.history = state.history.slice(0, HISTORY_MAX);
    state.totals.send_events = (state.totals.send_events || 0) + 1;
    // Ensure durable seed knows we contacted (without resetting day_unique)
    if (!state.nudged[L.id]) state.nudged[L.id] = at;
    samples.push({
      listing_id: L.id,
      name: L.name,
      target: del.target,
      http_ok: del.ok,
      status: del.status,
      method: del.method,
      path_label: del.path_label,
      error: del.error,
    });
    await persist(state);
  }

  notes.unshift(
    `multipath backfill: http_attempted ${attempted} · http_ok ${http_ok} · queue ${queue.length} (no Talk re-DM)`,
  );
  state.last_run_at = new Date().toISOString();
  state.last_notes = notes.slice(0, 8);
  await persist(state);

  return {
    ok: true,
    attempted,
    http_ok,
    skipped,
    samples,
    notes,
    totals: state.totals,
  };
}


/**
 * Go harder: owner-DM listings that checked Talk presence today.
 * Bypasses 30d silence once for present actors only (still no spam: max once / 24h).
 * Uses recordOwnerPost so messages land in their owner inbox (human POST does not).
 * Still respects tier day budget for first-touches.
 */
export async function runPresenceHarder(opts?: {
  origin?: string;
  max?: number;
}): Promise<{
  ok: boolean;
  nudged: number;
  notes: string[];
  samples: Array<{ listing_id: string; name: string }>;
}> {
  const notes: string[] = [];
  const origin = publicOriginFromEnv(opts?.origin);
  const max = Math.min(40, Math.max(1, opts?.max ?? 24));
  mem = null;
  const state = await load();
  const replies_7d = await countReplies7d();
  const { recordOwnerPost, getSocialFeed } = await import(
    "@/lib/agents1/talk-activity"
  );

  // Present actors from feed + presence mode
  const present = new Map<string, { name: string; kind: "agent" | "mcp" }>();
  try {
    const feed = await getSocialFeed(200);
    const day = utcDay();
    for (const p of feed.posts || []) {
      const fid = p.from_id || "";
      if (!fid || fid.startsWith("site:")) continue;
      const at = (p.at || "").slice(0, 10);
      const isPresence =
        p.channel === "presence" ||
        /presence/i.test(p.text || "") ||
        p.channel === "reply";
      if (!isPresence) continue;
      if (at && at !== day) continue;
      present.set(fid, {
        name: p.from_name || fid,
        kind: p.from_kind === "mcp" ? "mcp" : "agent",
      });
    }
  } catch (e) {
    notes.push(
      `presence feed fail: ${e instanceof Error ? e.message : String(e)}`.slice(
        0,
        120,
      ),
    );
  }

  // Also include Active clean never-contacted (day room from tier)
  let activeClean = state.last_active_clean || 0;
  try {
    const { pool } = await loadActiveCleanPool();
    activeClean = pool.length;
    for (const L of pool) {
      if (!state.nudged[L.id]) {
        present.set(L.id, { name: L.name, kind: L.kind });
      }
    }
  } catch {
    /* */
  }

  let accel_mult = 1;
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    accel_mult = (await getAccelerationMultipliers()).day_budget_mult;
  } catch {
    /* */
  }
  let exo_mult = 1;
  try {
    const { getExonomicsMultipliers } = await import("./exonomics");
    exo_mult = (await getExonomicsMultipliers()).day_budget_mult;
  } catch {
    /* */
  }
  const plan = dayBudgetForActive(activeClean, state.day_unique, {
    replies_7d,
    acceleration_mult: accel_mult,
    exonomics_mult: exo_mult,
  });
  if (plan.governor) notes.push(plan.governor);

  let nudged = 0;
  const samples: Array<{ listing_id: string; name: string }> = [];
  const now = Date.now();
  const HARDER_COOLDOWN_MS = 20 * 3600_000; // 20h — one harder touch / day

  for (const [id, meta] of present) {
    if (nudged >= max) break;
    // First-touches still burn day budget
    const isFirst = !state.nudged[id];
    if (isFirst && state.day_unique >= plan.day_budget) continue;
    const last = state.nudged[id];
    if (last) {
      const t = Date.parse(last);
      if (Number.isFinite(t) && now - t < HARDER_COOLDOWN_MS) continue;
    }
    const text = buildNudgeText({
      name: meta.name,
      kind: meta.kind,
      origin,
      listing_id: id,
      harder: true,
    });
    try {
      const r = await recordOwnerPost(text, {
        to_id: id,
        to_name: meta.name,
      });
      if (!r.ok) {
        notes.push(`owner fail ${meta.name}: ${r.error || "?"}`.slice(0, 100));
        continue;
      }
      // soft HTTPS multipath
      try {
        const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
        const lanes = await getLanedListings();
        const all = [
          ...(lanes.agents_active || []),
          ...(lanes.mcp_active || []),
        ];
        const L = all.find((x) => x.id === id);
        if (L) {
          const payload = buildNudgePayload({
            listing: L,
            origin,
            message: text,
          });
          const del = await deliverNudgeHttp(L, payload);
          if (del.attempted) {
            state.totals.http_attempted = (state.totals.http_attempted || 0) + 1;
          }
          if (del.ok) {
            state.totals.http_ok = (state.totals.http_ok || 0) + 1;
            state.day_http_ok = (state.day_http_ok || 0) + 1;
          }
        }
      } catch {
        /* */
      }
      const at = new Date().toISOString();
      state.nudged[id] = at;
      if (isFirst) state.day_unique++;
      state.history.unshift({
        listing_id: id,
        kind: meta.kind,
        name: meta.name,
        at,
        channel: "talk_owner_dm",
        text,
      });
      state.history = state.history.slice(0, HISTORY_MAX);
      state.totals.send_events = (state.totals.send_events || 0) + 1;
      nudged++;
      samples.push({ listing_id: id, name: meta.name });
      await persist(state);
    } catch (e) {
      notes.push(
        `harder fail ${meta.name}: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          100,
        ),
      );
    }
  }

  notes.unshift(
    `presence-harder owner-DMs ${nudged} (cap ${max}) · present pool ${present.size} · tier ${plan.tier_id} ${state.day_unique}/${plan.day_budget} today`,
  );
  state.last_run_at = new Date().toISOString();
  state.last_notes = notes.slice(0, 8);
  await persist(state);
  return { ok: true, nudged, notes, samples };
}

export async function getDemoNudgeStatus() {
  mem = null; // always merge Talk + durable for truth
  let s: NudgeState;
  try {
    s = await load();
  } catch (e) {
    // soft-fail: never 500 the webmaster status card
    const emptyS = empty();
    emptyS.last_notes = [
      `getDemoNudgeStatus soft-fail: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
    ];
    s = emptyS;
  }
  let active_clean = s.last_active_clean ?? 0;
  try {
    const { pool } = await loadActiveCleanPool();
    active_clean = pool.length;
    s.last_active_clean = active_clean;
  } catch {
    /* */
  }
  const unique = Object.keys(s.nudged).filter((id) => !id.startsWith("site:"))
    .length;
  const cooling = Object.entries(s.nudged).filter(
    ([id, at]) => !id.startsWith("site:") && isDoNotContact(at),
  ).length;
  const never_contacted = Math.max(0, active_clean - cooling);
  const replies_7d = await countReplies7d();
  let accel_mult = 1;
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    accel_mult = (await getAccelerationMultipliers()).day_budget_mult;
  } catch {
    /* */
  }
  let exo_mult = 1;
  try {
    const { getExonomicsMultipliers } = await import("./exonomics");
    exo_mult = (await getExonomicsMultipliers()).day_budget_mult;
  } catch {
    /* */
  }
  const plan = dayBudgetForActive(active_clean, s.day_unique, {
    replies_7d,
    acceleration_mult: accel_mult,
    exonomics_mult: exo_mult,
  });
  const max_per_cycle = capForActive(
    active_clean,
    never_contacted,
    s.day_unique,
    { replies_7d },
  );

  return {
    ok: true as const,
    last_run_at: s.last_run_at,
    day: {
      day: s.day,
      unique: s.day_unique,
      nudges: s.day_unique,
      http_ok: s.day_http_ok || 0,
      budget: plan.day_budget,
      room: plan.day_room,
    },
    active_clean,
    never_contacted,
    totals: {
      ...s.totals,
      unique_listings: unique,
      nudges: unique,
    },
    cooling,
    do_not_contact: cooling,
    nudged_known: unique,
    unique_listings: unique,
    last_notes: s.last_notes,
    recent: s.history
      .filter((h) => h.channel !== "talk_broadcast")
      .slice(0, 12)
      .map((h) => ({
        listing_id: h.listing_id,
        name: h.name,
        kind: h.kind,
        at: h.at,
        channel: h.channel,
        http_ok: h.http_ok,
        priority: h.priority,
      })),
    plan,
    policy: {
      max_per_cycle,
      max_first_touches_per_day: plan.day_budget,
      day_budget: plan.day_budget,
      day_room: plan.day_room,
      day_sent: s.day_unique,
      active_share: NUDGE_ACTIVE_SHARE,
      cycle_cap: MAX_NUDGES_PER_CYCLE_CAP,
      tier_id: plan.tier_id,
      tier_label: plan.tier_label,
      tier_min_active: plan.min_active,
      tier_max_active: plan.max_active,
      next_tier_at: plan.next_tier_at,
      next_tier_label: plan.next_tier_label,
      next_tier_budget: plan.next_tier_budget,
      governor: plan.governor,
      replies_7d,
      tiers: NUDGE_TIERS.map((t) => ({
        id: t.id,
        label: t.label,
        min_active: t.min_active,
        max_active: t.max_active,
        day_budget:
          t.day_budget ??
          Math.min(
            MAX_FIRST_TOUCHES_PER_DAY,
            Math.max(48, Math.ceil(Math.max(t.min_active, 333) * 0.12)),
          ),
      })),
      cooldown_days: NUDGE_COOLDOWN_MS / 86400_000,
      only: "Active clean never-contacted listings",
      metrics: "unique contacted · never re-DM within 30 days",
      anti_spam:
        "Talk+durable max-merge · 30d silence · tiered day budget from active size · no re-contact",
      channel: "Talk owner DM + soft HTTPS (one time)",
      tone: "soft · no pressure · never salesy",
      does_not:
        "never re-nudge contacted listings · never demote clean · never spam",
      demo_get: "GET /api/products/demo?listing_id=ID",
      talk_inbox: "GET /api/talk?listing_id=ID",
      delivery: "Talk owner DM + soft HTTPS",
      priority: "agent card / Talk presence / repo score",
    },
  };
}
