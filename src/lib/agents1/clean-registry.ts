/**
 * SINGLE SOURCE OF TRUTH for the public Active (clean) registry.
 *
 * LOCKED PRODUCT LAW (user mandate 2026-07-30):
 * - Number goes UP only when a live probe first returns checks-clean / handshake ok
 * - Number goes DOWN only when:
 *     (a) a later probe fails, OR
 *     (b) Talk maintenance lapses after the 7-day window (cron, not GET)
 * - Age, cold start, partial hydrate, multi-instance races MUST NOT move the number
 * - Until the week is up, the public number only rises
 *
 * Implementation:
 * - data/prod/clean-registry.json is the only public list + count authority
 * - Every load: max-merge local + remote GH + mem (never thin)
 * - GET paths only READ this file; they never recompute a thinner set
 */
import {
  loadDurableJson,
  saveDurableJson,
  forceHydrateDurable,
  durableRemoteRawUrl,
} from "./durable-json";

export type CleanItem = {
  id: string;
  kind: "agent" | "mcp";
  name: string;
  target?: string;
  /** First time this listing became clean (immutable after set). */
  approved_at: string;
  /** Last successful probe ok. */
  probed_at: string;
  score?: number;
  handshake: "ok";
  /** Why still listed */
  hold_reason?: string;
};

export type CleanRegistry = {
  day: string;
  updated_at: string;
  counts: { total: number; mcp: number; agents: number };
  /** High-water floors — public counts never report below these. */
  high_water: { total: number; mcp: number; agents: number };
  items: Record<string, CleanItem>;
  policy: {
    source: string;
    raise_only_on: string;
    remove_only_on: string;
    note: string;
  };
};

const DURABLE_NAME = "clean-registry.json";

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function empty(day = utcDay()): CleanRegistry {
  return {
    day,
    updated_at: new Date().toISOString(),
    counts: { total: 0, mcp: 0, agents: 0 },
    high_water: { total: 0, mcp: 0, agents: 0 },
    items: {},
    policy: {
      source: "single durable clean-registry",
      raise_only_on: "initial probe handshake ok (checks clean)",
      remove_only_on:
        "confirmed later probe fail OR Talk lapse after 7d (cron only)",
      note: "Public Active count/list read ONLY from this file. GET never demotes. Age/cold-start cannot drop a listing that was accepted.",
    },
  };
}

function recount(items: Record<string, CleanItem>) {
  let mcp = 0;
  let agents = 0;
  for (const it of Object.values(items)) {
    if (it.kind === "mcp") mcp++;
    else agents++;
  }
  return { total: mcp + agents, mcp, agents };
}

function raiseHighWater(
  hw: { total: number; mcp: number; agents: number } | undefined,
  counts: { total: number; mcp: number; agents: number },
) {
  return {
    total: Math.max(hw?.total || 0, counts.total),
    mcp: Math.max(hw?.mcp || 0, counts.mcp),
    agents: Math.max(hw?.agents || 0, counts.agents),
  };
}

function isAliasId(id: string) {
  return id.startsWith("name:") || id.startsWith("url:");
}

function normalizeItem(it: Partial<CleanItem> & { id: string }): CleanItem | null {
  if (!it.id || isAliasId(it.id) || it.handshake === undefined) {
    // allow missing handshake if we treat as ok floor
  }
  if (!it.id || isAliasId(it.id)) return null;
  const probed = it.probed_at || it.approved_at || new Date().toISOString();
  return {
    id: it.id,
    kind: it.kind === "agent" ? "agent" : "mcp",
    name: it.name || it.id,
    target: it.target || "",
    approved_at: it.approved_at || probed,
    probed_at: probed,
    score: it.score ?? 0,
    handshake: "ok",
    hold_reason: it.hold_reason || "probe ok",
  };
}

/** Max-merge: never drop an id that exists on either side. */
export function mergeClean(
  a: CleanRegistry | null | undefined,
  b: CleanRegistry | null | undefined,
): CleanRegistry {
  const day = utcDay();
  const base = empty(day);
  const items: Record<string, CleanItem> = {};
  for (const src of [a, b]) {
    if (!src?.items) continue;
    for (const [id, raw] of Object.entries(src.items)) {
      if (!raw) continue;
      const it = normalizeItem({ ...raw, id: raw.id || id });
      if (!it) continue;
      const prev = items[it.id];
      if (!prev) {
        items[it.id] = it;
        continue;
      }
      // Keep earliest approved_at; latest probed_at/score
      items[it.id] = {
        ...prev,
        name: it.name || prev.name,
        target: it.target || prev.target,
        approved_at:
          (prev.approved_at || "") <= (it.approved_at || "")
            ? prev.approved_at || it.approved_at
            : it.approved_at || prev.approved_at,
        probed_at:
          (it.probed_at || "") >= (prev.probed_at || "")
            ? it.probed_at
            : prev.probed_at,
        score: Math.max(prev.score || 0, it.score || 0),
        handshake: "ok",
        hold_reason: it.hold_reason || prev.hold_reason,
      };
    }
  }
  const counts = recount(items);
  return {
    ...base,
    day,
    updated_at: new Date().toISOString(),
    items,
    counts,
    high_water: raiseHighWater(
      raiseHighWater(a?.high_water, b?.high_water || { total: 0, mcp: 0, agents: 0 }),
      counts,
    ),
    policy: (a?.policy || b?.policy || base.policy) as CleanRegistry["policy"],
  };
}

