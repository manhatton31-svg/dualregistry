/**
 * Live high-water counters — single source of truth across Vercel instances.
 *
 * Backends (first available wins):
 *  1. Upstash Redis (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or REDIS_URL)
 *  2. GitHub Contents CAS on data/prod/live-counters.json (shared by all instances)
 *  3. Process memory + counter-floors durable (last resort)
 *
 * RULE: probes_used / live_ok / delisted_count never decrease within a UTC day
 * (live + delisted never decrease across days either).
 */
import { Redis } from "@upstash/redis";
import { dataRoot } from "@/lib/data-root";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

const LOCAL_PATH = join(dataRoot(), "live-counters.json");
const GH_PATH = "data/prod/live-counters.json";
const REPO =
  process.env.DURABLE_GITHUB_REPO || "manhatton31-svg/dualregistry";
const BRANCH = process.env.DURABLE_GITHUB_BRANCH || "main";

export type LiveCounters = {
  day: string;
  probes_used: number;
  live_ok: number;
  live_mcp: number;
  live_agents: number;
  delisted_count: number;
  updated_at: string;
  backend?: string;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function empty(day = utcDay()): LiveCounters {
  return {
    day,
    probes_used: 0,
    live_ok: 0,
    live_mcp: 0,
    live_agents: 0,
    delisted_count: 0,
    updated_at: new Date().toISOString(),
  };
}

/** Pure max-merge — never decreases high-water marks */
export function mergeCounters(a: LiveCounters, b: LiveCounters): LiveCounters {
  const day = utcDay();
  let probes = 0;
  if (a.day === day) probes = Math.max(probes, Number(a.probes_used) || 0);
  if (b.day === day) probes = Math.max(probes, Number(b.probes_used) || 0);
  return {
    day: a.day === day || b.day === day ? day : a.day || b.day || day,
    probes_used: probes,
    live_ok: Math.max(Number(a.live_ok) || 0, Number(b.live_ok) || 0),
    live_mcp: Math.max(Number(a.live_mcp) || 0, Number(b.live_mcp) || 0),
    live_agents: Math.max(
      Number(a.live_agents) || 0,
      Number(b.live_agents) || 0,
    ),
    delisted_count: Math.max(
      Number(a.delisted_count) || 0,
      Number(b.delisted_count) || 0,
    ),
    updated_at: new Date().toISOString(),
    backend: a.backend || b.backend,
  };
}

let mem: LiveCounters | null = null;
let redis: Redis | null | undefined;
let saveChain: Promise<void> = Promise.resolve();

function ghToken(): string | undefined {
  return (
    process.env.DURABLE_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    undefined
  );
}

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  try {
    const url =
      process.env.UPSTASH_REDIS_REST_URL ||
      process.env.KV_REST_API_URL ||
      process.env.REDIS_REST_URL;
    const token =
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      process.env.KV_REST_API_TOKEN ||
      process.env.REDIS_REST_TOKEN;
    if (url && token) {
      redis = new Redis({ url, token });
      return redis;
    }
    // redis:// URLs need a different client — Upstash also accepts fromEnv
    if (process.env.REDIS_URL?.startsWith("https://")) {
      // some providers put REST url in REDIS_URL
      const t = process.env.REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
      if (t) {
        redis = new Redis({ url: process.env.REDIS_URL, token: t });
        return redis;
      }
    }
  } catch {
    /* */
  }
  redis = null;
  return null;
}

const RKEY = {
  used: (day: string) => `dr:probes_used:${day}`,
  live: "dr:live_ok",
  liveMcp: "dr:live_mcp",
  liveAgents: "dr:live_agents",
  delisted: "dr:delisted_count",
};

/** Atomic max: set key to max(current, n) via GET+SET retry (Upstash has no native MAX) */
async function redisMax(key: string, n: number): Promise<number> {
  const r = getRedis();
  if (!r) return n;
  let best = Math.floor(n) || 0;
  for (let i = 0; i < 6; i++) {
    const cur = Number((await r.get<number | string>(key)) || 0) || 0;
    best = Math.max(best, cur);
    if (best <= cur && i > 0) return best;
    await r.set(key, best);
    const verify = Number((await r.get<number | string>(key)) || 0) || 0;
    if (verify >= best) return verify;
    best = Math.max(best, verify);
  }
  return best;
}

async function redisGetAll(day: string): Promise<Partial<LiveCounters> | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const [used, live, mcp, agents, del] = await Promise.all([
      r.get<number | string>(RKEY.used(day)),
      r.get<number | string>(RKEY.live),
      r.get<number | string>(RKEY.liveMcp),
      r.get<number | string>(RKEY.liveAgents),
      r.get<number | string>(RKEY.delisted),
    ]);
    return {
      day,
      probes_used: Number(used) || 0,
      live_ok: Number(live) || 0,
      live_mcp: Number(mcp) || 0,
      live_agents: Number(agents) || 0,
      delisted_count: Number(del) || 0,
      backend: "upstash",
    };
  } catch {
    return null;
  }
}

