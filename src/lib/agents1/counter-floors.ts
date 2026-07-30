/**
 * Durable high-water counters — the only numbers the dashboard may display
 * for used / Live / delisted. They never go down within a day (used) or
 * ever (Live, delisted) unless day rolls for used.
 *
 * Prevents multi-instance /tmp + stale GitHub hydrate from flapping cards.
 */
import { loadDurableJson, saveDurableJson } from "./durable-json";
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
  /** URL keys permanently blocked from discovery probes */
  blocked_urls: string[];
  /** Listing ids permanently blocked until resubmit (fail/partial) */
  blocked_ids: string[];
  updated_at: string;
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
  };
}

function mergeFloors(a: CounterFloors, b: CounterFloors): CounterFloors {
  const day = utcDay();
  // used: max if same day; prefer current day values
  let used = 0;
  if (a.day === day) used = Math.max(used, a.used_floor || 0);
  if (b.day === day) used = Math.max(used, b.used_floor || 0);
  const live = {
    total: Math.max(a.live_floor?.total || 0, b.live_floor?.total || 0),
    mcp: Math.max(a.live_floor?.mcp || 0, b.live_floor?.mcp || 0),
    agents: Math.max(a.live_floor?.agents || 0, b.live_floor?.agents || 0),
    at:
      (a.live_floor?.at || "") >= (b.live_floor?.at || "")
        ? a.live_floor?.at || new Date().toISOString()
        : b.live_floor?.at || new Date().toISOString(),
  };
  const blocked_urls = [
    ...new Set([...(a.blocked_urls || []), ...(b.blocked_urls || [])]),
  ].slice(0, 5000);
  const blocked_ids = [
    ...new Set([...(a.blocked_ids || []), ...(b.blocked_ids || [])]),
  ].slice(0, 5000);
  return {
    day,
    used_floor: used,
    live_floor: live,
    delisted_floor: Math.max(a.delisted_floor || 0, b.delisted_floor || 0),
    blocked_urls,
    blocked_ids,
    updated_at: new Date().toISOString(),
  };
}

let mem: CounterFloors | null = null;

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
  let m = mergeFloors(local || empty(), remote || empty());
  if (mem) m = mergeFloors(m, mem);
  if (m.day !== day) {
    m = {
      ...m,
      day,
      used_floor: 0, // new day
      // live + delisted + blocks carry forward forever
    };
  }
  mem = m;
  return m;
}

export async function saveCounterFloors(f: CounterFloors): Promise<void> {
  f.updated_at = new Date().toISOString();
  mem = f;
  try {
    await mkdir(dirname(LOCAL_PATH), { recursive: true });
    const tmp = `${LOCAL_PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(f, null, 2), "utf8");
    await rename(tmp, LOCAL_PATH);
  } catch {
    /* */
  }
  try {
    await saveDurableJson(DURABLE_NAME, f);
  } catch {
    /* */
  }
}

/** Raise used floor (same day). Returns new floor. */
export async function raiseUsedFloor(n: number): Promise<number> {
  const f = await loadCounterFloors();
  const day = utcDay();
  if (f.day !== day) {
    f.day = day;
    f.used_floor = 0;
  }
  f.used_floor = Math.max(f.used_floor || 0, Math.floor(n) || 0);
  await saveCounterFloors(f);
  return f.used_floor;
}

/** Live high-water — never decreases. */
export async function raiseLiveFloor(live: {
  total: number;
  mcp: number;
  agents: number;
}): Promise<CounterFloors["live_floor"]> {
  const f = await loadCounterFloors();
  f.live_floor = {
    total: Math.max(f.live_floor?.total || 0, live.total || 0),
    mcp: Math.max(f.live_floor?.mcp || 0, live.mcp || 0),
    agents: Math.max(f.live_floor?.agents || 0, live.agents || 0),
    at: new Date().toISOString(),
  };
  await saveCounterFloors(f);
  return f.live_floor;
}

/** Delisted high-water. */
export async function raiseDelistedFloor(n: number): Promise<number> {
  const f = await loadCounterFloors();
  f.delisted_floor = Math.max(f.delisted_floor || 0, Math.floor(n) || 0);
  await saveCounterFloors(f);
  return f.delisted_floor;
}

/** Permanently block a URL + id from discovery probing. */
export async function blockProbeTarget(input: {
  id?: string;
  url?: string;
}): Promise<void> {
  const f = await loadCounterFloors();
  if (input.id) {
    f.blocked_ids = [...new Set([...(f.blocked_ids || []), input.id])].slice(
      0,
      5000,
    );
  }
  if (input.url) {
    const u = input.url.split("?")[0]!.toLowerCase();
    f.blocked_urls = [...new Set([...(f.blocked_urls || []), u])].slice(0, 5000);
  }
  await saveCounterFloors(f);
}

export function isBlockedSync(
  f: CounterFloors,
  input: { id?: string; urls?: string[] },
): boolean {
  if (input.id && f.blocked_ids?.includes(input.id)) return true;
  for (const raw of input.urls || []) {
    const u = raw.split("?")[0]!.toLowerCase();
    if (f.blocked_urls?.includes(u)) return true;
    // prefix match for smithery path trees that 404
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