let mem: CleanRegistry | null = null;

/** Absorb every current probe-ok into the floor (never decreases). */
export function absorbProbeResults(
  reg: CleanRegistry,
  results: Record<
    string,
    | {
        id?: string;
        kind?: string;
        name?: string;
        target?: string;
        probed_at?: string;
        score?: number;
        ok?: boolean;
        handshake?: string;
      }
    | null
    | undefined
  >,
): CleanRegistry {
  const items = { ...reg.items };
  for (const [k, r] of Object.entries(results || {})) {
    if (!r || !(r.handshake === "ok" && r.ok)) continue;
    const id = String(r.id || k);
    if (isAliasId(id) || isAliasId(k)) continue;
    const prev = items[id];
    const probed = r.probed_at || prev?.probed_at || new Date().toISOString();
    items[id] = {
      id,
      kind: r.kind === "agent" ? "agent" : "mcp",
      name: r.name || prev?.name || id,
      target: r.target || prev?.target || "",
      approved_at: prev?.approved_at || probed,
      probed_at: prev && (prev.probed_at || "") > probed ? prev.probed_at : probed,
      score: Math.max(r.score ?? 0, prev?.score ?? 0),
      handshake: "ok",
      hold_reason: "probe ok",
    };
  }
  const counts = recount(items);
  return {
    ...reg,
    day: utcDay(),
    updated_at: new Date().toISOString(),
    items,
    counts,
    high_water: raiseHighWater(reg.high_water, counts),
  };
}

/**
 * Always fetch remote and max-merge — never trust a thin local alone.
 */
async function hydrateRemoteClean(): Promise<CleanRegistry | null> {
  try {
    const url = durableRemoteRawUrl(DURABLE_NAME);
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryClean/2.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<!")) return null;
    return JSON.parse(text) as CleanRegistry;
  } catch {
    return null;
  }
}

export async function loadCleanRegistry(): Promise<CleanRegistry> {
  try {
    await forceHydrateDurable(DURABLE_NAME, { minBytes: 32 });
  } catch {
    /* */
  }
  const local = await loadDurableJson<CleanRegistry>(DURABLE_NAME, empty);
  const remote = await hydrateRemoteClean();
  let merged = mergeClean(mem, mergeClean(local, remote));

  // Always absorb live probe-ok (raise-only)
  try {
    const { loadProbeState } = await import("./probe");
    const s = await loadProbeState();
    if (s?.results) merged = absorbProbeResults(merged, s.results as any);
  } catch {
    /* */
  }

  const counts = recount(merged.items);
  merged = {
    ...merged,
    day: utcDay(),
    counts,
    high_water: raiseHighWater(merged.high_water, counts),
    updated_at: new Date().toISOString(),
  };
  mem = merged;
  // Persist if we recovered a higher floor than local alone (non-blocking path)
  try {
    const localCount = recount(local.items || {}).total;
    if (merged.counts.total > localCount) {
      await saveDurableJson(DURABLE_NAME, merged);
    }
  } catch {
    /* */
  }
  return { ...merged, counts: recount(merged.items) };
}

export async function saveCleanRegistry(reg: CleanRegistry): Promise<void> {
  const current = mem || empty();
  const merged = mergeClean(current, reg);
  const counts = recount(merged.items);
  const final: CleanRegistry = {
    ...merged,
    counts,
    high_water: raiseHighWater(merged.high_water, counts),
    updated_at: new Date().toISOString(),
  };
  mem = final;
  await saveDurableJson(DURABLE_NAME, final);
}

/** Raise after probe handshake ok — only way the list grows. */
export async function raiseClean(item: {
  id: string;
  kind: "agent" | "mcp";
  name: string;
  target?: string;
  probed_at: string;
  score?: number;
  handshake: "ok";
}): Promise<CleanRegistry> {
  if (!item?.id || item.handshake !== "ok" || isAliasId(item.id)) {
    return loadCleanRegistry();
  }
  const cur = await loadCleanRegistry();
  const prev = cur.items[item.id];
  const probed = item.probed_at || new Date().toISOString();
  cur.items[item.id] = {
    id: item.id,
    kind: item.kind === "agent" ? "agent" : "mcp",
    name: item.name || prev?.name || item.id,
    target: item.target || prev?.target || "",
    approved_at: prev?.approved_at || probed,
    probed_at:
      prev && (prev.probed_at || "") > probed ? prev.probed_at : probed,
    score: Math.max(item.score ?? 0, prev?.score ?? 0),
    handshake: "ok",
    hold_reason: "probe ok",
  };
  cur.counts = recount(cur.items);
  cur.high_water = raiseHighWater(cur.high_water, cur.counts);
  await saveCleanRegistry(cur);
  return cur;
}

/**
 * Remove ONLY on confirmed probe fail (newer than approved hold).
 * Never call from GET / classify / age checks.
 */
