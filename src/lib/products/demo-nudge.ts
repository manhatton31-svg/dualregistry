/**
 * Soft demo nudge — Active CLEAN only. NEVER SPAM.
 *
 * Product law (hard):
 * - Only Active clean (clean-registry ∩ active lanes)
 * - One soft touch per listing per 30 days — never re-DM on redeploy/cold start
 * - State is MAX-MERGED durable + Talk owner-DM history (cannot forget who we nudged)
 * - Metrics = unique listings; never event spam counts
 * - force=false always (feedback-drive); ops force still respects Talk evidence of prior DM today
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
} from "./nudge-deliver";

const DURABLE_NAME = "demo-nudge.json";

/** Share of *never-contacted* eligible per cycle */
export const NUDGE_ACTIVE_SHARE = 0.15;
export const MIN_NUDGES_PER_CYCLE = 0; // 0 ok — better silence than spam
export const MAX_NUDGES_PER_CYCLE_CAP = 15;
/** @deprecated */
export const MAX_NUDGES_PER_CYCLE = 10;

/** Absolute minimum silence after any soft invite */
export const NUDGE_COOLDOWN_MS = 30 * 24 * 3600_000; // 30 days
const HISTORY_MAX = 5000;

export function capForActive(activeClean: number, neverContacted: number): number {
  const pool = Math.max(0, Math.min(activeClean, neverContacted));
  if (pool <= 0) return 0;
  const proportional = Math.ceil(activeClean * NUDGE_ACTIVE_SHARE);
  return Math.min(
    MAX_NUDGES_PER_CYCLE_CAP,
    Math.max(MIN_NUDGES_PER_CYCLE, proportional),
    pool,
  );
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
const POLICY_VERSION = 3; // never-spam 30d + talk seed

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
}): string {
  const who = opts.kind === "mcp" ? "MCP" : "agent";
  const o = opts.origin.replace(/\/$/, "");
  const demoGet = `${o}/api/products/demo?listing_id=${encodeURIComponent(opts.listing_id)}`;
  const inbox = `${o}/api/talk?listing_id=${encodeURIComponent(opts.listing_id)}`;
  return (
    `Hi ${opts.name} — you're on Dual Registry's clean list (${who}). ` +
    `Free demo if useful (one GET): ${demoGet} ` +
    `We reward real feedback (founding free for early ones). No pressure. ` +
    `Inbox/check-in: ${inbox}`
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
  return {
    pool: sortByNudgePriority([...byId.values()]),
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
  totals: NudgeState["totals"];
}> {
  const notes: string[] = [];
  // Always re-seed Talk + remote before deciding who is eligible
  mem = null;
  const state = await load();
  const origin = publicOriginFromEnv(opts?.origin);
  const now = Date.now();

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

  const propCap = capForActive(pool.length, eligible.length);
  const max = Math.min(
    Math.max(0, opts?.max ?? propCap),
    propCap,
    eligible.length,
    pool.length,
  );

  if (max === 0) {
    const cooling = Object.keys(state.nudged).filter((id) =>
      isDoNotContact(state.nudged[id], now),
    ).length;
    notes.push(
      `no new nudges — anti-spam: ${cooling} already contacted (30d silence) · ${pool.length} active clean · unique ${state.totals.unique_listings}`,
    );
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
      totals: state.totals,
    };
  }

  let queue = sortByNudgePriority(eligible).slice(0, max);
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
      `soft-nudged ${nudged} never-contacted (of ${pool.length} active · ${unique} total contacted · 30d silence)`,
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
    totals: state.totals,
  };
}

export async function getDemoNudgeStatus() {
  mem = null; // always merge Talk + durable for truth
  const s = await load();
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

  return {
    ok: true as const,
    last_run_at: s.last_run_at,
    day: {
      day: s.day,
      unique: s.day_unique,
      nudges: s.day_unique,
      http_ok: s.day_http_ok || 0,
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
    policy: {
      max_per_cycle: capForActive(active_clean, never_contacted),
      active_share: NUDGE_ACTIVE_SHARE,
      cooldown_days: NUDGE_COOLDOWN_MS / 86400_000,
      only: "Active clean never-contacted listings",
      metrics: "unique contacted · never re-DM within 30 days",
      anti_spam:
        "Talk owner-DM history + durable map max-merged; cold start cannot forget",
      channel: "Talk owner DM + soft HTTPS (one time)",
      tone: "soft · no pressure · never salesy",
      does_not:
        "never re-nudge contacted listings · never demote clean · never spam",
      demo_get: "GET /api/products/demo?listing_id=ID",
      talk_inbox: "GET /api/talk?listing_id=ID",
    },
  };
}