async function redisRaise(partial: Partial<LiveCounters>): Promise<LiveCounters> {
  const day = utcDay();
  const used = await redisMax(
    RKEY.used(day),
    Number(partial.probes_used) || 0,
  );
  const live = await redisMax(RKEY.live, Number(partial.live_ok) || 0);
  const mcp = await redisMax(RKEY.liveMcp, Number(partial.live_mcp) || 0);
  const agents = await redisMax(
    RKEY.liveAgents,
    Number(partial.live_agents) || 0,
  );
  const del = await redisMax(
    RKEY.delisted,
    Number(partial.delisted_count) || 0,
  );
  return {
    day,
    probes_used: used,
    live_ok: live,
    live_mcp: mcp,
    live_agents: agents,
    delisted_count: del,
    updated_at: new Date().toISOString(),
    backend: "upstash",
  };
}

type GhBlob = LiveCounters & { _sha?: string };

async function ghGet(): Promise<GhBlob | null> {
  const token = ghToken();
  const url = `https://api.github.com/repos/${REPO}/contents/${GH_PATH}?ref=${BRANCH}`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "user-agent": "DualRegistryLiveCounter/1.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      // try raw without sha
      const raw = await fetch(
        `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${GH_PATH}?t=${Date.now()}`,
        {
          headers: { "cache-control": "no-cache", "user-agent": "DualRegistryLiveCounter/1.0" },
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!raw.ok) return null;
      const j = (await raw.json()) as LiveCounters;
      return { ...j, backend: "github-cas" };
    }
    const meta = (await res.json()) as { sha?: string; content?: string };
    if (!meta.content) return null;
    const text = Buffer.from(meta.content, "base64").toString("utf8");
    const j = JSON.parse(text) as LiveCounters;
    return { ...j, _sha: meta.sha, backend: "github-cas" };
  } catch {
    return null;
  }
}