export async function removeCleanOnFail(
  id: string,
  failAt?: string,
): Promise<CleanRegistry> {
  if (!id || isAliasId(id)) return loadCleanRegistry();
  const cur = await loadCleanRegistry();
  const item = cur.items[id];
  if (!item) return cur;
  const at = failAt || new Date().toISOString();
  // Never drop if fail is older than last ok probe
  if (item.probed_at && at < item.probed_at) return cur;
  delete cur.items[id];
  cur.counts = recount(cur.items);
  // high_water stays — but public list uses items; user wants real fail to drop list
  // high_water is for multi-instance display floor during race, not immortal listings
  // On real fail we allow high_water to drop to counts so UI matches truth
  cur.high_water = {
    total: Math.max(cur.counts.total, cur.high_water?.total || 0) >= 0
      ? cur.counts.total
      : cur.counts.total,
    mcp: cur.counts.mcp,
    agents: cur.counts.agents,
  };
  // Keep high_water as max during races but after deliberate fail, lower to true counts
  cur.high_water = { ...cur.counts };
  cur.updated_at = new Date().toISOString();
  mem = cur;
  await saveDurableJson(DURABLE_NAME, cur);
  return cur;
}

/**
 * Talk maintenance lapse after 7d onboarding + 7d inactive window.
 * Only invoked from weekly cron — never from GET.
 */
export async function removeCleanOnTalkLapse(
  id: string,
): Promise<CleanRegistry> {
  if (!id || isAliasId(id)) return loadCleanRegistry();
  const cur = await loadCleanRegistry();
  if (!cur.items[id]) return cur;
  delete cur.items[id];
  cur.counts = recount(cur.items);
  cur.high_water = { ...cur.counts };
  cur.updated_at = new Date().toISOString();
  mem = cur;
  await saveDurableJson(DURABLE_NAME, cur);
  return cur;
}

/**
 * After a probe tick: RAISE-ONLY absorb.
 * Never bulk-remove here — partial instance results must not wipe the floor.
 * Explicit removeCleanOnFail is called on the fail path in probe.ts.
 */
export async function syncCleanFromProbeResults(
  results: Record<string, any>,
): Promise<CleanRegistry> {
  let cur = await loadCleanRegistry();
  cur = absorbProbeResults(cur, results || {});
  cur.counts = recount(cur.items);
  cur.high_water = raiseHighWater(cur.high_water, cur.counts);
  cur.updated_at = new Date().toISOString();
  await saveCleanRegistry(cur);
  return cur;
}

export function listCleanItems(
  reg: CleanRegistry,
  kind?: "agent" | "mcp" | null,
): CleanItem[] {
  const rows = Object.values(reg.items || {});
  const filtered = kind ? rows.filter((r) => r.kind === kind) : rows;
  return filtered.sort(
    (a, b) =>
      (b.score || 0) - (a.score || 0) ||
      (b.probed_at || "").localeCompare(a.probed_at || ""),
  );
}

/**
 * Build public Active rows solely from the clean floor.
 * Metadata enrichment is optional; missing metadata never drops a row.
 */
export function cleanItemsToLaned(
  items: CleanItem[],
  talkMap: Record<string, { last_at?: string } | undefined>,
  evaluateTalk: (
    id: string,
    probeAt: string | undefined,
    presence: any,
  ) => {
    active: boolean;
    mode: "present" | "grace" | "inactive" | "unknown";
    last_at?: string;
    reason: string;
  },
): Array<{
  id: string;
  kind: "agent" | "mcp";
  name: string;
  website?: string;
  remote_url?: string;
  agent_card_url?: string;
  lane: "active";
  lane_reason: string;
  checks_clean: true;
  talk: {
    required: true;
    active: boolean;
    mode: "present" | "grace" | "inactive" | "unknown";
    last_at?: string;
    reason: string;
  };
  probe: {
    ok: true;
    handshake: "ok";
    score: number;
    probed_at: string;
    target?: string;
    age_hours?: number;
  };
  source: "mirror";
  safety_score: number;
}> {
  return items.map((c) => {
    const age = Date.now() - Date.parse(c.probed_at || "");
    const talk = evaluateTalk(c.id, c.approved_at || c.probed_at, talkMap[c.id]);
    return {
      id: c.id,
      kind: c.kind,
      name: c.name || c.id,
      website: c.target || undefined,
      remote_url: c.kind === "mcp" ? c.target : undefined,
      agent_card_url: c.kind === "agent" ? c.target : undefined,
      lane: "active" as const,
      lane_reason:
        "Active — locked clean-registry (probe ok; holds until fail or Talk lapse)",
      checks_clean: true as const,
      talk: {
        required: true as const,
        active: talk.active,
        mode: talk.mode,
        last_at: talk.last_at,
        reason: talk.reason,
      },
      probe: {
        ok: true as const,
        handshake: "ok" as const,
        score: c.score || 0,
        probed_at: c.probed_at,
        target: c.target,
        age_hours: Number.isFinite(age) ? age / 3600_000 : undefined,
      },
      source: "mirror" as const,
      safety_score: c.score || 50,
    };
  });
}
