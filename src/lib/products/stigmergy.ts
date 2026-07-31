/**
 * Stigmergy — Dual as shared pheromone medium for agents/MCPs.
 *
 * Agents coordinate by reading/writing Dual (not by more outbound DMs).
 * - Quantitative: usage pheromones (attraction, danger, demand) with evaporation
 * - Marker-based: leave_trace / endorse / used_with marks
 * - Auto deposits from existing tool side-effects (demo, feedback, match, probe, list)
 *
 * Durable: stigmergy.json
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";

export const STIGMERGY_VERSION = "2.9.0";
const DURABLE = "stigmergy.json";

/** Half-lives (hours) — classic ant-trail evaporation. */
const HALF_LIFE = {
  attraction: 168, // 7d
  danger: 72, // 3d
  demand: 48, // 2d
  joined: 336, // 14d
  mark: 240, // 10d
} as const;

/** Auto deposit weights (side-effect pheromones). */
export const AUTO_WEIGHTS = {
  take_demo: 8,
  leave_feedback: 20,
  match_hit: 2,
  match_query: 1,
  list_yourself: 5,
  probe_fail: 10,
  probe_ok: 1,
  endorse: 12,
  leave_trace: 6,
  used_with: 4,
} as const;

export type ListingPheromones = {
  listing_id: string;
  attraction: number;
  danger: number;
  demand: number;
  joined: number;
  last_reinforced_at: string;
  last_evaporated_at?: string;
  event_counts: {
    demos: number;
    feedback: number;
    match_hits: number;
    probes_ok: number;
    probes_fail: number;
    lists: number;
    endorsements: number;
  };
};

export type TraceMark = {
  id: string;
  kind: "mark" | "endorse" | "used_with" | "intent" | "note" | "danger" | "joined";
  listing_id?: string;
  listing_b?: string;
  from?: string;
  body?: string;
  intensity: number;
  at: string;
  tags?: string[];
};

export type StigFeedEvent = {
  type:
    | "auto_deposit"
    | "leave_trace"
    | "endorse"
    | "used_with"
    | "evaporation"
    | "follow_trail"
    | "founding_heat"
    | "composition"
    | "contagion"
    | "cascade"
    | "autocatalysis";
  listing_id?: string;
  listing_b?: string;
  kind?: string;
  amount?: number;
  field?: string;
  from?: string;
  body?: string;
  at: string;
};

type Store = {
  version: string;
  updated_at: string;
  pheromones: Record<string, ListingPheromones>;
  compositions: Record<string, { a: string; b: string; count: number; intensity: number; last_at: string }>;
  marks: TraceMark[];
  feed_events: StigFeedEvent[];
  totals: {
    auto_deposits: number;
    agent_deposits: number;
    senses: number;
    follows: number;
    evaporations: number;
  };
};

function empty(): Store {
  return {
    version: STIGMERGY_VERSION,
    updated_at: new Date().toISOString(),
    pheromones: {},
    compositions: {},
    marks: [],
    feed_events: [],
    totals: {
      auto_deposits: 0,
      agent_deposits: 0,
      senses: 0,
      follows: 0,
      evaporations: 0,
    },
  };
}

let mem: Store | null = null;

async function load(): Promise<Store> {
  if (mem) return mem;
  const s = await loadDurableJson<Store>(DURABLE, empty);
  if (!s.pheromones) s.pheromones = {};
  if (!s.compositions) s.compositions = {};
  if (!s.marks) s.marks = [];
  if (!s.feed_events) s.feed_events = [];
  if (!s.totals) s.totals = empty().totals;
  s.version = STIGMERGY_VERSION;
  mem = s;
  return s;
}

async function persist(s: Store) {
  s.updated_at = new Date().toISOString();
  s.version = STIGMERGY_VERSION;
  mem = s;
  await saveDurableJson(DURABLE, s);
}

function decay(value: number, halfLifeHours: number, hoursElapsed: number): number {
  if (value <= 0 || hoursElapsed <= 0) return Math.max(0, value);
  const next = value * Math.pow(0.5, hoursElapsed / halfLifeHours);
  return next < 0.05 ? 0 : Math.round(next * 1000) / 1000;
}

