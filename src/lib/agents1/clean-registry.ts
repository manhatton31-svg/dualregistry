/**
 * SINGLE SOURCE OF TRUTH for public clean (checks-clean) listings.
 *
 * Product law (user mandate):
 * - One durable file: data/prod/clean-registry.json
 * - Raise ONLY on live probe handshake ok
 * - Remove ONLY on confirmed later probe fail
 * - Every load max-merges local + GH remote + mem + current probes.json ok set
 * - Public API / UI number read from this floor — count never decreases from partial hydrate or age alone
 */
import {
  loadDurableJson,
  saveDurableJson,
  forceHydrateDurable,
} from "./durable-json";

export type CleanItem = {
  id: string;
  kind: "agent" | "mcp";
  name: string;
  target?: string;
  probed_at: string;
  score?: number;
  handshake: "ok";
};

export type CleanRegistry = {
  day: string;
  updated_at: string;
  counts: { total: number; mcp: number; agents: number };
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
    items: {},
    policy: {
      source: "single durable clean-registry",
      raise_only_on: "probe handshake ok",
      remove_only_on: "confirmed probe fail",
      note: "Public clean count/list read from this file only. Max-merge on every load. Age alone never drops a listing.",
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

function isAliasId(id: string) {
  return id.startsWith("name:") || id.startsWith("url:");
}

/** Max-merge: never drop an id that exists in either side. Newer probed_at wins. */
export function mergeClean(
  a: CleanRegistry | null | undefined,
  b: CleanRegistry | null | undefined,
): CleanRegistry {
  const day = utcDay();
  const base = empty(day);
  const items: Record<string, CleanItem> = {};
  for (const src of [a, b]) {
    if (!src?.items) continue;
    for (const [id, it] of Object.entries(src.items)) {
      if (!it || it.handshake !== "ok" || isAliasId(id)) continue;
      const prev = items[id];
      if (!prev || (it.probed_at || "") >= (prev.probed_at || "")) {
        items[id] = {
          id,
          kind: it.kind === "agent" ? "agent" : "mcp",
          name: it.name || id,
          target: it.target || prev?.target || "",
          probed_at: it.probed_at || prev?.probed_at || new Date().toISOString(),
          score: it.score ?? prev?.score ?? 0,
          handshake: "ok",
        };
      }
    }
  }
  return {
    ...base,
    day,
    updated_at: new Date().toISOString(),
    items,
    counts: recount(items),
    policy: (a?.policy || b?.policy || base.policy) as CleanRegistry["policy"],
  };
}

let mem: CleanRegistry | null = null;

/** Absorb every current probe-ok into the floor (never decreases). */
export function absorbProbeResults(
  reg: CleanRegistry,
  results: Record<string, { id?: string; kind?: string; name?: string; target?: string; probed_at?: string; score?: number; ok?: boolean; handshake?: string } | null | undefined>,
): CleanRegistry {
  const items = { ...reg.items };
  for (const [k, r] of Object.entries(results || {})) {
    if (!r || !(r.handshake === "ok" && r.ok)) continue;
    const id = String(r.id || k);
    if (isAliasId(id) || isAliasId(k)) continue;
    const prev = items[id];
    const probed = r.probed_at || prev?.probed_at || new Date().toISOString();
    if (prev && (prev.probed_at || "") > probed) continue;
    items[id] = {
      id,
      kind: r.kind === "agent" ? "agent" : "mcp",
      name: r.name || prev?.name || id,
      target: r.target || prev?.target || "",
      probed_at: probed,
      score: r.score ?? prev?.score ?? 0,
      handshake: "ok",
    };
  }
  return {
    ...reg,
    day: utcDay(),
    updated_at: new Date().toISOString(),
    items,
    counts: recount(items),
  };
}

export async function loadCleanRegistry(): Promise<CleanRegistry> {
  try {
    await forceHydrateDurable(DURABLE_NAME, { minBytes: 64 });
  } catch {
    /* */
  }
  const remote = await loadDurableJson<CleanRegistry>(DURABLE_NAME, empty);
  let merged = mergeClean(mem, remote);

  // Always absorb live probe-ok so cold starts cannot show a thinner public set
  try {
    const { loadProbeState } = await import("./probe");
    const s = await loadProbeState();
    if (s?.results) merged = absorbProbeResults(merged, s.results as any);
  } catch {
    /* */
  }

  if (merged.day !== utcDay()) {
    merged = { ...merged, day: utcDay(), updated_at: new Date().toISOString() };
  }
  merged.counts = recount(merged.items);
  mem = merged;
  return { ...merged, counts: recount(merged.items) };
}

export async function saveCleanRegistry(reg: CleanRegistry): Promise<void> {
  const current = await loadCleanRegistry();
  const merged = mergeClean(current, reg);
  merged.updated_at = new Date().toISOString();
  merged.counts = recount(merged.items);
  mem = merged;
  await saveDurableJson(DURABLE_NAME, merged);
}

/** Raise after probe handshake ok. */
export async function raiseClean(item: CleanItem): Promise<CleanRegistry> {
  if (!item?.id || item.handshake !== "ok" || isAliasId(item.id)) {
    return loadCleanRegistry();
  }
  const cur = await loadCleanRegistry();
  const prev = cur.items[item.id];
  if (prev && (prev.probed_at || "") > (item.probed_at || "")) return cur;
  cur.items[item.id] = {
    id: item.id,
    kind: item.kind === "agent" ? "agent" : "mcp",
    name: item.name || prev?.name || item.id,
    target: item.target || prev?.target || "",
    probed_at: item.probed_at || new Date().toISOString(),
    score: item.score ?? prev?.score ?? 0,
    handshake: "ok",
  };
  cur.counts = recount(cur.items);
  await saveCleanRegistry(cur);
  return cur;
}

/** Remove only on confirmed probe fail. */
export async function removeCleanOnFail(id: string): Promise<CleanRegistry> {
  if (!id || isAliasId(id)) return loadCleanRegistry();
  const cur = await loadCleanRegistry();
  if (!cur.items[id]) return cur;
  delete cur.items[id];
  cur.counts = recount(cur.items);
  await saveCleanRegistry(cur);
  return cur;
}

/** Full sync after a probe tick — absorb all ok, drop only ids that now fail. */
export async function syncCleanFromProbeResults(
  results: Record<string, any>,
): Promise<CleanRegistry> {
  let cur = await loadCleanRegistry();
  cur = absorbProbeResults(cur, results || {});

  // Remove only if we have an explicit fail/partial for that id (not missing)
  for (const [k, r] of Object.entries(results || {})) {
    if (!r) continue;
    const id = String(r.id || k);
    if (isAliasId(id) || isAliasId(k)) continue;
    if (
      (r.handshake === "fail" || r.handshake === "partial" || r.ok === false) &&
      r.handshake !== "skip" &&
      cur.items[id]
    ) {
      // Only drop if this fail is NEWER than the clean entry
      const failAt = r.probed_at || "";
      const cleanAt = cur.items[id]?.probed_at || "";
      if (failAt >= cleanAt) {
        delete cur.items[id];
      }
    }
  }
  cur.counts = recount(cur.items);
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
