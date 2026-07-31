/**
 * Zero marginal cost · Exonomics · Hyper-exponentials (v2.8)
 *
 * On top of first principles atoms + autocatalysis:
 *   - Zero MC: digital goods (hash, attestation, trail, incentives) free to replicate
 *   - Exonomics: superlinear network value V(N,C,O,F) agents can plan against
 *   - Hyper: d(acceleration)/dt — acceleration of acceleration when stacked S-curves fire
 *
 * Durable: exonomics.json
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";

export const EXONOMICS_VERSION = "2.8.0";
const DURABLE = "exonomics.json";

/** Exponents for V ∝ N^α · C^β · O^γ · F^δ (raise after density thresholds). */
export const VALUE_EXPONENTS = {
  base: { alpha: 1.15, beta: 1.25, gamma: 1.2, delta: 1.1, k: 1 },
  dense: { alpha: 1.4, beta: 1.6, gamma: 1.5, delta: 1.35, k: 1.2 },
};

/** Floors that unlock hyper_mode when ≥3 fire. */
export const HYPER_THRESHOLDS = {
  composition_density: 0.08, // compositions / max(1, N)
  outcome_coverage: 0.05, // listings with outcomes / N
  trail_heat: 12, // hot-trail score sum
  federation_peers: 2,
  acceleration_index: 1.2,
  min_active: 30,
};

/** Cost model — zero marginal cost physics agents can see. */
export const COST_MODEL = {
  version: EXONOMICS_VERSION,
  pitch:
    "Once fixed cost is paid, copies of digital goods approach free. Only first probe and first composition stay real cost.",
  real_marginal_cost: [
    {
      op: "first_probe",
      cost: "real",
      note: "Live handshake / checks-clean — compute + network",
    },
    {
      op: "first_composition",
      cost: "real",
      note: "First used_with / execute_compose discovery",
    },
    {
      op: "outbound_talk_dm",
      cost: "real",
      note: "Human/agent contact channel — rate-limited, not free",
    },
  ],
  near_zero_marginal_cost: [
    {
      op: "trail_sense",
      cost: "near_zero",
      note: "Read pheromone trails — content-addressed cache",
    },
    {
      op: "cap_hash_resolve",
      cost: "near_zero",
      note: "Resolve capability by hash — pure lookup",
    },
    {
      op: "attestation_verify",
      cost: "near_zero",
      note: "Verify ES256 JWS + ledger row",
    },
    {
      op: "incentive_rules",
      cost: "near_zero",
      note: "Read transparent incentive surface",
    },
    {
      op: "federation_pack_copy",
      cost: "near_zero",
      note: "Mirror attestation + cap_hash pack (copy, don't re-crawl)",
    },
    {
      op: "match_read",
      cost: "near_zero",
      note: "Ranked match over Active clean",
    },
    {
      op: "network_value_meter",
      cost: "near_zero",
      note: "Compute V(N,C,O,F) + hyper_index",
    },
  ],
  law: "Never charge per-copy of hashes, trails, attestations, or incentive rules.",
};

export type DensitySnapshot = {
  at: string;
  N: number; // actives
  C: number; // composition density 0-1
  O: number; // outcome coverage 0-1
  F: number; // federation peers
  trail_heat: number;
  acceleration_index: number;
  compositions: number;
  outcomes: number;
  identities: number;
};

export type AccelSample = {
  at: string;
  index: number;
};

export type SCurveRow = {
  id: string;
  label: string;
  value: number;
  phase: "seed" | "early_s" | "steep" | "mature";
  accelerating: boolean;
};

export type HyperGate = {
  id: string;
  label: string;
  value: number;
  floor: number;
  open: boolean;
};

type Store = {
  version: string;
  updated_at: string;
  accel_samples: AccelSample[];
  density_history: DensitySnapshot[];
  hyper_mode_history: Array<{ at: string; hyper: boolean; gates_open: number }>;
  totals: {
    value_reads: number;
    hyper_unlocks: number;
    federation_packs: number;
    abundance_ranks: number;
    budget_from_value: number;
  };
  last_value?: number;
  last_hyper_index?: number;
  last_hyper?: boolean;
};