function hoursSince(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function ensureListing(s: Store, listing_id: string): ListingPheromones {
  const id = listing_id.trim();
  let row = s.pheromones[id];
  if (!row) {
    row = {
      listing_id: id,
      attraction: 0,
      danger: 0,
      demand: 0,
      joined: 0,
      last_reinforced_at: new Date().toISOString(),
      event_counts: {
        demos: 0,
        feedback: 0,
        match_hits: 0,
        probes_ok: 0,
        probes_fail: 0,
        lists: 0,
        endorsements: 0,
      },
    };
    s.pheromones[id] = row;
  }
  return row;
}

/** Apply evaporation to one listing based on last_reinforced/evaporated. */
function evaporateListing(row: ListingPheromones, nowIso: string): boolean {
  const ref = row.last_evaporated_at || row.last_reinforced_at;
  const h = hoursSince(ref);
  if (h < 0.25) return false; // skip if <15m
  const before =
    row.attraction + row.danger + row.demand + row.joined;
  row.attraction = decay(row.attraction, HALF_LIFE.attraction, h);
  row.danger = decay(row.danger, HALF_LIFE.danger, h);
  row.demand = decay(row.demand, HALF_LIFE.demand, h);
  row.joined = decay(row.joined, HALF_LIFE.joined, h);
  row.last_evaporated_at = nowIso;
  const after =
    row.attraction + row.danger + row.demand + row.joined;
  return after < before - 0.01;
}

function evaporateMarks(s: Store, nowIso: string) {
  const kept: TraceMark[] = [];
  for (const m of s.marks) {
    const h = hoursSince(m.at);
    const next = decay(m.intensity, HALF_LIFE.mark, h);
    if (next <= 0) continue;
    kept.push({ ...m, intensity: next });
  }
  s.marks = kept.slice(0, 2000);
  // also decay compositions lightly
  for (const key of Object.keys(s.compositions)) {
    const c = s.compositions[key];
    const h = hoursSince(c.last_at);
    c.intensity = decay(c.intensity, HALF_LIFE.attraction, h);
    if (c.intensity <= 0 && c.count < 2) delete s.compositions[key];
  }
  void nowIso;
}

function pushFeed(s: Store, ev: StigFeedEvent) {
  s.feed_events.unshift(ev);
  s.feed_events = s.feed_events.slice(0, 200);
}

function trailScore(row: ListingPheromones): number {
  return (
    row.attraction * 1.0 +
    row.demand * 0.6 +
    row.joined * 0.4 +
    row.event_counts.endorsements * 3 -
    row.danger * 1.2
  );
}

export async function evaporateAll(): Promise<{ evaporated: number }> {
  const s = await load();
  const now = new Date().toISOString();
  let n = 0;
  for (const row of Object.values(s.pheromones)) {
    if (evaporateListing(row, now)) n++;
  }
  evaporateMarks(s, now);
  if (n > 0) {
    s.totals.evaporations += n;
    pushFeed(s, {
      type: "evaporation",
      amount: n,
      at: now,
      body: `Evaporated ${n} listing trails`,
    });
  }
  await persist(s);
  return { evaporated: n };
}

export type AutoKind =
  | "take_demo"
  | "leave_feedback"
  | "match_hit"
  | "match_query"
  | "list_yourself"
  | "probe_fail"
  | "probe_ok";

/** P0a — automatic usage pheromones from tool side-effects. */
export async function autoDeposit(opts: {
  kind: AutoKind;
  listing_id?: string | null;
  listing_ids?: string[];
  from?: string;
  meta?: Record<string, unknown>;
}): Promise<{ ok: boolean; deposited: number }> {
  const ids = [
    ...(opts.listing_id ? [opts.listing_id] : []),
    ...(opts.listing_ids || []),
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (!ids.length) return { ok: true, deposited: 0 };

  const s = await load();
  const now = new Date().toISOString();
  let deposited = 0;

  for (const id of ids) {
    const row = ensureListing(s, id);
    evaporateListing(row, now);
    const w = AUTO_WEIGHTS[opts.kind];
    switch (opts.kind) {
      case "take_demo":
        row.attraction += w;
        row.event_counts.demos += 1;
        break;
      case "leave_feedback":
        row.attraction += w;
        row.event_counts.feedback += 1;
        break;
      case "match_hit":
        row.demand += w;
        row.attraction += w * 0.25;
        row.event_counts.match_hits += 1;
        break;
      case "match_query":
        row.demand += w;
        break;
      case "list_yourself":
        row.joined += w;
        row.attraction += w * 0.5;
        row.event_counts.lists += 1;
        break;
      case "probe_fail":
        row.danger += w;
        row.event_counts.probes_fail += 1;
        break;
      case "probe_ok":
        row.attraction += w;
        row.danger = Math.max(0, row.danger - w * 2);
        row.event_counts.probes_ok += 1;
        break;
    }
    row.last_reinforced_at = now;
    deposited += 1;
    pushFeed(s, {
      type: "auto_deposit",
      listing_id: id,
      kind: opts.kind,
      amount: w,
      field:
        opts.kind === "probe_fail"
          ? "danger"
          : opts.kind.startsWith("match")
            ? "demand"
            : opts.kind === "list_yourself"
              ? "joined"
              : "attraction",
      from: opts.from,
      at: now,
    });
  }

  s.totals.auto_deposits += deposited;
  await persist(s);

  // Autocatalysis: each deposit raises system-wide acceleration index
  if (deposited > 0) {
    try {
      const { bumpAcceleration } = await import("./autocatalysis");
      await bumpAcceleration({
        kind: opts.kind,
        listing_id: ids[0],
        amount: AUTO_WEIGHTS[opts.kind],
        meta: opts.meta,
      });
    } catch {
      /* */
    }
  }
  return { ok: true, deposited };
}

/** Agent-writable mark on the shared medium. */
export async function leaveTrace(opts: {
  listing_id?: string;
  listing_b?: string;
  kind?: TraceMark["kind"];
  body?: string;
  from?: string;
  tags?: string[];
  intensity?: number;
}): Promise<{ ok: boolean; mark?: TraceMark; error?: string }> {
  const kind = opts.kind || "mark";
  const listing_id = String(opts.listing_id || "").trim();
  const listing_b = String(opts.listing_b || "").trim();

  if (kind === "used_with") {
    if (!listing_id || !listing_b) {
      return { ok: false, error: "used_with requires listing_id and listing_b" };
    }
  } else if (kind !== "intent" && kind !== "note" && !listing_id) {
    return { ok: false, error: "listing_id required (except intent/note with body)" };
  }

  if (!listing_id && !String(opts.body || "").trim()) {
    return { ok: false, error: "listing_id or body required" };
  }

  const s = await load();
  const now = new Date().toISOString();
  const intensity = Math.min(
    50,
    Math.max(1, Number(opts.intensity) || AUTO_WEIGHTS.leave_trace),
  );

  const mark: TraceMark = {
    id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    listing_id: listing_id || undefined,
    listing_b: listing_b || undefined,
    from: opts.from?.slice(0, 120),
    body: opts.body?.slice(0, 2000),
    intensity,
    at: now,
    tags: (opts.tags || []).slice(0, 12),
  };
  s.marks.unshift(mark);
  s.marks = s.marks.slice(0, 2000);

  if (listing_id) {
    const row = ensureListing(s, listing_id);
    evaporateListing(row, now);
    if (kind === "endorse") {
      row.attraction += AUTO_WEIGHTS.endorse;
      row.event_counts.endorsements += 1;
    } else if (kind === "danger") {
      row.danger += intensity;
    } else {
      row.attraction += intensity * 0.5;
    }
    row.last_reinforced_at = now;
  }

  if (kind === "used_with" && listing_id && listing_b) {
    const [a, b] = [listing_id, listing_b].sort();
    const key = `${a}|${b}`;
    const prev = s.compositions[key] || {
      a,
      b,
      count: 0,
      intensity: 0,
      last_at: now,
    };
    prev.count += 1;
    prev.intensity += AUTO_WEIGHTS.used_with;
    prev.last_at = now;
    s.compositions[key] = prev;
    pushFeed(s, {
      type: "used_with",
      listing_id: a,
      listing_b: b,
      amount: prev.count,
      from: opts.from,
      at: now,
    });
    // P1 composition contagion — deposit demand on co-use neighbors
    const touched = applyCompositionContagion(s, a, b, now, opts.from);
    if (touched > 0) {
      pushFeed(s, {
        type: "contagion",
        listing_id: a,
        listing_b: b,
        amount: touched,
        from: opts.from,
        at: now,
        body: `Composition contagion touched ${touched} neighbors`,
      });
    }
  } else {
    pushFeed(s, {
      type: kind === "endorse" ? "endorse" : "leave_trace",
      listing_id: listing_id || undefined,
      kind,
      amount: intensity,
      from: opts.from,
      body: opts.body?.slice(0, 200),
      at: now,
    });
  }

  s.totals.agent_deposits += 1;
  await persist(s);

  try {
    const { bumpAcceleration } = await import("./autocatalysis");
    await bumpAcceleration({
      kind: kind === "endorse" ? "endorse" : kind === "used_with" ? "used_with" : "leave_trace",
      listing_id: listing_id || undefined,
      amount: intensity,
    });
  } catch {
    /* */
  }
  return { ok: true, mark };
}

export async function senseTraces(opts?: {
  listing_id?: string;
  q?: string;
  limit?: number;
  include_marks?: boolean;
}): Promise<{
  ok: true;
  version: string;
  evaporated: number;
  trails: Array<ListingPheromones & { trail_score: number }>;
  marks: TraceMark[];
  compositions: Array<{ a: string; b: string; count: number; intensity: number }>;
  totals: Store["totals"];
  note: string;
}> {
  const s = await load();
  const now = new Date().toISOString();
  let evaporated = 0;
  for (const row of Object.values(s.pheromones)) {
    if (evaporateListing(row, now)) evaporated++;
  }
  evaporateMarks(s, now);
  s.totals.senses += 1;
  await persist(s);

  const limit = Math.min(50, Math.max(1, opts?.limit ?? 12));
  const lid = String(opts?.listing_id || "").trim();
  const q = String(opts?.q || "")
    .trim()
    .toLowerCase();

  let trails = Object.values(s.pheromones).map((r) => ({
    ...r,
    trail_score: trailScore(r),
  }));

  if (lid) trails = trails.filter((t) => t.listing_id === lid);
  if (q) {
    trails = trails.filter(
      (t) =>
        t.listing_id.toLowerCase().includes(q) ||
        String(t.listing_id).includes(q),
    );
  }

  trails.sort((a, b) => b.trail_score - a.trail_score);
  trails = trails.slice(0, limit);

  // Flywheel 4: reading leaves a footprint (near-zero trail heat)
  if (trails.length > 0) {
    try {
      const { depositReadResidue } = await import("./flywheel");
      // fire-and-forget style but awaited quietly so persist races are ordered
      await depositReadResidue({
        listing_ids: trails.slice(0, 4).map((t) => t.listing_id),
        mode: "sense",
      });
    } catch {
      /* */
    }
  }

  let marks = s.marks;
  if (lid) marks = marks.filter((m) => m.listing_id === lid || m.listing_b === lid);
  if (q) {
    marks = marks.filter(
      (m) =>
        (m.body || "").toLowerCase().includes(q) ||
        (m.from || "").toLowerCase().includes(q) ||
        (m.listing_id || "").includes(q),
    );
  }
  marks = marks.slice(0, opts?.include_marks === false ? 0 : limit);

  const compositions = Object.values(s.compositions)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, limit)
    .map((c) => ({
      a: c.a,
      b: c.b,
      count: c.count,
      intensity: c.intensity,
    }));

  return {
    ok: true,
    version: STIGMERGY_VERSION,
    evaporated,
    trails,
    marks,
    compositions,
    totals: s.totals,
    note: "Stigmergic sense — trails evaporate over time; follow hot paths via follow_trail.",
  };
}

export async function followTrail(opts?: {
  limit?: number;
  kind?: "hot" | "dangerous" | "demand" | "composition";
}): Promise<{
  ok: true;
  version: string;
  mode: string;
  items: Array<Record<string, unknown>>;
  note: string;
}> {
  const s = await load();
  const now = new Date().toISOString();
  for (const row of Object.values(s.pheromones)) evaporateListing(row, now);
  s.totals.follows += 1;
  await persist(s);

  const limit = Math.min(40, Math.max(1, opts?.limit ?? 12));
  const mode = opts?.kind || "hot";

  if (mode === "composition") {
    const items = Object.values(s.compositions)
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, limit)
      .map((c) => ({
        type: "composition",
        listing_a: c.a,
        listing_b: c.b,
        count: c.count,
        intensity: c.intensity,
        note: "Agents that used A also used B",
      }));
    return {
      ok: true,
      version: STIGMERGY_VERSION,
      mode,
      items,
      note: "Composition trails — co-use pheromones.",
    };
  }

  const rows = Object.values(s.pheromones).map((r) => ({
    ...r,
    trail_score: trailScore(r),
  }));

  if (mode === "dangerous") {
    rows.sort((a, b) => b.danger - a.danger);
  } else if (mode === "demand") {
    rows.sort((a, b) => b.demand - a.demand);
  } else {
    rows.sort((a, b) => b.trail_score - a.trail_score);
  }

  const items = rows.slice(0, limit).map((r) => ({
    listing_id: r.listing_id,
    trail_score: r.trail_score,
    attraction: r.attraction,
    danger: r.danger,
    demand: r.demand,
    joined: r.joined,
    event_counts: r.event_counts,
    last_reinforced_at: r.last_reinforced_at,
  }));

  pushFeed(s, {
    type: "follow_trail",
    amount: items.length,
    kind: mode,
    at: new Date().toISOString(),
  });
  await persist(s);

  // Flywheel 4: follow deposits residue on hot paths
  if (items.length > 0 && mode !== "dangerous") {
    try {
      const { depositReadResidue } = await import("./flywheel");
      await depositReadResidue({
        listing_ids: items
          .map((i) => String(i.listing_id || ""))
          .filter(Boolean)
          .slice(0, 5),
        mode: "follow",
      });
    } catch {
      /* */
    }
  }

  return {
    ok: true,
    version: STIGMERGY_VERSION,
    mode,
    items,
    note: "Follow pheromone trails — prefer high attraction/demand, avoid high danger. Reads leave residue.",
  };
}

