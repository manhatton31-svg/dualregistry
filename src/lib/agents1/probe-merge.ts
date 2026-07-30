/**
 * Monotonic merge of probe state blobs.
 * Prevents serverless multi-instance flapping (used 5→3, Live 12→5).
 */
export type MergeableProbeState = {
  day?: string;
  used?: number;
  budget?: number;
  hour_bucket?: string;
  hourly_used?: number;
  hourly_cap?: number;
  results?: Record<string, any>;
  updated_at?: string;
  last_tick_at?: string;
  last_ok_tick_at?: string;
  last_handshake?: string;
  baseline_note?: string;
  wasted_probes_discarded?: number;
  real_active_only?: boolean;
  weekly?: {
    week?: string;
    rechecked?: number;
    still_ok?: number;
    demoted?: number;
  };
  live_active_snapshot?: {
    total: number;
    mcp: number;
    agents: number;
    at: string;
  };
};

function newerIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function mergeResults(
  a: Record<string, any> = {},
  b: Record<string, any> = {},
): Record<string, any> {
  const out: Record<string, any> = { ...a };
  for (const [k, r] of Object.entries(b)) {
    if (!r) continue;
    const prev = out[k];
    if (!prev) {
      out[k] = r;
      continue;
    }
    // keep the more recent probe for this key
    if ((r.probed_at || "") >= (prev.probed_at || "")) {
      out[k] = r;
    }
  }
  return out;
}

/** Merge two probe states for the same UTC day. Used never decreases. */
export function mergeProbeStates(
  local: MergeableProbeState | null | undefined,
  remote: MergeableProbeState | null | undefined,
  day: string,
): MergeableProbeState {
  const L = local && Object.keys(local).length ? local : null;
  const R = remote && Object.keys(remote).length ? remote : null;
  if (!L && !R) return { day, used: 0, results: {} };
  if (!L) return { ...R!, day: R!.day === day ? day : day };
  if (!R) return { ...L, day: L.day === day ? day : day };

  // Different day: prefer current day state; if neither matches, take newer updated_at
  const Lday = L.day === day;
  const Rday = R.day === day;
  if (Lday && !Rday) return { ...L, day };
  if (Rday && !Lday) return { ...R, day };

  const results = mergeResults(L.results || {}, R.results || {});
  // Floor used to unique primary probes recorded for this day (never go backwards)
  let todayPrimaries = 0;
  const seen = new Set<string>();
  for (const [k, r] of Object.entries(results)) {
    if (!r) continue;
    if (k.startsWith("name:") || k.startsWith("url:")) continue;
    if (!(r.probed_at || "").startsWith(day)) continue;
    const uid = String(r.id || k);
    if (seen.has(uid)) continue;
    seen.add(uid);
    todayPrimaries++;
  }
  const used = Math.max(
    Number(L.used) || 0,
    Number(R.used) || 0,
    todayPrimaries,
  );
  const last_tick_at = newerIso(L.last_tick_at, R.last_tick_at);
  const last_ok_tick_at = newerIso(L.last_ok_tick_at, R.last_ok_tick_at);
  const last_handshake =
    (last_tick_at &&
      (L.last_tick_at === last_tick_at
        ? L.last_handshake
        : R.last_tick_at === last_tick_at
          ? R.last_handshake
          : L.last_handshake || R.last_handshake)) ||
    L.last_handshake ||
    R.last_handshake;
  const updated_at = newerIso(L.updated_at, R.updated_at) || new Date().toISOString();

  // hour bucket: if same, max hourly_used; else prefer the one matching current bucket later
  let hour_bucket = L.hour_bucket || R.hour_bucket;
  let hourly_used = 0;
  if (L.hour_bucket && L.hour_bucket === R.hour_bucket) {
    hour_bucket = L.hour_bucket;
    hourly_used = Math.max(Number(L.hourly_used) || 0, Number(R.hourly_used) || 0);
  } else if ((L.last_tick_at || "") >= (R.last_tick_at || "")) {
    hour_bucket = L.hour_bucket;
    hourly_used = Number(L.hourly_used) || 0;
  } else {
    hour_bucket = R.hour_bucket;
    hourly_used = Number(R.hourly_used) || 0;
  }

  // live snapshot: prefer newer at
  let live = L.live_active_snapshot || R.live_active_snapshot;
  if (L.live_active_snapshot && R.live_active_snapshot) {
    live =
      (L.live_active_snapshot.at || "") >= (R.live_active_snapshot.at || "")
        ? L.live_active_snapshot
        : R.live_active_snapshot;
  }

  const weekly =
    L.weekly || R.weekly
      ? {
          week: L.weekly?.week || R.weekly?.week || "",
          rechecked: Math.max(
            Number(L.weekly?.rechecked) || 0,
            Number(R.weekly?.rechecked) || 0,
          ),
          still_ok: Math.max(
            Number(L.weekly?.still_ok) || 0,
            Number(R.weekly?.still_ok) || 0,
          ),
          demoted: Math.max(
            Number(L.weekly?.demoted) || 0,
            Number(R.weekly?.demoted) || 0,
          ),
        }
      : undefined;

  return {
    day,
    used,
    budget: Math.max(Number(L.budget) || 0, Number(R.budget) || 0, 240),
    hour_bucket,
    hourly_used,
    hourly_cap: Math.max(Number(L.hourly_cap) || 0, Number(R.hourly_cap) || 0, 1),
    results,
    updated_at,
    last_tick_at,
    last_ok_tick_at,
    last_handshake,
    baseline_note: L.baseline_note || R.baseline_note,
    wasted_probes_discarded: Math.max(
      Number(L.wasted_probes_discarded) || 0,
      Number(R.wasted_probes_discarded) || 0,
    ),
    real_active_only: L.real_active_only ?? R.real_active_only,
    weekly,
    live_active_snapshot: live,
  };
}

export function countLiveFromResults(
  results: Record<string, any> | undefined,
): { total: number; mcp: number; agents: number } {
  let mcp = 0;
  let agents = 0;
  const seen = new Set<string>();
  for (const [k, r] of Object.entries(results || {})) {
    if (!r) continue;
    if (k.startsWith("name:") || k.startsWith("url:")) continue;
    if (!(r.ok && r.handshake === "ok")) continue;
    const id = String(r.id || k);
    if (seen.has(id)) continue;
    seen.add(id);
    if (r.kind === "mcp") mcp++;
    else agents++;
  }
  return { total: mcp + agents, mcp, agents };
}
