/**
 * Webmaster process: soft demo nudge for Active (clean) agents & MCPs.
 *
 * Product law:
 * - Light check-in only — never salesy, never affects clean/Active status
 * - Mention real feedback is rewarded (founding free / early seats)
 * - Track who was nudged; cooldown so we do not re-nudge every tick
 * - Runs inside feedback-drive + optional manual POST /api/products/demo-nudge
 * - State is durable (GitHub data/prod) so prod cards survive redeploys
 * - Delivery: Talk owner DM + soft HTTP POST to listing target (SSRF-safe)
 * - Priority: agent cards, Talk presence, human contact surfaces first
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
} from "./nudge-deliver";

const DURABLE_NAME = "demo-nudge.json";

/** Max soft Talk nudges per drive cycle */
export const MAX_NUDGES_PER_CYCLE = 10;
/** Do not re-nudge the same listing within this window */
export const NUDGE_COOLDOWN_MS = 7 * 24 * 3600_000;
/** Cap stored nudge history */
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
  day_nudges: number;
  day_http_ok?: number;
  last_run_at?: string;
  /** listing_id → last nudged ISO */
  nudged: Record<string, string>;
  history: NudgeRecord[];
  last_notes: string[];
  totals: {
    nudges: number;
    broadcasts: number;
    http_attempted?: number;
    http_ok?: number;
  };
};

let mem: NudgeState | null = null;

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function empty(): NudgeState {
  return {
    updated_at: new Date().toISOString(),
    day: utcDay(),
    day_nudges: 0,
    day_http_ok: 0,
    nudged: {},
    history: [],
    last_notes: [],
    totals: { nudges: 0, broadcasts: 0, http_attempted: 0, http_ok: 0 },
  };
}

function normalize(s: NudgeState): NudgeState {
  const out: NudgeState = {
    ...empty(),
    ...s,
    nudged: s.nudged || {},
    history: s.history || [],
    last_notes: s.last_notes || [],
    totals: { ...empty().totals, ...s.totals },
  };
  if (out.day !== utcDay()) {
    out.day = utcDay();
    out.day_nudges = 0;
    out.day_http_ok = 0;
  }
  return out;
}

