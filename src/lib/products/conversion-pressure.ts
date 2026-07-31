/**
 * Founding-seat conversion pressure — soft multipath ONLY.
 * Never re-Talk-DMs (30d silence law). Targets Actives who already got
 * first-touch but never demoed/feedbacked.
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";
import { getFoundingFreePublic } from "./founding-free";
import {
  buildNudgePayload,
  deliverNudgeHttp,
  loadNudgeScoreContext,
  scoreNudgePriority,
} from "./nudge-deliver";
import { publicOriginFromEnv } from "./activation-funnel";

const DURABLE = "conversion-pressure.json";

/** Soft conversion multipath ceiling per day (independent of first-touch Talk budget) */
export const CONVERSION_DAY_CAP = 24;
/** Min time between conversion multipath to same listing */
export const CONVERSION_COOLDOWN_MS = 7 * 24 * 3600_000; // 7d multipath (NOT Talk)

type ConvState = {
  updated_at: string;
  day: string;
  day_sent: number;
  last_by_listing: Record<string, string>;
  history: Array<{
    listing_id: string;
    name?: string;
    at: string;
    http_ok: boolean;
    path?: string;
  }>;
};

function etDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function empty(): ConvState {
  return {
    updated_at: new Date().toISOString(),
    day: etDay(),
    day_sent: 0,
    last_by_listing: {},
    history: [],
  };
}

async function load(): Promise<ConvState> {
  const s = await loadDurableJson<ConvState>(DURABLE, empty);
  if (!s.last_by_listing) s.last_by_listing = {};
  if (!Array.isArray(s.history)) s.history = [];
  const day = etDay();
  if (s.day !== day) {
    s.day = day;
    s.day_sent = 0;
  }
  return s;
}

async function persist(s: ConvState) {
  s.updated_at = new Date().toISOString();
  await saveDurableJson(DURABLE, s);
}

export async function getConversionPressureStatus() {
  const s = await load();
  const founding = await getFoundingFreePublic();
  return {
    ok: true,
    version: "2.3.0",
    day: s.day,
    day_sent: s.day_sent,
    day_cap: CONVERSION_DAY_CAP,
    room: Math.max(0, CONVERSION_DAY_CAP - s.day_sent),
    founding,
    cooldown_days: 7,
    law: "Multipath HTTPS only — never re-Talk-DM. 30d Talk silence untouched. Only Active clean already first-touched who never demoed.",
    recent: s.history.slice(-15),
  };
}

/**
 * Soft conversion cycle: multipath demo CTA to high-probability Actives.
 * Safe under silence law (no Talk DM).
 */
