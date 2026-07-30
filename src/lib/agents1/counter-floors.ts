/**
 * Durable high-water counters — ABSOLUTE source of truth for used / Live / delisted.
 *
 * RULE: within a UTC day, used_floor only ever increases.
 * Live + delisted never decrease (even across days).
 *
 * Every save re-fetches remote and takes max() so concurrent Vercel instances
 * cannot last-write-wins a lower value (the 77→76 bug).
 */
import { loadDurableJson, saveDurableJson, durableRemoteRawUrl } from "./durable-json";
import { dataRoot } from "@/lib/data-root";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

const DURABLE_NAME = "counter-floors.json";
const LOCAL_PATH = join(dataRoot(), DURABLE_NAME);

export type CounterFloors = {
  day: string;
  /** Probes that spent budget today — never decreases same day */
  used_floor: number;
  /** High-water Live (probe-ok) counts — never decrease */
  live_floor: { total: number; mcp: number; agents: number; at: string };
  /** High-water delisted unique count — never decrease */
  delisted_floor: number;
  blocked_urls: string[];
  blocked_ids: string[];
  updated_at: string;
  /** Monotonic generation for debugging races */
  gen?: number;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function empty(day = utcDay()): CounterFloors {
  return {
    day,
    used_floor: 0,
    live_floor: { total: 0, mcp: 0, agents: 0, at: new Date().toISOString() },
    delisted_floor: 0,
    blocked_urls: [],
    blocked_ids: [],
    updated_at: new Date().toISOString(),
    gen: 0,
  };
}

/** Pure merge — used is max for same day only */
export function mergeFloors(a: CounterFloors, b: CounterFloors): CounterFloors {
  const day = utcDay();
  let used = 0;
  if (a.day === day) used = Math.max(used, Number(a.used_floor) || 0);
  if (b.day === day) used = Math.max(used, Number(b.used_floor) || 0);
  // If neither is today, keep higher of any same-day pair is 0 — ok
  // Cross-day: also preserve higher used if both claim same day string mismatch edge
  if (a.day === b.day && a.day !== day) {
    used = Math.max(Number(a.used_floor) || 0, Number(b.used_floor) || 0);
  }
  const live = {
    total: Math.max(a.live_floor?.total || 0, b.live_floor?.total || 0),
    mcp: Math.max(a.live_floor?.mcp || 0, b.live_floor?.mcp || 0),
    agents: Math.max(a.live_floor?.agents || 0, b.live_floor?.agents || 0),
    at:
      (a.live_floor?.at || "") >= (b.live_floor?.at || "")
        ? a.live_floor?.at || new Date().toISOString()
        : b.live_floor?.at || new Date().toISOString(),
  };
  return {
    day: a.day === day || b.day === day ? day : a.day || b.day || day,
    used_floor: used,
    live_floor: live,
    delisted_floor: Math.max(
      Number(a.delisted_floor) || 0,
      Number(b.delisted_floor) || 0,
    ),
    blocked_urls: [
      ...new Set([...(a.blocked_urls || []), ...(b.blocked_urls || [])]),
    ].slice(0, 5000),
    blocked_ids: [
      ...new Set([...(a.blocked_ids || []), ...(b.blocked_ids || [])]),
    ].slice(0, 5000),
    updated_at: new Date().toISOString(),
    gen: Math.max(Number(a.gen) || 0, Number(b.gen) || 0) + 1,
  };
}

let mem: CounterFloors | null = null;
let saveChain: Promise<void> = Promise.resolve();

async function fetchRemoteFloors(): Promise<CounterFloors | null> {
  try {
    const url = durableRemoteRawUrl(DURABLE_NAME) + `?t=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryFloors/1.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<!")) return null;
    return JSON.parse(text) as CounterFloors;
  } catch {
    return null;
  }
}

export async function loadCounterFloors(): Promise<CounterFloors> {
  const day = utcDay();
  let local: CounterFloors | null = null;
  try {
    const raw = await readFile(LOCAL_PATH, "utf8");
    local = JSON.parse(raw) as CounterFloors;
  } catch {
    /* */
  }
  let remote: CounterFloors | null = null;
  try {
    remote = await loadDurableJson<CounterFloors>(DURABLE_NAME, () => empty());
    if (remote && !remote.day) remote = null;
  } catch {
    /* */
  }
  // Always also force raw.githubusercontent (bypass loadDurable local-only short-circuit)
  const remoteFresh = await fetchRemoteFloors();
  if (remoteFresh) {
    remote = remote ? mergeFloors(remote, remoteFresh) : remoteFresh;
  }

  let m = mergeFloors(local || empty(), remote || empty());
  if (mem) m = mergeFloors(m, mem);

  // Day rollover: reset used only; keep live/delisted/blocks forever
  if (m.day !== day) {
    m = {
      ...m,
      day,
      used_floor: 0,
    };
    // But re-apply remote/local if they are already on today
    if (local?.day === day)
      m.used_floor = Math.max(m.used_floor, Number(local.used_floor) || 0);
    if (remote?.day === day)
      m.used_floor = Math.max(m.used_floor, Number(remote.used_floor) || 0);
    if (mem?.day === day)
      m.used_floor = Math.max(m.used_floor, Number(mem.used_floor) || 0);
  }
  mem = m;
  return { ...m };
}

/**
 * Atomic high-water save: re-read remote + local + mem, take max, then write.
 * Serialized via saveChain so concurrent raises cannot regress.
 */
export async function saveCounterFloors(f: CounterFloors): Promise<void> {
  saveChain = saveChain.then(async () => {
    const day = utcDay();
    let local: CounterFloors | null = null;
    try {
      local = JSON.parse(await readFile(LOCAL_PATH, "utf8")) as CounterFloors;
    } catch {
      /* */
    }
    const remote = await fetchRemoteFloors();
    let merged = mergeFloors(f, local || empty());
    if (remote) merged = mergeFloors(merged, remote);
    if (mem) merged = mergeFloors(merged, mem);
    if (merged.day !== day) {
      // keep used only if f/local/remote claim today
      let used = 0;
      for (const x of [f, local, remote, mem]) {
        if (x && x.day === day)
          used = Math.max(used, Number(x.used_floor) || 0);
      }
      merged = { ...merged, day, used_floor: used };
    }
    // Hard clamp: never write lower used than any source same day
    merged.used_floor = Math.max(
      Number(merged.used_floor) || 0,
      f.day === day ? Number(f.used_floor) || 0 : 0,
      mem?.day === day ? Number(mem.used_floor) || 0 : 0,
    );
    merged.updated_at = new Date().toISOString();
    mem = merged;
    try {
      await mkdir(dirname(LOCAL_PATH), { recursive: true });
      const tmp = `${LOCAL_PATH}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify(merged, null, 2), "utf8");
      await rename(tmp, LOCAL_PATH);
    } catch {
      /* */
    }
    try {
      await saveDurableJson(DURABLE_NAME, merged);
    } catch {
      /* */
    }
  });
  await saveChain;
}