async function load(): Promise<NudgeState> {
  if (mem) {
    if (mem.day !== utcDay()) {
      mem.day = utcDay();
      mem.day_nudges = 0;
      mem.day_http_ok = 0;
    }
    return mem;
  }
  try {
    const raw = await loadDurableJson<NudgeState>(DURABLE_NAME, empty);
    mem = normalize(raw || empty());
    return mem;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: NudgeState) {
  mem = s;
  s.updated_at = new Date().toISOString();
  await saveDurableJson(DURABLE_NAME, s);
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
 * Soft-nudge Active clean listings via Talk owner DMs + HTTP push.
 * Priority: cards, Talk presence, human surfaces first.
 * Does not affect clean/Active status.
 */
export async function runDemoNudge(opts?: {
  force?: boolean;
  max?: number;
  /** If true, also post one public owner broadcast when any nudges sent */
  broadcast?: boolean;
  origin?: string;
  /** Skip HTTP push (Talk only) */
  talk_only?: boolean;
}): Promise<{
  ok: boolean;
  nudged: number;
  skipped: number;
  http_ok: number;
  http_attempted: number;
  notes: string[];
  samples: Array<{
    listing_id: string;
    name: string;
    kind: string;
    priority?: number;
    http_ok?: boolean;
  }>;
  day_nudges: number;
  totals: NudgeState["totals"];
}> {
  const notes: string[] = [];
  const state = await load();
  const max = Math.min(
    Math.max(1, opts?.max ?? MAX_NUDGES_PER_CYCLE),
    MAX_NUDGES_PER_CYCLE,
  );
  const origin = publicOriginFromEnv(opts?.origin);
  const now = Date.now();

  let pool: LanedListing[] = [];
  try {
    const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
    const lanes = await getLanedListings();
    const raw = [...(lanes.mcp_active || []), ...(lanes.agents_active || [])];
    // Priority queue first, then light rotate among equal tiers
    const ranked = sortByNudgePriority(raw);
    const offset = Math.floor(now / (6 * 60_000)) % Math.max(1, ranked.length);
    pool = [
      ...ranked.slice(offset),
      ...ranked.slice(0, offset),
    ];
    // Re-stable by priority after rotate so high priority still leads overall
    pool = sortByNudgePriority(pool);
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
      notes,
      samples: [],
      day_nudges: state.day_nudges,
      totals: state.totals,
    };
  }

  const { recordOwnerPost } = await import("@/lib/agents1/talk-activity");
  const { scoreNudgePriority } = await import("./nudge-deliver");

  let nudged = 0;
  let skipped = 0;
  let http_ok = 0;
  let http_attempted = 0;
  const samples: Array<{
    listing_id: string;
    name: string;
    kind: string;
    priority?: number;
    http_ok?: boolean;
  }> = [];

  for (const L of pool) {
    if (nudged >= max) break;
    if (!L.id || !L.name || L.name.length < 2) {
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
      state.day_nudges++;
      state.totals.nudges++;
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

  if (nudged > 0 && opts?.broadcast !== false) {
    const broadcast = (
      `Site note: free demo is open for clean-list agents & MCPs. ` +
      `One-GET demo: ${origin.replace(/\/$/, "")}/api/products/demo?listing_id=YOUR_ID ` +
      `Talk inbox daily: ${origin.replace(/\/$/, "")}/api/talk?listing_id=YOUR_ID ` +
      `We reward real feedback. No pressure. ${origin.replace(/\/$/, "")}/api/listings/active`
    ).slice(0, 480);
    try {
      const recentBroadcast = state.history.find(
        (h) =>
          h.channel === "talk_broadcast" &&
          Date.now() - Date.parse(h.at) < 6 * 3600_000,
      );
      if (!recentBroadcast) {
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
          state.history = state.history.slice(0, HISTORY_MAX);
          state.totals.broadcasts++;
          notes.push("posted one public Talk broadcast");
        }
      }
    } catch {
      /* */
    }
  }

  state.last_run_at = new Date().toISOString();
  if (nudged > 0) {
    notes.unshift(
      `soft-nudged ${nudged} (priority queue) · http ok ${http_ok}/${http_attempted} · feedback rewarded · no pressure`,
    );
  } else if (!notes.length) {
    notes.push("no new nudges (cooldown or empty pool)");
  }
  state.last_notes = notes.slice(0, 8);
  await persist(state);

  try {
    if (nudged) {
      const { appendLog } = await import("./improvement-log");
      await appendLog({
        kind: "directive",
        title: `Demo nudge: ${nudged} soft invites (+ HTTP)`,
        detail: notes.join(" · "),
        source: "demo_nudge",
        themes: ["demo_nudge", "talk", "http_push", "webmaster"],
        meta: { nudged, http_ok, http_attempted, samples: samples.slice(0, 8) },
      });
    }
  } catch {
    /* */
  }

  return {
    ok: true,
    nudged,
    skipped,
    http_ok,
    http_attempted,
    notes,
    samples,
    day_nudges: state.day_nudges,
    totals: state.totals,
  };
}

export async function getDemoNudgeStatus() {
  const s = await load();
  const cooling = Object.values(s.nudged).filter((at) =>
    stillCooling(at),
  ).length;
  return {
    ok: true as const,
    last_run_at: s.last_run_at,
    day: {
      day: s.day,
      nudges: s.day_nudges,
      http_ok: s.day_http_ok || 0,
    },
    totals: s.totals,
    cooling,
    nudged_known: Object.keys(s.nudged).length,
    last_notes: s.last_notes,
    recent: s.history.slice(0, 12).map((h) => ({
      listing_id: h.listing_id,
      name: h.name,
      kind: h.kind,
      at: h.at,
      channel: h.channel,
      http_ok: h.http_ok,
      priority: h.priority,
    })),
    policy: {
      max_per_cycle: MAX_NUDGES_PER_CYCLE,
      cooldown_days: NUDGE_COOLDOWN_MS / 86400_000,
      channel: "Talk owner DM + soft HTTPS push to listing target",
      priority:
        "agent cards · Talk presence · human contact (repo/website/author) first",
      delivery:
        "POST dualregistry.soft_demo_invite JSON to probe/card URL (SSRF-safe)",
      tone: "soft nudge — free demo open, feedback rewarded, no pressure",
      does_not:
        "never demotes clean/Active · never auto-demo without listing action",
      demo_get: "GET /api/products/demo?listing_id=ID",
      talk_inbox: "GET /api/talk?listing_id=ID (check daily)",
    },
  };
}