/** Boost applied to match capability_score from live pheromones. */
export async function pheromoneBoostFor(
  listingIds: string[],
): Promise<Record<string, number>> {
  if (!listingIds.length) return {};
  const s = await load();
  const now = new Date().toISOString();
  let mult = 1;
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    const m = await getAccelerationMultipliers();
    mult = m.match_boost_mult;
  } catch {
    /* */
  }
  const out: Record<string, number> = {};
  for (const id of listingIds) {
    const row = s.pheromones[id];
    if (!row) {
      out[id] = 0;
      continue;
    }
    evaporateListing(row, now);
    // Cap boost so trails don't dominate capability forever; autocatalysis multiplies
    const boost = Math.min(
      55,
      (trailScore(row) * 0.35 + row.event_counts.feedback * 2) * mult,
    );
    out[id] = Math.round(boost * 10) / 10;
  }
  return out;
}

export async function getStigmergyPublic(opts?: {
  origin?: string;
  limit?: number;
}): Promise<Record<string, unknown>> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(/\/$/, "");

  // Flywheel 3: bootstrap composition density once if empty
  try {
    const { ensureCompositionSeed } = await import("./flywheel");
    await ensureCompositionSeed();
  } catch {
    /* */
  }

  const sensed = await senseTraces({ limit: opts?.limit ?? 8, include_marks: true });
  const hot = await followTrail({ limit: 5, kind: "hot" });

  let founding: Record<string, unknown> | null = null;
  try {
    const { getFoundingFreePublic } = await import("./founding-free");
    const ff = await getFoundingFreePublic();
    founding = {
      type: "founding_heat",
      remaining: ff.remaining,
      claimed: ff.claimed,
      open: ff.open,
      note: "Scarce-resource stigmergic signal — nest construction progress",
    };
  } catch {
    /* */
  }

  return {
    ok: true,
    version: STIGMERGY_VERSION,
    medium: "dual_registry",
    model:
      "Agents coordinate by depositing and sensing traces on Dual — no direct mesh required.",
    half_lives_hours: HALF_LIFE,
    auto_weights: AUTO_WEIGHTS,
    tools: [
      "leave_trace",
      "sense_traces",
      "follow_trail",
      "endorse",
      "used_with",
      "join_and_contribute",
      "seed_compositions",
    ],
    auto_side_effects: [
      "take_demo → attraction (HTTP + tool)",
      "leave_feedback → strong attraction (HTTP + tool)",
      "match_capability hits → demand (HTTP + tool)",
      "list_yourself success → joined",
      "probe tick ok → attraction + cap_hash + outcome + interop",
      "probe tick fail → danger",
      "sense/follow → read residue (trail heat)",
      "founding claim → loud cascade",
    ],
    totals: sensed.totals,
    hot_trails: hot.items,
    recent_marks: sensed.marks.slice(0, 8),
    compositions: sensed.compositions.slice(0, 8),
    founding_heat: founding,
    feed: (await load()).feed_events.slice(0, 20),
    endpoints: {
      api: `${origin}/api/products/stigmergy`,
      autocatalysis: `${origin}/api/products/autocatalysis`,
      feed: `${origin}/api/feed`,
      tools: `${origin}/api/protocol`,
      match: `${origin}/api/match`,
      flywheel: FLYWHEEL_HINT,
    },
    note: "Stigmergy + flywheel v2.9 — reads leave residue; probes/demos/matches write density.",
  };
}