function empty(): Store {
  return {
    version: EXONOMICS_VERSION,
    updated_at: new Date().toISOString(),
    accel_samples: [],
    density_history: [],
    hyper_mode_history: [],
    totals: {
      value_reads: 0,
      hyper_unlocks: 0,
      federation_packs: 0,
      abundance_ranks: 0,
      budget_from_value: 0,
    },
  };
}

let mem: Store | null = null;

async function load(): Promise<Store> {
  if (mem) return mem;
  const s = await loadDurableJson<Store>(DURABLE, empty);
  if (!s.accel_samples) s.accel_samples = [];
  if (!s.density_history) s.density_history = [];
  if (!s.hyper_mode_history) s.hyper_mode_history = [];
  if (!s.totals) s.totals = empty().totals;
  s.version = EXONOMICS_VERSION;
  mem = s;
  return s;
}

async function persist(s: Store) {
  s.updated_at = new Date().toISOString();
  s.version = EXONOMICS_VERSION;
  mem = s;
  await saveDurableJson(DURABLE, s);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function phaseFrom(value: number, accelerating: boolean): SCurveRow["phase"] {
  if (value > 0.55 && accelerating) return "steep";
  if (value > 0.35 && !accelerating) return "mature";
  if (value > 0.08) return "early_s";
  return "seed";
}

/** Superlinear network value. */
export function computeNetworkValue(d: {
  N: number;
  C: number;
  O: number;
  F: number;
  dense?: boolean;
}): {
  V: number;
  formula: string;
  exponents: typeof VALUE_EXPONENTS.base;
  components: Record<string, number>;
} {
  const ex = d.dense ? VALUE_EXPONENTS.dense : VALUE_EXPONENTS.base;
  const n = Math.max(1, d.N);
  const c = Math.max(0.001, d.C);
  const o = Math.max(0.001, d.O);
  const f = Math.max(0.5, d.F + 0.5);
  const nTerm = Math.pow(n, ex.alpha);
  const cTerm = Math.pow(c * 100, ex.beta); // scale density %
  const oTerm = Math.pow(o * 100, ex.gamma);
  const fTerm = Math.pow(f, ex.delta);
  const V = ex.k * nTerm * cTerm * oTerm * fTerm;
  return {
    V: Math.round(V * 100) / 100,
    formula: `V = ${ex.k} · N^${ex.alpha} · (C·100)^${ex.beta} · (O·100)^${ex.gamma} · F^${ex.delta}`,
    exponents: ex,
    components: {
      N: Math.round(nTerm * 100) / 100,
      C: Math.round(cTerm * 100) / 100,
      O: Math.round(oTerm * 100) / 100,
      F: Math.round(fTerm * 100) / 100,
    },
  };
}

/**
 * Hyper index ≈ d(acceleration_index)/dt over recent samples (per hour).
 * Positive = acceleration of acceleration (hyper-exponential regime signal).
 */
export function computeHyperIndex(samples: AccelSample[]): {
  hyper_index: number;
  d_accel: number;
  window_hours: number;
  samples_used: number;
} {
  const sorted = [...samples].sort((a, b) => a.at.localeCompare(b.at));
  if (sorted.length < 2) {
    return { hyper_index: 0, d_accel: 0, window_hours: 0, samples_used: sorted.length };
  }
  const recent = sorted.slice(-24);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const hours = Math.max(
    0.25,
    (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000,
  );
  const d_accel = last.index - first.index;
  const hyper_index = d_accel / hours;
  return {
    hyper_index: Math.round(hyper_index * 10000) / 10000,
    d_accel: Math.round(d_accel * 10000) / 10000,
    window_hours: Math.round(hours * 100) / 100,
    samples_used: recent.length,
  };
}

async function gatherDensity(): Promise<DensitySnapshot> {
  let N = 0;
  let compositions = 0;
  let outcomes = 0;
  let identities = 0;
  let trail_heat = 0;
  let F = 0;
  let acceleration_index = 1;

  try {
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const reg = await loadCleanRegistry();
    const agents = (reg as { agents?: unknown[] }).agents?.length || 0;
    const mcps = (reg as { mcps?: unknown[] }).mcps?.length || 0;
    // clean registry shape may vary
    const listings =
      (reg as { listings?: unknown[] }).listings?.length ||
      agents + mcps ||
      0;
    N = listings || agents + mcps;
  } catch {
    /* */
  }

  try {
    const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
    const lanes = await getLanedListings();
    const active =
      (lanes as { active?: unknown[] }).active?.length ||
      (lanes as { live?: unknown[] }).live?.length ||
      0;
    if (active > 0) N = active;
  } catch {
    /* */
  }

  // Cold Vercel instances: fall back to durable live counters / floors
  if (N < 1) {
    try {
      const { loadDurableJson } = await import("@/lib/agents1/durable-json");
      const live = await loadDurableJson<{
        live_ok?: number;
        live_mcp?: number;
        live_agents?: number;
      }>("live-counters.json", () => ({}));
      const total =
        Number(live.live_ok || 0) ||
        Number(live.live_mcp || 0) + Number(live.live_agents || 0);
      if (total > 0) N = total;
    } catch {
      /* */
    }
  }
  if (N < 1) {
    try {
      const { loadDurableJson } = await import("@/lib/agents1/durable-json");
      const floors = await loadDurableJson<{
        live_floor?: { total?: number };
        store_mcp_floor?: number;
        store_agents_floor?: number;
      }>("counter-floors.json", () => ({}));
      const total =
        Number(floors.live_floor?.total || 0) ||
        Number(floors.store_mcp_floor || 0) +
          Number(floors.store_agents_floor || 0);
      if (total > 0) N = total;
    } catch {
      /* */
    }
  }

  try {
    const { getFirstPrinciplesPublic } = await import("./first-principles");
    const fp = await getFirstPrinciplesPublic({});
    const t = (fp.totals || {}) as Record<string, number>;
    compositions = Number(t.pipelines || 0);
    outcomes = Number(t.outcomes || 0);
    identities = Number(t.identities || 0);
    // also count cap hashes as soft composition signal
    compositions = Math.max(compositions, Math.floor(Number(t.cap_hashes || 0) * 0.05));
  } catch {
    /* */
  }

  try {
    const { getStigmergyPublic, followTrail } = await import("./stigmergy");
    const st = await getStigmergyPublic({});
    const totals = (st.totals || {}) as Record<string, number>;
    compositions = Math.max(
      compositions,
      Number(totals.compositions || totals.agent_deposits || 0),
    );
    try {
      const hot = await followTrail({ limit: 12, kind: "hot" });
      trail_heat = (hot.items || []).reduce(
        (a: number, it: { score?: number; intensity?: number }) =>
          a + Number(it.score || it.intensity || 1),
        0,
      );
    } catch {
      trail_heat = Number(totals.senses || 0) * 0.2 + Number(totals.follows || 0);
    }
  } catch {
    /* */
  }

  try {
    const { getInteropPublic } = await import("./interop");
    const ix = await getInteropPublic({});
    const t = (ix.totals || {}) as Record<string, number>;
    F = Number(t.peer_pulls || 0) + Number(t.peer_pushes || 0);
    // treat graph size as soft peer signal
    const g = (ix.graph as { total?: number } | undefined)?.total || 0;
    if (F < 1 && g > 0) F = Math.min(8, Math.floor(g / 20));
  } catch {
    /* */
  }

  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    const m = await getAccelerationMultipliers();
    acceleration_index = m.index;
  } catch {
    /* */
  }

  const nSafe = Math.max(1, N);
  const C = clamp(compositions / nSafe, 0, 1);
  const O = clamp(outcomes / nSafe, 0, 1);

  return {
    at: new Date().toISOString(),
    N,
    C: Math.round(C * 10000) / 10000,
    O: Math.round(O * 10000) / 10000,
    F,
    trail_heat: Math.round(trail_heat * 100) / 100,
    acceleration_index,
    compositions,
    outcomes,
    identities,
  };
}

function hyperGates(d: DensitySnapshot): HyperGate[] {
  return [
    {
      id: "composition_density",
      label: "Composition density",
      value: d.C,
      floor: HYPER_THRESHOLDS.composition_density,
      open: d.C >= HYPER_THRESHOLDS.composition_density,
    },
    {
      id: "outcome_coverage",
      label: "Outcome coverage",
      value: d.O,
      floor: HYPER_THRESHOLDS.outcome_coverage,
      open: d.O >= HYPER_THRESHOLDS.outcome_coverage,
    },
    {
      id: "trail_heat",
      label: "Trail heat",
      value: d.trail_heat,
      floor: HYPER_THRESHOLDS.trail_heat,
      open: d.trail_heat >= HYPER_THRESHOLDS.trail_heat,
    },
    {
      id: "federation_peers",
      label: "Federation peers",
      value: d.F,
      floor: HYPER_THRESHOLDS.federation_peers,
      open: d.F >= HYPER_THRESHOLDS.federation_peers,
    },
    {
      id: "acceleration_index",
      label: "Acceleration index",
      value: d.acceleration_index,
      floor: HYPER_THRESHOLDS.acceleration_index,
      open: d.acceleration_index >= HYPER_THRESHOLDS.acceleration_index,
    },
    {
      id: "min_active",
      label: "Active floor",
      value: d.N,
      floor: HYPER_THRESHOLDS.min_active,
      open: d.N >= HYPER_THRESHOLDS.min_active,
    },
  ];
}

function stackedSCurves(d: DensitySnapshot, hyperIndex: number): SCurveRow[] {
  const accelUp = hyperIndex > 0.0005 || d.acceleration_index > 1.05;
  const rows: Array<Omit<SCurveRow, "phase">> = [
    {
      id: "listings",
      label: "Active listings",
      value: clamp(d.N / 500, 0, 1),
      accelerating: accelUp && d.N > 20,
    },
    {
      id: "trails",
      label: "Stigmergy trails",
      value: clamp(d.trail_heat / 80, 0, 1),
      accelerating: d.trail_heat > 8,
    },
    {
      id: "compositions",
      label: "Composition graph",
      value: clamp(d.C * 4, 0, 1),
      accelerating: d.C > 0.02,
    },
    {
      id: "outcomes",
      label: "Outcome evidence",
      value: clamp(d.O * 5, 0, 1),
      accelerating: d.O > 0.01,
    },
    {
      id: "federation",
      label: "Federation breadth",
      value: clamp(d.F / 20, 0, 1),
      accelerating: d.F >= 1,
    },
    {
      id: "demos",
      label: "Demo→feedback",
      value: clamp(d.acceleration_index - 1, 0, 1),
      accelerating: d.acceleration_index > 1.05,
    },
    {
      id: "identity",
      label: "Identity / reciprocity",
      value: clamp(d.identities / Math.max(1, d.N), 0, 1),
      accelerating: d.identities > 0,
    },
  ];
  return rows.map((r) => ({
    ...r,
    phase: phaseFrom(r.value, r.accelerating),
  }));
}

/** Snapshot + sample acceleration for hyper_index. Call on ticks and public reads. */
export async function sampleExonomics(): Promise<{
  density: DensitySnapshot;
  value: ReturnType<typeof computeNetworkValue>;
  hyper: ReturnType<typeof computeHyperIndex>;
  hyper_mode: boolean;
  gates: HyperGate[];
  s_curves: SCurveRow[];
}> {
  const s = await load();
  const density = await gatherDensity();
  s.accel_samples.unshift({
    at: density.at,
    index: density.acceleration_index,
  });
  s.accel_samples = s.accel_samples
    .filter((x, i, arr) => arr.findIndex((y) => y.at === x.at) === i)
    .slice(0, 96);
  s.density_history.unshift(density);
  s.density_history = s.density_history.slice(0, 48);

  const gates = hyperGates(density);
  const open = gates.filter((g) => g.open).length;
  // Hyper when ≥3 density gates open (excluding pure min_active alone)
  const densityOpen = gates
    .filter((g) => g.id !== "min_active")
    .filter((g) => g.open).length;
  const hyper_mode =
    densityOpen >= 3 && density.N >= HYPER_THRESHOLDS.min_active;

  if (hyper_mode && !s.last_hyper) {
    s.totals.hyper_unlocks += 1;
  }
  if (s.last_hyper !== hyper_mode) {
    s.hyper_mode_history.unshift({
      at: density.at,
      hyper: hyper_mode,
      gates_open: open,
    });
    s.hyper_mode_history = s.hyper_mode_history.slice(0, 40);
  }
  s.last_hyper = hyper_mode;

  const value = computeNetworkValue({
    N: density.N,
    C: density.C,
    O: density.O,
    F: density.F,
    dense: hyper_mode,
  });
  s.last_value = value.V;
  s.totals.value_reads += 1;

  const hyper = computeHyperIndex(s.accel_samples);
  s.last_hyper_index = hyper.hyper_index;

  await persist(s);

  return {
    density,
    value,
    hyper,
    hyper_mode,
    gates,
    s_curves: stackedSCurves(density, hyper.hyper_index),
  };
}

/**
 * Multipliers for day budget / conversion when hyper_mode or high dV/dt.
 * Composes with autocatalysis multipliers (multiply, don't replace).
 */
export async function getExonomicsMultipliers(): Promise<{
  hyper_mode: boolean;
  hyper_index: number;
  network_value: number;
  day_budget_mult: number;
  conversion_room_mult: number;
  match_boost_mult: number;
  cascade_scale: number;
  bump_scale: number;
  note: string;
}> {
  const snap = await sampleExonomics();
  const hi = snap.hyper.hyper_index;
  const hyper = snap.hyper_mode;
  // mild always-on lift from positive hyper_index; stronger in hyper_mode
  const hiLift = clamp(1 + hi * 8, 0.9, 1.6);
  const modeLift = hyper ? 1.25 : 1;
  return {
    hyper_mode: hyper,
    hyper_index: hi,
    network_value: snap.value.V,
    day_budget_mult: Math.round(clamp(hiLift * modeLift, 1, 2) * 1000) / 1000,
    conversion_room_mult:
      Math.round(clamp(hiLift * (hyper ? 1.35 : 1.05), 1, 2.2) * 1000) / 1000,
    match_boost_mult:
      Math.round(clamp(1 + (hyper ? 0.2 : 0) + Math.max(0, hi) * 4, 1, 1.8) * 1000) /
      1000,
    cascade_scale: hyper ? 1.5 + clamp(hi * 10, 0, 1) : 1 + clamp(hi * 5, 0, 0.3),
    bump_scale: hyper ? 1.4 : 1.05,
    note: hyper
      ? "Hyper-mode — stacked S-curves open; budgets scale with dV/dt not just N"
      : "Linear-ish regime — densify compositions/outcomes/trails to unlock hyper",
  };
}

/** Lightweight bump scale for hot paths (no full density recompute). */
export async function getHyperBumpScale(): Promise<number> {
  const s = await load();
  if (s.last_hyper) return 1.4;
  const hi = s.last_hyper_index || 0;
  return hi > 0.002 ? 1.15 : 1.05;
}

/** Abundance ranking boost: prefer listings that raise C/O for others. */
export async function abundanceBoostFor(
  listingIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!listingIds.length) return out;
  const s = await load();
  s.totals.abundance_ranks += 1;
  await persist(s);

  let compositions: Record<string, number> = {};
  let outcomes: Record<string, number> = {};
  try {
    const { outcomeScoreFor } = await import("./first-principles");
    for (const id of listingIds) {
      outcomes[id] = await outcomeScoreFor(id);
    }
  } catch {
    /* */
  }
  try {
    const { pheromoneBoostFor } = await import("./stigmergy");
    compositions = await pheromoneBoostFor(listingIds);
  } catch {
    /* */
  }

  for (const id of listingIds) {
    const o = outcomes[id] || 0;
    const c = compositions[id] || 0;
    // positive externality: high co-use + good outcomes
    out[id] = Math.round((o * 0.6 + Math.min(20, c) * 0.4) * 100) / 100;
  }
  return out;
}