async function ghCasPut(data: LiveCounters, sha?: string): Promise<boolean> {
  const token = ghToken();
  if (!token) return false;
  const api = `https://api.github.com/repos/${REPO}/contents/${GH_PATH}`;
  const body: Record<string, unknown> = {
    message: `chore(prod): live-counters max probes=${data.probes_used} live=${data.live_ok}`,
    content: Buffer.from(JSON.stringify(data, null, 2), "utf8").toString(
      "base64",
    ),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  try {
    const res = await fetch(api, {
      method: "PUT",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "DualRegistryLiveCounter/1.0",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    // 409 = conflict — need retry with fresh sha
    return res.ok;
  } catch {
    return false;
  }
}

/** GitHub CAS raise — retries until max is durable */
async function ghRaise(partial: Partial<LiveCounters>): Promise<LiveCounters> {
  const day = utcDay();
  let best = mergeCounters(empty(day), {
    ...empty(day),
    ...partial,
    day,
  } as LiveCounters);
  if (mem) best = mergeCounters(best, mem);

  for (let i = 0; i < 8; i++) {
    const remote = await ghGet();
    if (remote) {
      const { _sha, ...rest } = remote;
      best = mergeCounters(best, rest as LiveCounters);
      const ok = await ghCasPut(
        { ...best, backend: "github-cas", updated_at: new Date().toISOString() },
        _sha,
      );
      if (ok) {
        mem = best;
        await writeLocal(best);
        return { ...best, backend: "github-cas" };
      }
      // conflict — loop
      continue;
    }
    // no remote file yet
    const ok = await ghCasPut({
      ...best,
      backend: "github-cas",
      updated_at: new Date().toISOString(),
    });
    if (ok) {
      mem = best;
      await writeLocal(best);
      return { ...best, backend: "github-cas" };
    }
  }
  mem = best;
  await writeLocal(best);
  return { ...best, backend: "github-cas-local" };
}

async function writeLocal(c: LiveCounters) {
  try {
    await mkdir(dirname(LOCAL_PATH), { recursive: true });
    const tmp = `${LOCAL_PATH}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(c, null, 2), "utf8");
    await rename(tmp, LOCAL_PATH);
  } catch {
    /* */
  }
}

async function readLocal(): Promise<LiveCounters | null> {
  try {
    return JSON.parse(await readFile(LOCAL_PATH, "utf8")) as LiveCounters;
  } catch {
    return null;
  }
}

/**
 * Load high-water counters from Redis → GitHub → local → mem.
 * Always merges max.
 */
export async function loadLiveCounters(): Promise<LiveCounters> {
  const day = utcDay();
  let c = empty(day);

  const local = await readLocal();
  if (local) c = mergeCounters(c, local);

  if (mem) c = mergeCounters(c, mem);

  const r = await redisGetAll(day);
  if (r) c = mergeCounters(c, { ...empty(day), ...r } as LiveCounters);

  const gh = await ghGet();
  if (gh) {
    const { _sha, ...rest } = gh;
    c = mergeCounters(c, rest as LiveCounters);
  }

  // Also pull durable floors
  try {
    const { loadCounterFloors } = await import("./counter-floors");
    const f = await loadCounterFloors();
    c = mergeCounters(c, {
      day: f.day === day ? day : day,
      probes_used: f.day === day ? f.used_floor || 0 : 0,
      live_ok: f.live_floor?.total || 0,
      live_mcp: f.live_floor?.mcp || 0,
      live_agents: f.live_floor?.agents || 0,
      delisted_count: f.delisted_floor || 0,
      updated_at: f.updated_at || new Date().toISOString(),
    });
  } catch {
    /* */
  }

  // Day rollover for probes_used only
  if (c.day !== day) {
    c = {
      ...c,
      day,
      probes_used: 0,
    };
    // re-apply today's sources
    if (local?.day === day)
      c.probes_used = Math.max(c.probes_used, local.probes_used || 0);
    if (r && r.day === day)
      c.probes_used = Math.max(c.probes_used, Number(r.probes_used) || 0);
  }

  c.backend =
    getRedis() ? "upstash" : ghToken() ? "github-cas" : "local";
  mem = c;
  return { ...c };
}

/**
 * Raise counters to at least these values (atomic max). Returns new high-water.
 */
export async function raiseLiveCounters(partial: {
  probes_used?: number;
  live_ok?: number;
  live_mcp?: number;
  live_agents?: number;
  delisted_count?: number;
}): Promise<LiveCounters> {
  const day = utcDay();
  const incoming: LiveCounters = {
    ...empty(day),
    probes_used: Number(partial.probes_used) || 0,
    live_ok: Number(partial.live_ok) || 0,
    live_mcp: Number(partial.live_mcp) || 0,
    live_agents: Number(partial.live_agents) || 0,
    delisted_count: Number(partial.delisted_count) || 0,
  };

  // Serialize raises in-process
  let result: LiveCounters = incoming;
  saveChain = saveChain.then(async () => {
    const current = await loadLiveCounters();
    let next = mergeCounters(current, incoming);

    // 1) Redis first when available
    if (getRedis()) {
      const r = await redisRaise(next);
      next = mergeCounters(next, r);
    }

    // 2) Always GitHub CAS when token present (shared across all Vercel instances)
    if (ghToken()) {
      const g = await ghRaise(next);
      next = mergeCounters(next, g);
    }

    // 3) Durable floors stay in sync
    try {
      const {
        raiseUsedFloor,
        raiseLiveFloor,
        raiseDelistedFloor,
      } = await import("./counter-floors");
      await raiseUsedFloor(next.probes_used);
      await raiseLiveFloor({
        total: next.live_ok,
        mcp: next.live_mcp,
        agents: next.live_agents,
      });
      await raiseDelistedFloor(next.delisted_count);
    } catch {
      /* */
    }

    next.updated_at = new Date().toISOString();
    next.backend = getRedis()
      ? ghToken()
        ? "upstash+github"
        : "upstash"
      : ghToken()
        ? "github-cas"
        : "local";
    mem = next;
    await writeLocal(next);
    result = next;
  });
  await saveChain;
  return result;
}

export function liveCounterBackend(): string {
  if (getRedis()) return ghToken() ? "upstash+github" : "upstash";
  if (ghToken()) return "github-cas";
  return "local";
}

/**
 * Red-team pure merge: 77 vs stale 70 → 77.
 */
export function redTeamLiveCounter(): {
  ok: boolean;
  detail: string;
  after: number;
} {
  const day = utcDay();
  const high: LiveCounters = {
    ...empty(day),
    probes_used: 77,
    live_ok: 42,
    delisted_count: 287,
  };
  const stale: LiveCounters = {
    ...empty(day),
    probes_used: 70,
    live_ok: 10,
    delisted_count: 50,
  };
  const m = mergeCounters(high, stale);
  const m2 = mergeCounters(stale, high);
  const ok =
    m.probes_used >= 77 &&
    m2.probes_used >= 77 &&
    m.live_ok >= 42 &&
    m.delisted_count >= 287;
  return {
    ok,
    after: m.probes_used,
    detail: ok
      ? "PASS: merge keeps probes_used≥77 under stale 70 reload"
      : `FAIL after=${m.probes_used}`,
  };
}