const FLYWHEEL_HINT = "2.9 closed-loop write path";

export async function stigmergyFeedItems(limit = 15): Promise<StigFeedEvent[]> {
  const s = await load();
  const now = new Date().toISOString();
  for (const row of Object.values(s.pheromones)) evaporateListing(row, now);
  return s.feed_events.slice(0, limit);
}


/** P1 — composition contagion: seed demand on co-use graph neighbors. */
function applyCompositionContagion(
  s: Store,
  a: string,
  b: string,
  now: string,
  from?: string,
): number {
  const neighborIds = new Set<string>();
  for (const c of Object.values(s.compositions)) {
    if (c.a === a || c.b === a) neighborIds.add(c.a === a ? c.b : c.a);
    if (c.a === b || c.b === b) neighborIds.add(c.a === b ? c.b : c.a);
  }
  neighborIds.delete(a);
  neighborIds.delete(b);
  let touched = 0;
  for (const id of [...neighborIds].slice(0, 8)) {
    const row = ensureListing(s, id);
    evaporateListing(row, now);
    row.demand += AUTO_WEIGHTS.used_with * 0.75;
    row.attraction += 0.5;
    row.last_reinforced_at = now;
    touched += 1;
  }
  // mutual demand on A and B themselves (reinforce composition)
  for (const id of [a, b]) {
    const row = ensureListing(s, id);
    evaporateListing(row, now);
    row.demand += AUTO_WEIGHTS.used_with * 0.5;
    row.last_reinforced_at = now;
  }
  void from;
  return touched;
}

