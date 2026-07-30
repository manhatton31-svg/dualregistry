/**
 * Display authority — READ-ONLY high-water for all public numbers.
 *
 * RULES:
 * 1. GET/dashboard/probes NEVER mutate counters (no raise on read).
 * 2. Display value = max(all known sources) including process memory.
 * 3. Within a UTC day, process memory never decreases used/live/delisted.
 * 4. Store approved totals are high-water (never flap down).
 * 5. last_tick_at is high-water (ISO string max) — never goes backwards.
 *
 * Writes only happen on real probe ticks / delist / prefilter via raise* APIs.
 */
import { durableRemoteRawUrl } from "./durable-json";

export type DisplayAuthority = {
  day: string;
  used: number;
  live_total: number;
  live_mcp: number;
  live_agents: number;
  delisted_total: number;
  store_mcp: number;
  store_agents: number;
  last_tick_at?: string;
  updated_at: string;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Process-local high-water — survives within one Vercel instance */
let mem: DisplayAuthority | null = null;

function empty(day = utcDay()): DisplayAuthority {
  return {
    day,
    used: 0,
    live_total: 0,
    live_mcp: 0,
    live_agents: 0,
    delisted_total: 0,
    store_mcp: 0,
    store_agents: 0,
    updated_at: new Date().toISOString(),
  };
}

function maxIso(a?: string | null, b?: string | null): string | undefined {
  const aa = a || "";
  const bb = b || "";
  if (!aa && !bb) return undefined;
  return aa >= bb ? aa || undefined : bb || undefined;
}

/** Pure max merge */
export function maxAuthority(
  a: DisplayAuthority,
  b: Partial<DisplayAuthority> | null | undefined,
): DisplayAuthority {
  if (!b) return a;
  const day = utcDay();
  let used = 0;
  if (a.day === day) used = Math.max(used, a.used || 0);
  if ((b.day || day) === day) used = Math.max(used, Number(b.used) || 0);
  return {
    day,
    used,
    live_total: Math.max(a.live_total || 0, Number(b.live_total) || 0),
    live_mcp: Math.max(a.live_mcp || 0, Number(b.live_mcp) || 0),
    live_agents: Math.max(a.live_agents || 0, Number(b.live_agents) || 0),
    delisted_total: Math.max(
      a.delisted_total || 0,
      Number(b.delisted_total) || 0,
    ),
    store_mcp: Math.max(a.store_mcp || 0, Number(b.store_mcp) || 0),
    store_agents: Math.max(a.store_agents || 0, Number(b.store_agents) || 0),
    last_tick_at: maxIso(a.last_tick_at, b.last_tick_at),
    updated_at: new Date().toISOString(),
  };
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryDisplayAuthority/1.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const t = await res.text();
    if (!t.trim() || t.trim().startsWith("<!")) return null;
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function newestTickLog(probes: any): string | undefined {
  let best = "";
  for (const t of probes?.tick_log || []) {
    const p = t?.probed_at || "";
    if (p > best) best = p;
  }
  // also scan results probed_at
  for (const r of Object.values(probes?.results || {}) as any[]) {
    const p = r?.probed_at || "";
    if (p > best) best = p;
  }
  return best || undefined;
}

/**
 * Read-only snapshot of high-water numbers from every durable source.
 * Does NOT write. Safe to call on every GET.
 */
export async function readDisplayAuthority(hints?: {
  used?: number;
  live_total?: number;
  live_mcp?: number;
  live_agents?: number;
  delisted_total?: number;
  store_mcp?: number;
  store_agents?: number;
  last_tick_at?: string;
}): Promise<DisplayAuthority> {
  const day = utcDay();
  let a = empty(day);
  if (mem) a = maxAuthority(a, mem);
  if (hints) a = maxAuthority(a, { ...hints, day });

  // GitHub durable (shared across all Vercel instances)
  const [probes, floors, livec, delisted] = await Promise.all([
    fetchJson(`${durableRemoteRawUrl("probes.json")}?t=${Date.now()}`),
    fetchJson(`${durableRemoteRawUrl("counter-floors.json")}?t=${Date.now()}`),
    fetchJson(`${durableRemoteRawUrl("live-counters.json")}?t=${Date.now()}`),
    fetchJson(`${durableRemoteRawUrl("delisted.json")}?t=${Date.now()}`),
  ]);

  if (probes) {
    const tickNewest = newestTickLog(probes);
    a = maxAuthority(a, {
      day: probes.day || day,
      used: probes.day === day ? Number(probes.used) || 0 : 0,
      live_total: probes.live_active_snapshot?.total,
      live_mcp: probes.live_active_snapshot?.mcp,
      live_agents: probes.live_active_snapshot?.agents,
      last_tick_at: maxIso(probes.last_tick_at, tickNewest),
    });
    // tick_log spend count as floor for used
    if (Array.isArray(probes.tick_log) && probes.day === day) {
      const spent = new Set<string>();
      for (const t of probes.tick_log) {
        if (!t?.spent_budget) continue;
        if (!(t.probed_at || "").startsWith(day)) continue;
        spent.add(`${t.probed_at}|${t.id}`);
      }
      a = maxAuthority(a, { day, used: spent.size });
    }
  }

  if (floors) {
    a = maxAuthority(a, {
      day: floors.day || day,
      used: floors.day === day ? Number(floors.used_floor) || 0 : 0,
      live_total: floors.live_floor?.total,
      live_mcp: floors.live_floor?.mcp,
      live_agents: floors.live_floor?.agents,
      delisted_total: floors.delisted_floor,
      store_mcp: floors.store_mcp_floor,
      store_agents: floors.store_agents_floor,
    });
  }

  if (livec) {
    a = maxAuthority(a, {
      day: livec.day || day,
      used: livec.day === day ? Number(livec.probes_used) || 0 : 0,
      live_total: livec.live_ok,
      live_mcp: livec.live_mcp,
      live_agents: livec.live_agents,
      delisted_total: livec.delisted_count,
    });
  }

  if (delisted) {
    const n = Math.max(
      (delisted.active_ids || []).length,
      (delisted.items || []).length,
    );
    a = maxAuthority(a, { day, delisted_total: n });
  }

  // Local files (this instance)
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { dataRoot } = await import("@/lib/data-root");
    for (const name of [
      "probes.json",
      "counter-floors.json",
      "live-counters.json",
      "delisted.json",
    ]) {
      try {
        const j = JSON.parse(await readFile(join(dataRoot(), name), "utf8"));
        if (name === "probes.json") {
          a = maxAuthority(a, {
            day: j.day || day,
            used: j.day === day ? Number(j.used) || 0 : 0,
            live_total: j.live_active_snapshot?.total,
            live_mcp: j.live_active_snapshot?.mcp,
            live_agents: j.live_active_snapshot?.agents,
            last_tick_at: maxIso(j.last_tick_at, newestTickLog(j)),
          });
        } else if (name === "counter-floors.json") {
          a = maxAuthority(a, {
            day: j.day || day,
            used: j.day === day ? Number(j.used_floor) || 0 : 0,
            live_total: j.live_floor?.total,
            live_mcp: j.live_floor?.mcp,
            live_agents: j.live_floor?.agents,
            delisted_total: j.delisted_floor,
            store_mcp: j.store_mcp_floor,
            store_agents: j.store_agents_floor,
          });
        } else if (name === "live-counters.json") {
          a = maxAuthority(a, {
            day: j.day || day,
            used: j.day === day ? Number(j.probes_used) || 0 : 0,
            live_total: j.live_ok,
            live_mcp: j.live_mcp,
            live_agents: j.live_agents,
            delisted_total: j.delisted_count,
          });
        } else if (name === "delisted.json") {
          const n = Math.max(
            (j.active_ids || []).length,
            (j.items || []).length,
          );
          a = maxAuthority(a, { day, delisted_total: n });
        }
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }

  // Bump process memory high-water (never decreases same day)
  if (mem && mem.day === day) {
    a = maxAuthority(mem, a);
  }
  mem = a;
  return { ...a };
}

/**
 * Observe numbers after a real write (probe tick / delist). Updates process mem only.
 * Durable raise still done by raiseUsedFloor / raiseLiveCounters.
 */
export function observeDisplayAuthority(partial: Partial<DisplayAuthority>): DisplayAuthority {
  const day = utcDay();
  let a = mem && mem.day === day ? mem : empty(day);
  a = maxAuthority(a, { ...partial, day });
  mem = a;
  return { ...a };
}