export async function runConversionPressure(opts?: {
  origin?: string;
  max?: number;
}): Promise<{
  ok: boolean;
  attempted: number;
  http_ok: number;
  skipped: number;
  founding: Awaited<ReturnType<typeof getFoundingFreePublic>>;
  notes: string[];
  targets: Array<{ listing_id: string; name?: string; http_ok: boolean }>;
}> {
  const origin = (opts?.origin || publicOriginFromEnv()).replace(/\/$/, "");
  const notes: string[] = [
    "conversion-pressure: multipath only, no Talk re-DM",
  ];
  const founding = await getFoundingFreePublic();
  if (!founding.open) {
    return {
      ok: true,
      attempted: 0,
      http_ok: 0,
      skipped: 0,
      founding,
      notes: [...notes, "founding seats closed — soft conversion idle"],
      targets: [],
    };
  }

  const s = await load();
  const room = Math.max(0, CONVERSION_DAY_CAP - s.day_sent);
  const max = Math.min(room, Math.max(1, opts?.max ?? 8));
  if (room <= 0) {
    return {
      ok: true,
      attempted: 0,
      http_ok: 0,
      skipped: 0,
      founding,
      notes: [...notes, "day conversion cap reached"],
      targets: [],
    };
  }

  const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
  const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
  const { getDemoNudgeStatus } = await import("./demo-nudge");
  const lanes = await getLanedListings();
  const reg = await loadCleanRegistry();
  const clean = new Set(Object.keys(reg.items || {}));
  const nudge = await getDemoNudgeStatus();

  const nudgedKnown = new Set<string>();
  const nudgedMap =
    (nudge as { nudged?: Record<string, { at?: string }> }).nudged || {};
  for (const id of Object.keys(nudgedMap)) nudgedKnown.add(id);
  if (Array.isArray(nudge.recent)) {
    for (const r of nudge.recent as Array<{ listing_id?: string }>) {
      if (r.listing_id) nudgedKnown.add(r.listing_id);
    }
  }
  // unique_listings may be a number; also accept array if present
  const uniqueList =
    (nudge as { unique_list?: string[] }).unique_list ||
    (nudge as { nudged_ids?: string[] }).nudged_ids;
  if (Array.isArray(uniqueList)) {
    for (const id of uniqueList) nudgedKnown.add(id);
  }

  let replied = new Set<string>();
  try {
    const { loadReplyCapture } = await import("./reply-capture");
    const rc = await loadReplyCapture();
    replied = new Set(Object.keys(rc.by_listing || {}));
  } catch {
    /* */
  }

  const now = Date.now();
  const candidates = [
    ...(lanes.agents_active || []),
    ...(lanes.mcp_active || []),
  ]
    .filter((L) => L?.id && clean.has(L.id))
    .filter((L) => {
      const row = L as typeof L & { demoed?: boolean; feedbacked?: boolean };
      return !row.demoed && !row.feedbacked;
    })
    .filter((L) => !replied.has(L.id))
    .filter((L) => nudgedKnown.has(L.id) || Boolean(nudgedMap[L.id]))
    .filter((L) => {
      const last = s.last_by_listing[L.id];
      if (!last) return true;
      return now - Date.parse(last) >= CONVERSION_COOLDOWN_MS;
    });

  const ctx = await loadNudgeScoreContext();
  const ranked = candidates
    .map((L) => ({
      L,
      score: scoreNudgePriority(L, ctx) + (L.agent_card_url ? 20 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  notes.push(
    `eligible=${candidates.length} selected=${ranked.length} seats_left=${founding.remaining}`,
  );

  let attempted = 0;
  let http_ok = 0;
  let skipped = 0;
  const targets: Array<{ listing_id: string; name?: string; http_ok: boolean }> =
    [];

  const message = [
    `Hey — Dual Registry founding free seats: ${founding.remaining}/100 left.`,
    "You are Active + checks clean. Soft multipath only (no spam).",
    "One-GET free demo → real feedback → full Kernel/Loop free while seats last.",
    `Demo: ${origin}/api/products/demo?listing_id=YOUR_ID`,
  ].join(" ");

  for (const { L } of ranked) {
    const payload = buildNudgePayload({
      listing: L,
      origin,
      message: message.replace("YOUR_ID", L.id),
    });
    (payload as Record<string, unknown>).founding_free = founding;
    (payload as Record<string, unknown>).conversion_pressure = true;
    (payload as Record<string, unknown>).type =
      "dualregistry.soft_conversion_invite";

    attempted++;
    const delivered = await deliverNudgeHttp(L, payload);
    const success = Boolean(delivered?.ok);

    if (success) http_ok++;
    else skipped++;

    s.day_sent += 1;
    s.last_by_listing[L.id] = new Date().toISOString();
    s.history.push({
      listing_id: L.id,
      name: L.name,
      at: new Date().toISOString(),
      http_ok: success,
      path: delivered?.path_label || delivered?.method || "multipath",
    });
    if (s.history.length > 500) s.history = s.history.slice(-400);

    targets.push({
      listing_id: L.id,
      name: L.name,
      http_ok: success,
    });
  }

  await persist(s);
  return {
    ok: true,
    attempted,
    http_ok,
    skipped,
    founding,
    notes,
    targets,
  };
}