/**
 * Contagion from a single listing (cascade / feedback).
 * Deposits weak demand on composition neighbors.
 */
export async function contagionFromListing(
  listing_id: string,
  opts?: { intensity?: number; from?: string },
): Promise<{ ok: true; touched: number }> {
  const s = await load();
  const now = new Date().toISOString();
  const id = listing_id.trim();
  if (!id) return { ok: true, touched: 0 };
  const intensity = Math.min(8, Math.max(1, opts?.intensity ?? 2));
  const neighborIds = new Set<string>();
  for (const c of Object.values(s.compositions)) {
    if (c.a === id) neighborIds.add(c.b);
    if (c.b === id) neighborIds.add(c.a);
  }
  let touched = 0;
  for (const nid of [...neighborIds].slice(0, 10)) {
    const row = ensureListing(s, nid);
    evaporateListing(row, now);
    row.demand += intensity;
    row.attraction += intensity * 0.25;
    row.last_reinforced_at = now;
    touched += 1;
  }
  if (touched > 0) {
    pushFeed(s, {
      type: "contagion",
      listing_id: id,
      amount: touched,
      from: opts?.from,
      at: now,
      body: `Cascade contagion → ${touched} neighbors`,
    });
    await persist(s);
  }
  return { ok: true, touched };
}

/** Trail scores for outbound priority (hot-trail → multipath ranking). */
export async function getTrailScoreMap(
  listingIds?: string[],
): Promise<Record<string, number>> {
  const s = await load();
  const now = new Date().toISOString();
  const out: Record<string, number> = {};
  const ids = listingIds?.length
    ? listingIds
    : Object.keys(s.pheromones);
  for (const id of ids) {
    const row = s.pheromones[id];
    if (!row) {
      out[id] = 0;
      continue;
    }
    evaporateListing(row, now);
    out[id] = trailScore(row);
  }
  return out;
}

/** High-danger listings for vicious-cycle delist acceleration. */
export async function getDangerList(limit = 20): Promise<
  Array<ListingPheromones & { trail_score: number }>
> {
  const s = await load();
  const now = new Date().toISOString();
  return Object.values(s.pheromones)
    .map((r) => {
      evaporateListing(r, now);
      return { ...r, trail_score: trailScore(r) };
    })
    .filter((r) => r.danger >= 8 || r.event_counts.probes_fail >= 2)
    .sort((a, b) => b.danger - a.danger)
    .slice(0, limit);
}