/** Raise used floor (same day). Returns new floor — never lower than before. */
export async function raiseUsedFloor(n: number): Promise<number> {
  const day = utcDay();
  const f = await loadCounterFloors();
  const next = Math.max(
    f.day === day ? Number(f.used_floor) || 0 : 0,
    Math.floor(n) || 0,
    mem?.day === day ? Number(mem.used_floor) || 0 : 0,
  );
  const out: CounterFloors = {
    ...f,
    day,
    used_floor: next,
  };
  await saveCounterFloors(out);
  // Re-load to confirm max stuck
  const after = await loadCounterFloors();
  return Math.max(next, after.used_floor || 0);
}

/** Live high-water — never decreases. */
export async function raiseLiveFloor(live: {
  total: number;
  mcp: number;
  agents: number;
}): Promise<CounterFloors["live_floor"]> {
  const f = await loadCounterFloors();
  const out: CounterFloors = {
    ...f,
    live_floor: {
      total: Math.max(f.live_floor?.total || 0, live.total || 0),
      mcp: Math.max(f.live_floor?.mcp || 0, live.mcp || 0),
      agents: Math.max(f.live_floor?.agents || 0, live.agents || 0),
      at: new Date().toISOString(),
    },
  };
  await saveCounterFloors(out);
  const after = await loadCounterFloors();
  return after.live_floor;
}

/** Delisted high-water. */
export async function raiseDelistedFloor(n: number): Promise<number> {
  const f = await loadCounterFloors();
  const out: CounterFloors = {
    ...f,
    delisted_floor: Math.max(
      Number(f.delisted_floor) || 0,
      Math.floor(n) || 0,
    ),
  };
  await saveCounterFloors(out);
  const after = await loadCounterFloors();
  return after.delisted_floor;
}

export async function blockProbeTarget(input: {
  id?: string;
  url?: string;
}): Promise<void> {
  const f = await loadCounterFloors();
  const blocked_ids = [...(f.blocked_ids || [])];
  const blocked_urls = [...(f.blocked_urls || [])];
  if (input.id) blocked_ids.push(input.id);
  if (input.url) blocked_urls.push(input.url.split("?")[0]!.toLowerCase());
  await saveCounterFloors({
    ...f,
    blocked_ids: [...new Set(blocked_ids)].slice(0, 5000),
    blocked_urls: [...new Set(blocked_urls)].slice(0, 5000),
  });
}

export function isBlockedSync(
  f: CounterFloors,
  input: { id?: string; urls?: string[] },
): boolean {
  if (input.id && f.blocked_ids?.includes(input.id)) return true;
  for (const raw of input.urls || []) {
    const u = raw.split("?")[0]!.toLowerCase();
    if (f.blocked_urls?.includes(u)) return true;
    if (f.blocked_urls?.some((b) => u.startsWith(b) || b.startsWith(u)))
      return true;
  }
  return false;
}

export async function isBlocked(input: {
  id?: string;
  urls?: string[];
}): Promise<boolean> {
  const f = await loadCounterFloors();
  return isBlockedSync(f, input);
}

/**
 * Red-team: simulate cold instance with stale lower used; assert floor holds.
 * Returns true if monotonic invariant holds.
 */
export function redTeamMonotonicUsed(): {
  ok: boolean;
  before: number;
  after: number;
  detail: string;
} {
  const day = utcDay();
  const high: CounterFloors = {
    ...empty(day),
    used_floor: 50,
    live_floor: { total: 40, mcp: 20, agents: 20, at: new Date().toISOString() },
  };
  const stale: CounterFloors = {
    ...empty(day),
    used_floor: 30,
    live_floor: { total: 10, mcp: 5, agents: 5, at: new Date().toISOString() },
  };
  const merged = mergeFloors(high, stale);
  const ok =
    merged.used_floor >= 50 &&
    merged.live_floor.total >= 40 &&
    merged.live_floor.mcp >= 20 &&
    merged.live_floor.agents >= 20;
  return {
    ok,
    before: 50,
    after: merged.used_floor,
    detail: ok
      ? "mergeFloors keeps high-water used=50 and live=40 under stale reload"
      : `FAIL used=${merged.used_floor} live=${merged.live_floor.total}`,
  };
}
