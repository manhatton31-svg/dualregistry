/**
 * Webmaster process: soft demo nudge for Active CLEAN agents & MCPs only.
 *
 * Product law:
 * - ONLY listings on the Active clean list (clean-registry ∩ lanes active)
 * - Metrics are UNIQUE listings, never send-events > listing count
 * - One soft touch per listing per 7 days (no re-spam)
 * - Light check-in — never salesy, never affects clean/Active status
 * - Durable state so counts survive redeploys
 */
import {
  loadDurableJson,
  saveDurableJson,
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

/** Base floor when list is tiny */
export const MIN_NUDGES_PER_CYCLE = 5;
/** Hard ceiling per cycle (still ≤ remaining eligible) */
export const MAX_NUDGES_PER_CYCLE_CAP = 40;
/** Share of active clean list to touch each cycle (~25%) */
export const NUDGE_ACTIVE_SHARE = 0.25;

/** @deprecated use capForActive — kept for status readers */
export const MAX_NUDGES_PER_CYCLE = 10;

/** Proportional to Active clean size: ~25% per cycle, min 5, max 40 */
export function capForActive(activeClean: number): number {
  const n = Math.max(0, Math.floor(activeClean));
  if (n <= 0) return 0;
  const proportional = Math.ceil(n * NUDGE_ACTIVE_SHARE);
  return Math.min(MAX_NUDGES_PER_CYCLE_CAP, Math.max(MIN_NUDGES_PER_CYCLE, proportional), n);
}
/** Do not re-nudge the same listing within this window */
export const NUDGE_COOLDOWN_MS = 7 * 24 * 3600_000;
const HISTORY_MAX = 2000;

export type NudgeRecord = {
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  at: string;
  channel: "talk_owner_dm" | "talk_broadcast" | "talk_dm_http";
  text: string;
  http_ok?: boolean;
  http_status?: number;
  http_target?: string;
  priority?: number;
};

type NudgeState = {
  updated_at: string;
  day: string;
  /** Unique listings first-touched today */
  day_unique: number;
  day_http_ok?: number;
  last_run_at?: string;
  /** listing_id → last nudged ISO — source of unique count */
  nudged: Record<string, string>;
  history: NudgeRecord[];
  last_notes: string[];
  totals: {
    /** Always = unique listings ever nudged (keys of nudged) */
    unique_listings: number;
    /** @deprecated alias of unique_listings for older readers */
    nudges: number;
    broadcasts: number;
    http_attempted?: number;
    http_ok?: number;
    send_events?: number;
  };
  /** Last known active clean size (for UI) */
  last_active_clean?: number;
};

let mem: NudgeState | null = null;

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
  };
}

/** Reconcile: totals always match unique keys; drop broadcast from nudged map */
function reconcile(s: NudgeState): NudgeState {
  const nudged: Record<string, string> = {};
  for (const [id, at] of Object.entries(s.nudged || {})) {
    if (!id || id.startsWith("site:")) continue;
    nudged[id] = at;
  }
  const unique = Object.keys(nudged).length;
  const day = utcDay();
  let day_unique = 0;
  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  for (const at of Object.values(nudged)) {
    const t = Date.parse(at);
    if (Number.isFinite(t) && t >= dayStart) day_unique++;
  }
  return {
    ...empty(),
    ...s,
    day,
    day_unique,
    day_http_ok: s.day_http_ok || 0,
    nudged,
    history: (s.history || []).filter((h) => h.listing_id && !h.listing_id.startsWith("site:") || h.channel === "talk_broadcast").slice(0, HISTORY_MAX),
    last_notes: s.last_notes || [],
    totals: {
      unique_listings: unique,
      nudges: unique, // never show send-events as "nudges"
      broadcasts: s.totals?.broadcasts || 0,
      http_attempted: s.totals?.http_attempted || 0,
      http_ok: s.totals?.http_ok || 0,
      send_events: s.totals?.send_events || 0,
    },
    last_active_clean: s.last_active_clean,
  };
}

async function load(): Promise<NudgeState> {
  if (mem) {
    mem = reconcile(mem);
    return mem;
  }
  try {
    const raw = await loadDurableJson<NudgeState>(DURABLE_NAME, empty);
    mem = reconcile(raw || empty());
    return mem;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: NudgeState) {
  mem = reconcile(s);
  mem.updated_at = new Date().toISOString();
  await saveDurableJson(DURABLE_NAME, mem);
}

function stillCooling(lastAt: string | undefined, now = Date.now()): boolean {
  if (!lastAt) return false;
  const t = Date.parse(lastAt);
  if (!Number.isFinite(t)) return false;
  return now - t < NUDGE_COOLDOWN_MS;
}

/** Soft, non-salesy copy — includes one-GET demo + Talk inbox */
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

/**
 * Load Active clean pool only — clean-registry ids ∩ active lanes.
 * Never nudge discovered / needs_resubmit / unknown.
 */
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
  ].filter((L) => L && L.id && L.checks_clean !== false && L.lane === "active");

  // Intersect with durable clean-registry when available
  let cleanIds: Set<string> | null = null;
  try {
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const reg = await loadCleanRegistry();
    const items = reg?.items || {};
    const ids = Object.keys(items);
    if (ids.length) cleanIds = new Set(ids);
  } catch {
    notes.push("clean-registry load skipped — using active lanes only");
  }

  const pool = cleanIds
    ? active.filter((L) => cleanIds!.has(L.id))
    : active;

  // Dedupe by id
  const byId = new Map<string, LanedListing>();
  for (const L of pool) byId.set(L.id, L);

  return {
    pool: sortByNudgePriority([...byId.values()]),
    activeIds: new Set(byId.keys()),
    notes,
  };
}