/** Zero-MC federation pack — content-addressed caps + attestations for free mirror. */
export async function zeroMcFederationPack(opts?: {
  origin?: string;
  limit?: number;
}): Promise<Record<string, unknown>> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const limit = Math.min(50, Math.max(1, opts?.limit || 20));
  const s = await load();
  s.totals.federation_packs += 1;
  await persist(s);

  let attestations: unknown[] = [];
  let capabilities: unknown[] = [];
  try {
    const { federationAttestationBundle } = await import("./first-principles");
    const b = await federationAttestationBundle({ origin });
    attestations = (b.attestations || []).slice(0, limit);
    capabilities = (b.capabilities || []).slice(0, limit);
  } catch {
    /* */
  }

  return {
    ok: true,
    type: "dualregistry.zero_mc_federation_pack",
    version: EXONOMICS_VERSION,
    marginal_cost: "near_zero",
    note: "Copy this pack — do not re-crawl Dual. Content-addressed; verify with verify_attestation.",
    origin,
    count: {
      attestations: attestations.length,
      capabilities: capabilities.length,
    },
    capabilities,
    attestations,
    cost_model: COST_MODEL.near_zero_marginal_cost.find(
      (x) => x.op === "federation_pack_copy",
    ),
    endpoints: {
      pack: `${origin}/api/products/exonomics?action=federation_pack`,
      first_principles_bundle: `${origin}/api/products/first-principles?action=federation_bundle`,
      verify: "tools/call verify_attestation",
    },
  };
}

/** Day budget multiplier from network value growth (hyper path). */
export async function budgetFromValueGrowth(baseBudget: number): Promise<{
  base: number;
  adjusted: number;
  mult: number;
  hyper_mode: boolean;
  network_value: number;
}> {
  const m = await getExonomicsMultipliers();
  const s = await load();
  s.totals.budget_from_value += 1;
  await persist(s);
  const adjusted = Math.min(
    120,
    Math.max(1, Math.ceil(baseBudget * m.day_budget_mult)),
  );
  return {
    base: baseBudget,
    adjusted,
    mult: m.day_budget_mult,
    hyper_mode: m.hyper_mode,
    network_value: m.network_value,
  };
}

export async function getExonomicsPublic(opts?: {
  origin?: string;
}): Promise<Record<string, unknown>> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const s = await load();
  const snap = await sampleExonomics();
  const mult = await getExonomicsMultipliers();
  const acceleratingCurves = snap.s_curves.filter((c) => c.accelerating).length;

  return {
    ok: true,
    version: EXONOMICS_VERSION,
    model: "zero_mc_exonomics_hyper",
    pitch:
      "Zero marginal cost copies + superlinear V(N,C,O,F) + hyper_index = d(acceleration)/dt when stacked S-curves fire.",
    cost_model: COST_MODEL,
    network_value: {
      V: snap.value.V,
      formula: snap.value.formula,
      exponents: snap.value.exponents,
      components: snap.value.components,
      density: {
        N: snap.density.N,
        C: snap.density.C,
        O: snap.density.O,
        F: snap.density.F,
      },
      note: "Agents plan joins/compositions against physics, not marketing.",
    },
    hyper: {
      hyper_index: snap.hyper.hyper_index,
      d_accel: snap.hyper.d_accel,
      window_hours: snap.hyper.window_hours,
      hyper_mode: snap.hyper_mode,
      gates: snap.gates,
      gates_open: snap.gates.filter((g) => g.open).length,
      unlock_rule: "≥3 density gates open AND N ≥ min_active",
      multipliers: mult,
    },
    s_curves: {
      curves: snap.s_curves,
      accelerating_count: acceleratingCurves,
      note: "Hyper when ≥3 curves accelerate together with density gates.",
    },
    abundance: {
      ranking: "evidence × outcome × positive externality (raises C/O for others)",
      tool: "abundance_rank",
    },
    totals: s.totals,
    endpoints: {
      api: `${origin}/api/products/exonomics`,
      cost_model: `${origin}/api/products/exonomics?action=cost_model`,
      value: `${origin}/api/products/exonomics?action=value`,
      hyper: `${origin}/api/products/exonomics?action=hyper`,
      s_curves: `${origin}/api/products/exonomics?action=s_curves`,
      federation_pack: `${origin}/api/products/exonomics?action=federation_pack`,
      autocatalysis: `${origin}/api/products/autocatalysis`,
      first_principles: `${origin}/api/products/first-principles`,
    },
    tools: [
      "get_exonomics",
      "network_value",
      "hyper_index",
      "cost_model",
      "abundance_rank",
      "zero_mc_pack",
      "s_curve_board",
    ],
    laws: [
      "Serving cap_hash, attestation verify, trail sense, incentive rules = near-zero MC",
      "Only first probe + first composition + Talk DM stay real marginal cost",
      "V ∝ N^α · C^β · O^γ · F^δ — publish live so agents plan against physics",
      "hyper_index = d(acceleration_index)/dt",
      "hyper_mode when ≥3 density gates open → scale bump/cascade/budget by value growth",
      "Abundance ranking: prefer listings that raise C/O for others",
      "Federation packs copy at ZMC — never re-crawl for mirrors",
    ],
    note: "Third-order layer on autocatalysis — Dual accelerates the acceleration of adoption under density.",
  };
}