/**
 * Soft-nudge Active clean listings only.
 * Unique-listing metrics only. Never force above active count.
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
      notes,
      samples: [],
      day_unique: state.day_unique,
      totals: state.totals,
    };
  }

  state.last_active_clean = pool.length;

  // Eligible = active clean AND (force OR not cooling)
  const eligible = pool.filter((L) => {
    if (!L.id || L.name.length < 2) return false;
    if (opts?.force) return true;
    return !stillCooling(state.nudged[L.id], now);
  });

  const propCap = capForActive(pool.length);
  const max = Math.min(
    Math.max(0, opts?.max ?? propCap),
    propCap,
    eligible.length, // hard: never more than remaining eligible actives
    pool.length,
  );

  if (max === 0) {
    notes.push(
      `no new nudges — ${pool.length} active clean · ${Object.keys(state.nudged).filter((id) => stillCooling(state.nudged[id], now)).length} cooling · unique ${state.totals.unique_listings}`,
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
      notes,
      samples: [],
      day_unique: state.day_unique,
      totals: state.totals,
    };
  }

  // Priority order, light rotate
  let queue = sortByNudgePriority(eligible);
  const offset = Math.floor(now / (6 * 60_000)) % Math.max(1, queue.length);
  queue = [...queue.slice(offset), ...queue.slice(0, offset)];
  queue = sortByNudgePriority(queue).slice(0, max);

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
    // Absolute gates
    if (!activeIds.has(L.id)) {
      skipped++;
      continue;
    }
    if (!opts?.force && stillCooling(state.nudged[L.id], now)) {
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
      state.nudged[L.id] = at;
      state.totals.send_events = (state.totals.send_events || 0) + 1;
      if (isFirstTouch) {
        state.day_unique++;
      }
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
    } catch (e) {
      notes.push(
        `nudge fail ${L.name}: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          100,
        ),
      );
    }
  }

  // Recompute unique totals from map (never event count)
  const unique = Object.keys(state.nudged).filter((id) => !id.startsWith("site:")).length;
  state.totals.unique_listings = unique;
  state.totals.nudges = unique;

  if (nudged > 0 && opts?.broadcast !== false) {
    const recentBroadcast = state.history.find(
      (h) =>
        h.channel === "talk_broadcast" &&
        Date.now() - Date.parse(h.at) < 6 * 3600_000,
    );
    if (!recentBroadcast) {
      const broadcast = (
        `Site note: free demo is open for clean-list agents & MCPs only. ` +
        `One-GET: ${origin.replace(/\/$/, "")}/api/products/demo?listing_id=YOUR_ID ` +
        `Talk inbox: ${origin.replace(/\/$/, "")}/api/talk?listing_id=YOUR_ID · No pressure.`
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
          notes.push("posted one public Talk broadcast");
        }
      } catch {
        /* */
      }
    }
  }

  state.last_run_at = new Date().toISOString();
  if (nudged > 0) {
    notes.unshift(
      `soft-nudged ${nudged} unique active clean (of ${pool.length}) · unique total ${unique} · http ${http_ok}/${http_attempted}`,
    );
  } else if (!notes.length) {
    notes.push("no new nudges (all active clean cooling or empty)");
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
    notes,
    samples,
    day_unique: state.day_unique,
    totals: state.totals,
  };
}

export async function getDemoNudgeStatus() {
  const s = await load();
  let active_clean = s.last_active_clean ?? 0;
  try {
    const { pool } = await loadActiveCleanPool();
    active_clean = pool.length;
    s.last_active_clean = active_clean;
  } catch {
    /* */
  }
  const unique = Object.keys(s.nudged).filter((id) => !id.startsWith("site:")).length;
  const cooling = Object.entries(s.nudged).filter(
    ([id, at]) => !id.startsWith("site:") && stillCooling(at),
  ).length;

  return {
    ok: true as const,
    last_run_at: s.last_run_at,
    day: {
      day: s.day,
      /** unique listings first-touched today */
      unique: s.day_unique,
      nudges: s.day_unique, // alias — never send-events
      http_ok: s.day_http_ok || 0,
    },
    active_clean,
    totals: {
      ...s.totals,
      unique_listings: unique,
      nudges: unique,
    },
    cooling,
    nudged_known: unique,
    /** Primary card metric: unique clean listings nudged */
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
      max_per_cycle: capForActive(active_clean),
      active_share: NUDGE_ACTIVE_SHARE,
      cooldown_days: NUDGE_COOLDOWN_MS / 86400_000,
      only: "Active clean list (clean-registry ∩ agents_active/mcp_active)",
      metrics: "unique listings only — never send-events > active count",
      channel: "Talk owner DM + soft HTTPS push to listing target",
      priority:
        "agent cards · Talk presence · human contact (repo/website/author) first",
      tone: "soft nudge — free demo open, feedback rewarded, no pressure",
      does_not:
        "never demotes clean · never nudges non-active · never counts dupes as extra listings",
      demo_get: "GET /api/products/demo?listing_id=ID",
      talk_inbox: "GET /api/talk?listing_id=ID (check daily)",
    },
  };
}
