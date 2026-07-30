/**
 * Live handshake probes (no store KV).
 *
 * Discovery: multi-probe per 6m tick · high daily cap · never-probed first → grow Active.
 * Goal: grow clean registry toward CLEAN_GROWTH_TARGET_PER_DAY (mixed agents+MCPs).
 * Only handshake ok + checks clean promote to the public list.
 * Weekly recheck: unlimited · every Active re-probed 7d after last ok.
 * Discovery always outranks weekly recheck when both are due.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateA2ACard } from "./a2a-card";
import { dataRoot } from "@/lib/data-root";
import {
  loadDurableJson,
  saveDurableJson,
  durableFileMtime,
} from "./durable-json";
import { nextProbeFromLast } from "./time-et";
import { preflightPatterns } from "./probe-preflight";
import {
  mergeProbeStates,
  countLiveFromResults,
  type MergeableProbeState,
} from "./probe-merge";
import { durableRemoteRawUrl } from "./durable-json";
import {
  appendTickLog,
  backfillTickLogFromResults,
  mergeTickLogs,
  type TickLogEntry,
} from "./tick-log";

export type { TickLogEntry } from "./tick-log";
export { appendTickLog, mergeTickLogs, backfillTickLogFromResults } from "./tick-log";

const PATH = join(dataRoot(), "probes.json");
const DURABLE_NAME = "probes.json";
const UA = "Agents1Probe/1.2 (+registry; reliability; balanced)";

/** Soft daily probe spend — high enough for 333 clean/day (most probes fail). */
export const MAX_PROBES_PER_DAY = 100_000;
/** Target clean listings (agents + MCPs) added per UTC day. */
export const CLEAN_GROWTH_TARGET_PER_DAY = 333;
/** Tick window — still serialize multi-instance via last_tick, but allow high volume per tick. */
export const PROBE_WINDOW_MS = 2 * 60_000;
/** Full handshake probes per tick (mixed agents+MCPs). Only ok → clean list. */
export const MAX_PROBES_PER_WINDOW = 48;
export const MAX_PROBES_PER_HOUR = MAX_PROBES_PER_WINDOW * 30;
export const PROBES_PER_TICK = MAX_PROBES_PER_WINDOW;
/** Short freshness window (hours) — discovery won't re-hit very recent oks */
const FRESH_OK_MS = 6 * 3600_000;
/** Active weekly recheck interval — unlimited queue, scales with Active count */
export const ACTIVE_REPROBE_MS = 7 * 24 * 3600_000;
const RETRY_DIRTY_MS = 90 * 60_000;

export type ProbePurpose = "discovery" | "weekly_recheck";

export type ProbeResult = {
  id: string;
  kind: "agent" | "mcp";
  target: string;
  ok: boolean;
  latency_ms: number;
  score: number;
  signals: string[];
  a2a_score?: number;
  handshake?: "ok" | "partial" | "fail" | "skip";
  protocol_hints: string[];
  namespace_verified?: boolean;
  github_stars?: number;
  has_license?: boolean;
  probed_at: string;
};

export type ProbeTarget = {
  id: string;
  kind?: "agent" | "mcp";
  name: string;
  agent_card_url?: string;
  endpoint_url?: string;
  remote_url?: string;
  website?: string;
  repository?: string;
  dirty?: boolean;
  priority_boost?: number;
  store_id?: string;
  /** discovery grows registry; weekly_recheck re-validates Actives (unlimited) */
  purpose?: ProbePurpose;
};

type ProbeState = {
  day: string;
  used: number;
  budget: number;
  hour_bucket: string;
  hourly_used: number;
  hourly_cap: number;
  results: Record<string, ProbeResult>;
  /**
   * Append-only chronological log of every full probe attempt.
   * Survives merges so the UI never shows multi-hour gaps when used climbs.
   */
  tick_log?: TickLogEntry[];
  updated_at: string;
  last_tick_at?: string;
  /** Only advanced on checks-clean ok — drives full 6-minute wait */
  last_ok_tick_at?: string;
  last_handshake?: "ok" | "partial" | "fail" | "skip";
  baseline_note?: string;
  wasted_probes_discarded?: number;
  real_active_only?: boolean;
  /** Unlimited weekly recheck counters (scale with Active; no cap) */
  weekly?: {
    week: string;
    rechecked: number;
    still_ok: number;
    demoted: number;
  };
  /** Stable Live card — updated on ticks, monotonic-friendly */
  live_active_snapshot?: {
    total: number;
    mcp: number;
    agents: number;
    at: string;
  };
};

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

/** ISO-like UTC week key YYYY-Www for weekly recheck stats */
export function utcWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function isWeeklyRecheckDue(
  prev: ProbeResult | undefined,
  now = Date.now(),
): boolean {
  if (!prev) return false;
  if (!(prev.handshake === "ok" && prev.ok)) return false;
  const age = now - Date.parse(prev.probed_at || "0");
  return Number.isFinite(age) && age >= ACTIVE_REPROBE_MS;
}

export function nextWeeklyRecheckAt(probed_at: string): string {
  const t = Date.parse(probed_at);
  if (!Number.isFinite(t)) return new Date().toISOString();
  return new Date(t + ACTIVE_REPROBE_MS).toISOString();
}

/** Floor UTC minutes to 6-minute slots */
function utcWindowBucket() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const slot = Math.floor(d.getUTCMinutes() / 6) * 6;
  return `${y}-${m}-${day}T${h}:${String(slot).padStart(2, "0")}`;
}

function utcHourBucket() {
  return utcWindowBucket();
}

function empty(): ProbeState {
  return {
    day: utcDay(),
    used: 0,
    budget: MAX_PROBES_PER_DAY,
    hour_bucket: utcHourBucket(),
    hourly_used: 0,
    hourly_cap: MAX_PROBES_PER_HOUR,
    results: {},
    updated_at: new Date().toISOString(),
  };
}

let mem: ProbeState | null = null;
let chain: Promise<void> = Promise.resolve();
let memMtime = 0;

async function fileMtime(): Promise<number> {
  const mt = await durableFileMtime(DURABLE_NAME);
  if (mt) return mt;
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(PATH)).mtimeMs || 0;
  } catch {
    return 0;
  }
}

/** Drop in-memory probe state so next read is from disk (Update / multi-process). */
export function invalidateProbeCache(): void {
  mem = null;
  memMtime = 0;
}

/** Always fetch GitHub durable probes (cache-busted) for merge. */
async function fetchRemoteProbeState(): Promise<MergeableProbeState | null> {
  const url = `${durableRemoteRawUrl(DURABLE_NAME)}?t=${Date.now()}`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryProbeMerge/1.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<!")) return null;
    return JSON.parse(text) as MergeableProbeState;
  } catch {
    return null;
  }
}

export async function loadProbeState(): Promise<ProbeState> {
  const day = utcDay();
  const hour = utcHourBucket();

  // Always read local + remote and merge (source of truth for multi-instance)
  let local: MergeableProbeState | null = null;
  try {
    const raw = await loadDurableJson<MergeableProbeState>(DURABLE_NAME, () => ({}));
    if (raw && Object.keys(raw).length) local = raw;
  } catch {
    /* */
  }
  // loadDurableJson only hydrates when local missing — also force remote merge
  const remote = await fetchRemoteProbeState();

  // Include in-memory if same day (this instance may be ahead of disk)
  const memPart: MergeableProbeState | null =
    mem && mem.day === day ? (mem as MergeableProbeState) : null;

  let merged = mergeProbeStates(local, remote, day);
  merged = mergeProbeStates(merged, memPart, day);

  // Day rollover: keep results, reset used counters for new day
  if (merged.day && merged.day !== day) {
    const prevResults = merged.results || {};
    merged = {
      ...empty(),
      results: prevResults,
      day,
      // carry live snapshot forward (still valid until re-probed)
      live_active_snapshot: merged.live_active_snapshot,
    };
  }

  // Live count: HIGH-WATER mark — never decrease once Live has grown
  const liveNow = countLiveFromResults(merged.results);
  const prevSnap = merged.live_active_snapshot;
  const liveMerged = {
    total: Math.max(prevSnap?.total || 0, liveNow.total),
    mcp: Math.max(prevSnap?.mcp || 0, liveNow.mcp),
    agents: Math.max(prevSnap?.agents || 0, liveNow.agents),
    at: new Date().toISOString(),
  };
  // Prefer floor from durable counters if higher
  try {
    const { loadCounterFloors } = await import("./counter-floors");
    const floors = await loadCounterFloors();
    liveMerged.total = Math.max(liveMerged.total, floors.live_floor?.total || 0);
    liveMerged.mcp = Math.max(liveMerged.mcp, floors.live_floor?.mcp || 0);
    liveMerged.agents = Math.max(
      liveMerged.agents,
      floors.live_floor?.agents || 0,
    );
    // used floor
    if (floors.day === day) {
      merged.used = Math.max(Number(merged.used) || 0, floors.used_floor || 0);
    }
  } catch {
    /* */
  }
  merged.live_active_snapshot = liveMerged;

  mem = {
    ...empty(),
    ...merged,
    day,
    budget: MAX_PROBES_PER_DAY,
    hourly_cap: MAX_PROBES_PER_HOUR,

    hour_bucket: merged.hour_bucket === hour ? (merged.hour_bucket as string) : hour,
    hourly_used:
      merged.hour_bucket === hour ? Number(merged.hourly_used) || 0 : 0,
    results: (merged.results || {}) as Record<string, ProbeResult>,
    tick_log: backfillTickLogFromResults(
      (merged.results || {}) as Record<string, ProbeResult>,
      mergeTickLogs(merged.tick_log, memPart?.tick_log),
    ),
    used: Number(merged.used) || 0,
    last_tick_at: merged.last_tick_at,
    last_ok_tick_at: merged.last_ok_tick_at,
    last_handshake: (["ok", "partial", "fail", "skip"] as const).includes(
      merged.last_handshake as "ok",
    )
      ? (merged.last_handshake as ProbeState["last_handshake"])
      : undefined,
    live_active_snapshot: merged.live_active_snapshot,
    weekly: merged.weekly as ProbeState["weekly"],
    updated_at: merged.updated_at || new Date().toISOString(),
  };

  // Write merged local so this instance is consistent (don't push every read)
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const path = join(dataRoot(), DURABLE_NAME);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(mem, null, 2), "utf8");
    memMtime = Date.now();
  } catch {
    /* */
  }

  return mem!;
}

async function persist(s: ProbeState) {
  // 1) Merge remote probes (max used)
  try {
    const remote = await fetchRemoteProbeState();
    if (remote && remote.day === s.day) {
      const merged = mergeProbeStates(s as MergeableProbeState, remote, s.day);
      s.used = Math.max(s.used, Number(merged.used) || 0);
      s.results = (merged.results || s.results) as Record<string, ProbeResult>;
      s.tick_log = mergeTickLogs(s.tick_log, (merged as MergeableProbeState).tick_log);
      s.last_tick_at = merged.last_tick_at || s.last_tick_at;
      if (merged.live_active_snapshot) {
        const a = s.live_active_snapshot;
        const b = merged.live_active_snapshot;
        s.live_active_snapshot = {
          total: Math.max(a?.total || 0, b.total || 0),
          mcp: Math.max(a?.mcp || 0, b.mcp || 0),
          agents: Math.max(a?.agents || 0, b.agents || 0),
          at: new Date().toISOString(),
        };
      }
    }
  } catch {
    /* */
  }
  // 2) Clamp to LIVE COUNTERS (Redis/GitHub CAS) + durable floors
  try {
    const { raiseLiveCounters, loadLiveCounters } = await import(
      "./live-counter"
    );
    const raised = await raiseLiveCounters({
      probes_used: s.used,
      live_ok: s.live_active_snapshot?.total || 0,
      live_mcp: s.live_active_snapshot?.mcp || 0,
      live_agents: s.live_active_snapshot?.agents || 0,
    });
    s.used = Math.max(s.used, raised.probes_used || 0);
    s.live_active_snapshot = {
      total: Math.max(
        s.live_active_snapshot?.total || 0,
        raised.live_ok || 0,
      ),
      mcp: Math.max(s.live_active_snapshot?.mcp || 0, raised.live_mcp || 0),
      agents: Math.max(
        s.live_active_snapshot?.agents || 0,
        raised.live_agents || 0,
      ),
      at: new Date().toISOString(),
    };
    // re-load in case another instance raised higher during our write
    const again = await loadLiveCounters();
    s.used = Math.max(s.used, again.probes_used || 0);
  } catch {
    // fallback floors only
    try {
      const { loadCounterFloors, raiseUsedFloor, raiseLiveFloor } = await import(
        "./counter-floors"
      );
      const floors = await loadCounterFloors();
      if (floors.day === s.day) {
        s.used = Math.max(s.used, floors.used_floor || 0);
      }
      await raiseUsedFloor(s.used);
      if (s.live_active_snapshot) {
        await raiseLiveFloor(s.live_active_snapshot);
      }
    } catch {
      /* */
    }
  }
  mem = s;
  s.updated_at = new Date().toISOString();
  chain = chain.then(async () => {
    // Never persist used below floor — re-clamp immediately before write
    try {
      const { loadCounterFloors } = await import("./counter-floors");
      const floors = await loadCounterFloors();
      if (floors.day === s.day) {
        s.used = Math.max(s.used, floors.used_floor || 0);
      }
    } catch {
      /* */
    }
    await saveDurableJson(DURABLE_NAME, s);
    try {
      await mkdir(dirname(PATH), { recursive: true });
      const tmp = `${PATH}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
      await rename(tmp, PATH);
    } catch {
      /* */
    }
    memMtime = (await fileMtime()) || Date.now();
  });
  await chain;
}

async function fetchStatus(url: string, timeoutMs = 9000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "application/json, */*;q=0.1" },
      redirect: "follow",
    });
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      text: text.slice(0, 50_000),
      latency_ms: Date.now() - start,
      contentType: res.headers.get("content-type") || "",
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: "",
      latency_ms: Date.now() - start,
      contentType: "",
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

export async function resolveMcpDns(
  domain: string,
): Promise<{ url?: string; proto?: string; raw?: string } | null> {
  const host = domain.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  if (!host || host.includes("github.com")) return null;
  try {
    const name = `_mcp.${host}`;
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
      {
        headers: { accept: "application/dns-json", "user-agent": UA },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { Answer?: Array<{ data?: string }> };
    const txt = (j.Answer?.[0]?.data || "").replace(/^"|"$/g, "");
    if (!txt) return null;
    // TXT may be "https://… proto=streamable-http" style
    const urlMatch = txt.match(/https?:\/\/\S+/i);
    const protoMatch = txt.match(/proto[=:](\S+)/i);
    return {
      raw: txt,
      url: urlMatch?.[0],
      proto: protoMatch?.[1],
    };
  } catch {
    return null;
  }
}

async function githubSignals(repo?: string) {
  if (!repo) return { stars: undefined as number | undefined, has_license: false };
  const m = repo.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!m) return { stars: undefined, has_license: false };
  try {
    const r = await fetch(
      `https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, "")}`,
      {
        headers: { "user-agent": UA, accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!r.ok) return { stars: undefined, has_license: false };
    const j = (await r.json()) as { stargazers_count?: number; license?: { spdx_id?: string } };
    return {
      stars: j.stargazers_count,
      has_license: Boolean(j.license?.spdx_id && j.license.spdx_id !== "NOASSERTION"),
    };
  } catch {
    return { stars: undefined, has_license: false };
  }
}

function checkNamespace(name: string, website?: string, repository?: string) {
  const host = (website || repository || "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    ?.toLowerCase();
  const n = name.toLowerCase();
  if (host && (n.includes(host.split(".")[0] || "") || host.includes(n.split(/[^a-z0-9]+/)[0] || ""))) {
    return { verified: true, detail: "ns:name~host" };
  }
  return { verified: false, detail: "ns:unverified" };
}

export async function stampProbeTick(): Promise<void> {
  const s = await loadProbeState();
  s.last_tick_at = new Date().toISOString();
  s.updated_at = s.last_tick_at;
  await persist(s);
}

export async function probeAgent(input: ProbeTarget): Promise<ProbeResult> {
  const signals: string[] = [];
  const protocol_hints: string[] = [];
  let score = 10;
  let handshake: ProbeResult["handshake"] = "skip";
  let latency_ms = 0;
  let target = input.agent_card_url || input.endpoint_url || input.website || "";
  let a2a_score: number | undefined;

  const cardCandidates: string[] = [];
  if (input.agent_card_url) cardCandidates.push(input.agent_card_url);
  const base =
    input.website ||
    input.endpoint_url ||
    (input.agent_card_url
      ? input.agent_card_url.replace(/\/\.well-known\/.*$/i, "")
      : "");
  if (base) {
    try {
      const origin = base.startsWith("http") ? new URL(base).origin : `https://${base.split("/")[0]}`;
      for (const path of [
        "/.well-known/agent.json",
        "/.well-known/agent-card.json",
        "/agent.json",
        "/.well-known/ai-agent.json",
      ]) {
        const u = `${origin}${path}`;
        if (!cardCandidates.includes(u)) cardCandidates.push(u);
      }
    } catch {
      /* */
    }
  }

  if (cardCandidates.length) {
    for (const cardUrl of cardCandidates) {
      const r = await fetchStatus(cardUrl);
      latency_ms = r.latency_ms;
      target = cardUrl;
      if (r.ok && r.text.trim().startsWith("{")) {
        try {
          const j = JSON.parse(r.text);
          const v = validateA2ACard(j);
          a2a_score = v.score;
          if (v.ok) {
            handshake = "ok";
            score += 40;
            signals.push("a2a-card");
            if (cardUrl !== input.agent_card_url) signals.push(`alt ${cardUrl.split("/").slice(-2).join("/")}`);
            protocol_hints.push("a2a", "agent-card");
            break;
          } else {
            handshake = "partial";
            score += 20;
            signals.push("card-partial");
            protocol_hints.push("agent-card");
            break;
          }
        } catch {
          handshake = "partial";
          score += 15;
          signals.push("card-json-parse");
          break;
        }
      } else if (r.status === 401 || r.status === 403) {
        handshake = "partial";
        score += 15;
        signals.push(`card ${r.status}`);
        break;
      } else {
        handshake = "fail";
        signals.push(`card fail ${r.status}`);
        // try next candidate
      }
    }
  } else if (input.endpoint_url || input.website) {
    const url = input.endpoint_url || input.website!;
    const r = await fetchStatus(url);
    latency_ms = r.latency_ms;
    target = url;
    if (r.ok || r.status === 401 || r.status === 405) {
      handshake = "partial";
      score += 15;
      signals.push(`endpoint ${r.status}`);
    } else {
      handshake = "fail";
      signals.push(`endpoint fail ${r.status}`);
    }
  }

  const gh = await githubSignals(input.repository);
  if (gh.stars != null) {
    score += Math.min(15, Math.floor(Math.log10(gh.stars + 1) * 6));
    signals.push(`stars ${gh.stars}`);
  }
  if (gh.has_license) {
    score += 5;
    signals.push("license");
  }
  const ns = checkNamespace(input.name, input.website, input.repository);
  if (ns.verified) {
    score += 10;
    signals.push(ns.detail);
  }
  score = Math.min(100, Math.max(0, score));
  return {
    id: input.id,
    kind: "agent",
    target,
    ok: handshake === "ok",
    latency_ms,
    score,
    signals,
    a2a_score,
    handshake,
    protocol_hints: [...new Set(protocol_hints)],
    namespace_verified: ns.verified,
    github_stars: gh.stars,
    has_license: gh.has_license,
    probed_at: new Date().toISOString(),
  };
}

export async function probeMcp(input: ProbeTarget): Promise<ProbeResult> {
  const signals: string[] = [];
  const protocol_hints: string[] = [];
  let score = 10;
  let handshake: ProbeResult["handshake"] = "skip";
  let latency_ms = 0;
  let target = input.remote_url || input.website || "";

  const origin =
    input.website ||
    (input.remote_url
      ? input.remote_url.replace(/\/+$/, "").replace(/\/mcp.*$/i, "")
      : "");
  const paths = [
    "/.well-known/mcp/server-card.json",
    "/.well-known/mcp.json",
    "/mcp",
  ];
  if (origin) {
    try {
      const base = origin.startsWith("http") ? origin : `https://${origin}`;
      for (const path of paths) {
        const r = await fetchStatus(`${base.replace(/\/$/, "")}${path}`);
        latency_ms = r.latency_ms;
        if (r.ok && r.text.trim().startsWith("{")) {
          handshake = "ok";
          score += 30;
          signals.push(`mcp-card ${path}`);
          protocol_hints.push("server-card");
          try {
            const j = JSON.parse(r.text);
            if (j.protocol_versions?.includes?.("2026-07-28")) {
              protocol_hints.push("mcp-2026-07-28");
              score += 10;
            }
            if (j.transport_preference === "streamable-http") {
              protocol_hints.push("streamable-http");
              score += 5;
            }
          } catch {
            /* */
          }
          target = `${base.replace(/\/$/, "")}${path}`;
          break;
        }
      }
    } catch {
      /* */
    }
  }
  if (handshake === "skip" && input.remote_url) {
    const r = await fetchStatus(input.remote_url);
    latency_ms = r.latency_ms;
    target = input.remote_url;
    if (r.ok || r.status === 401 || r.status === 405 || r.status === 406) {
      handshake = "partial";
      score += 20;
      signals.push(`remote ${r.status}`);
      protocol_hints.push("remote");
    } else {
      handshake = "fail";
      signals.push(`remote fail ${r.status}`);
    }
  }
  const gh = await githubSignals(input.repository);
  if (gh.stars != null) {
    score += Math.min(15, Math.floor(Math.log10(gh.stars + 1) * 6));
    signals.push(`stars ${gh.stars}`);
  }
  if (gh.has_license) {
    score += 5;
    signals.push("license");
  }
  const ns = checkNamespace(input.name, input.website, input.repository);
  if (ns.verified) {
    score += 10;
    signals.push(ns.detail);
  }
  score = Math.min(100, Math.max(0, score));
  return {
    id: input.id,
    kind: "mcp",
    target,
    ok: handshake === "ok",
    latency_ms,
    score,
    signals,
    handshake,
    protocol_hints: [...new Set(protocol_hints)],
    namespace_verified: ns.verified,
    github_stars: gh.stars,
    has_license: gh.has_license,
    probed_at: new Date().toISOString(),
  };
}

function probePriority(
  item: ProbeTarget,
  prev: ProbeResult | undefined,
  now: number,
): number {
  // Pattern preflight: never select known-dead URLs (github.com/.well-known etc.)
  const pf = preflightPatterns(item);
  if (!pf.proceed) return -20000;
  let p = item.priority_boost || 0;
  const purpose = item.purpose || "discovery";

  // --- Weekly recheck lane (unlimited; only when due ≥7d after last ok) ---
  if (purpose === "weekly_recheck") {
    if (!prev) return -10000; // nothing to recheck
    const age = now - Date.parse(prev.probed_at || "0");
    if (prev.handshake === "ok" && prev.ok && age >= ACTIVE_REPROBE_MS) {
      // Oldest due first via small age bonus
      return p + 3500 + Math.min(500, age / ACTIVE_REPROBE_MS);
    }
    // Not due yet — never take a discovery slot
    return -10000;
  }

  // --- Discovery lane: grow Active ---
  if (!prev) {
    // Never-probed with a reachable URL first (skip-only wastes 6-min slots)
    const hasUrl = Boolean(
      item.agent_card_url ||
        item.endpoint_url ||
        item.remote_url ||
        item.website,
    );
    return p + (hasUrl ? 8000 : 3500);
  }
  const age = now - Date.parse(prev.probed_at || "0");
  // Still-ok under weekly window: do not burn discovery budget (weekly lane handles later)
  if (prev.handshake === "ok" && prev.ok && age < ACTIVE_REPROBE_MS) return -10000;
  // Was ok but past 7d without weekly tag — leave for weekly lane
  if (prev.handshake === "ok" && prev.ok && age >= ACTIVE_REPROBE_MS) return -5000;
  // FAIL / PARTIAL: cooldown then allow re-try (new remotes / flaky hosts).
  // Permanent hard-block starved clean growth toward 333/day.
  if (prev.handshake === "fail" || prev.handshake === "partial") {
    if (age < 6 * 3600_000) return -800; // 6h cool-down
    return p + 200; // re-queue after cool-down
  }
  if (item.dirty) {
    if (age < 6 * 3600_000) return -800;
    return p + 150;
  }
  if (prev.handshake === "skip") {
    // Skip burns a slot with no path to clean — deprioritize hard for 24h
    if (age < 24 * 3600_000) return -9000;
    const hasUrl = Boolean(
      item.agent_card_url ||
        item.endpoint_url ||
        item.remote_url ||
        item.website,
    );
    if (!hasUrl) return -5000;
    return p - 200; // rare retry only after a day
  }
  if (age > RETRY_DIRTY_MS) return p + 400;
  return p + 50;
}

export async function runProbeBudgeted(
  items: ProbeTarget[],
  max = MAX_PROBES_PER_WINDOW,
  opts?: { force?: boolean },
): Promise<ProbeResult[]> {
  let state: ProbeState;
  try {
    state = await loadProbeState();
  } catch {
    state = empty();
  }
  if (!state || typeof state !== "object") state = empty();
  state.results = state.results || {};
  state.used = Number(state.used) || 0;
  state.budget = Number(state.budget) || MAX_PROBES_PER_DAY;
  state.hourly_used = Number(state.hourly_used) || 0;
  state.hourly_cap = Number(state.hourly_cap) || MAX_PROBES_PER_HOUR;
  state.day = state.day || utcDay();

  const priorLastTick = state.last_tick_at;
  const priorLastOk = state.last_ok_tick_at;
  const priorHandshake = state.last_handshake;

  // GLOBAL CADENCE GATE — skip only when not force-burst (behind 333/day target)
  try {
    const { readDisplayAuthority } = await import("./display-authority");
    const auth = await readDisplayAuthority({
      used: state.used,
      last_tick_at: state.last_tick_at,
      live_total: state.live_active_snapshot?.total,
      live_mcp: state.live_active_snapshot?.mcp,
      live_agents: state.live_active_snapshot?.agents,
    });
    // Align used to global high-water before anything else
    state.used = Math.max(state.used, (auth && auth.used) || 0);
    if (!opts?.force) {
      const lastIso = (auth && auth.last_tick_at) || state.last_tick_at;
      if (lastIso) {
        const age = Date.now() - Date.parse(lastIso);
        if (Number.isFinite(age) && age >= 0 && age < PROBE_WINDOW_MS - 5_000) {
          return [];
        }
      }
    }
    // Also honor local hour window if already spent
    if (state.hourly_used >= state.hourly_cap) {
      return [];
    }
  } catch {
    /* fall through to local remaining checks */
  }

  const dayRemaining = Math.max(0, state.budget - state.used);
  const hourRemaining = Math.max(0, state.hourly_cap - state.hourly_used);
  const remaining = Math.min(dayRemaining, hourRemaining);
  if (remaining <= 0 || items.length === 0) return [];

  const now = Date.now();
  const ranked = [...items]
    .map((item) => ({
      item,
      prev: state.results[item.id],
      pri: probePriority(item, state.results[item.id], now),
    }))
    .sort((a, b) => b.pri - a.pri);

  // Soft-deprioritize blocked targets (do NOT hard-exclude — that starved growth)
  try {
    const { loadDelistedIdSet } = await import("./probe-preflight");
    const { loadCounterFloors, isBlockedSync } = await import("./counter-floors");
    const delisted = await loadDelistedIdSet();
    const floors = await loadCounterFloors();
    for (const x of ranked) {
      if (
        delisted.has(x.item.id) ||
        (x.item.store_id && delisted.has(x.item.store_id))
      ) {
        x.pri = -500;
        continue;
      }
      const urls = [
        x.item.agent_card_url,
        x.item.remote_url,
        x.item.endpoint_url,
        x.item.website,
      ].filter(Boolean) as string[];
      if (
        isBlockedSync(floors, {
          id: x.item.id,
          urls,
        }) ||
        (x.item.store_id &&
          isBlockedSync(floors, { id: x.item.store_id, urls }))
      ) {
        // Previously probed fail — retry later with lower priority (not permanent kill)
        x.pri = Math.min(x.pri, -20);
      }
    }
    ranked.sort((a, b) => b.pri - a.pri);
  } catch {
    /* */
  }

  // Unique primary probes only (skip name:/url: aliases that triple-count MCPs)
  let agentToday = 0;
  let mcpToday = 0;
  let agentActiveOk = 0;
  let mcpActiveOk = 0;
  const seenDay = new Set<string>();
  for (const [key, r] of Object.entries(state.results)) {
    if (key.startsWith("name:") || key.startsWith("url:")) continue;
    if (r.handshake === "ok" && r.ok) {
      if (r.kind === "agent") agentActiveOk++;
      else if (r.kind === "mcp") mcpActiveOk++;
    }
    if (!(r.probed_at || "").startsWith(state.day)) continue;
    const uid = r.id || key;
    if (seenDay.has(uid)) continue;
    seenDay.add(uid);
    if (r.kind === "agent") agentToday++;
    else if (r.kind === "mcp") mcpToday++;
  }

  const rankedLive = ranked.filter((x) => x.pri > -1000);
  const resolveKind = (item: ProbeTarget): "agent" | "mcp" => {
    if (item.kind === "agent" || item.kind === "mcp") return item.kind;
    if (item.agent_card_url || item.endpoint_url) return "agent";
    return "mcp";
  };
  const agents = rankedLive.filter((x) => resolveKind(x.item) === "agent");
  const mcps = rankedLive.filter((x) => resolveKind(x.item) === "mcp");
  agents.sort((a, b) => b.pri - a.pri);
  mcps.sort((a, b) => b.pri - a.pri);

  const take = Math.min(max, remaining, rankedLive.length);
  // Full probes per tick = budget take (was hard-capped at 1 — that blocked 333/day).
  const maxFullProbes = Math.max(1, take);
  const maxPreflightRejects = Math.max(32, maxFullProbes * 4);
  const selected: typeof ranked = [];
  let ai = 0;
  let mi = 0;

  // Last primary probes today — break fail streaks so Live can still grow
  const recentPrimary = Object.entries(state.results)
    .filter(([k]) => !k.startsWith("name:") && !k.startsWith("url:"))
    .map(([, r]) => r)
    .filter((r) => (r.probed_at || "").startsWith(state.day))
    .sort((a, b) => (a.probed_at < b.probed_at ? 1 : -1))
    .slice(0, 4);
  const last3 = recentPrimary.slice(0, 3);
  const agentFailStreak =
    last3.length >= 3 &&
    last3.every((r) => r.kind === "agent" && !(r.handshake === "ok" && r.ok));
  const mcpFailStreak =
    last3.length >= 3 &&
    last3.every((r) => r.kind === "mcp" && !(r.handshake === "ok" && r.ok));

  // Grow Live lists at same rate: lagging Active wins; then lagging day probes.
  // Break pure fail streaks of either kind so the other lane can promote Live.
  while (selected.length < Math.min(maxPreflightRejects + maxFullProbes, rankedLive.length) && (ai < agents.length || mi < mcps.length)) {
    const activeGap = agentActiveOk - mcpActiveOk;
    const dayGap = agentToday - mcpToday;
    let preferAgent: boolean;
    if (agents.length === 0) preferAgent = false;
    else if (mcps.length === 0) preferAgent = true;
    else if (agentFailStreak && mcps.length > 0) preferAgent = false;
    else if (mcpFailStreak && agents.length > 0) preferAgent = true;
    else if (activeGap < 0) preferAgent = true; // agents Active behind
    else if (activeGap > 0) preferAgent = false; // mcps Active behind
    else if (dayGap < 0) preferAgent = true;
    else if (dayGap > 0) preferAgent = false;
    else preferAgent = agentToday <= mcpToday;

    if (preferAgent && ai < agents.length) {
      selected.push(agents[ai++]!);
      agentToday++;
      continue;
    }
    if (!preferAgent && mi < mcps.length) {
      selected.push(mcps[mi++]!);
      mcpToday++;
      continue;
    }
    if (ai < agents.length) {
      selected.push(agents[ai++]!);
      agentToday++;
    } else if (mi < mcps.length) {
      selected.push(mcps[mi++]!);
      mcpToday++;
    } else break;
  }

  // Never select fresh-ok for spend — always burn budget on never/dirty/stale
  const spendable = selected.filter((x) => x.pri >= 0);
  const queue = spendable.length ? spendable : selected;

  const out: ProbeResult[] = [];
  let gotCleanOk = false;
  let fullProbes = 0;
  let preflightRejects = 0;
  for (const { item } of queue) {
    if (fullProbes >= maxFullProbes) break;
    if (state.used >= state.budget) break;
    if (state.hourly_used >= state.hourly_cap) break;
    const kind =
      item.kind ||
      (item.agent_card_url || item.endpoint_url ? "agent" : "mcp");

    // --- Preflight: skip budget burn on known-dead / 404 cards ---
    try {
      const { preflightLive } = await import("./probe-preflight");
      const pf = await preflightLive(item, { timeoutMs: 2500 });
      if (!pf.proceed && pf.predict_fail) {
        const fake: ProbeResult = {
          id: item.id,
          kind: kind as "agent" | "mcp",
          target: pf.primary_url || item.agent_card_url || item.remote_url || "",
          ok: false,
          latency_ms: 0,
          score: 0,
          signals: [
            "preflight-reject",
            pf.reason.slice(0, 120),
            pf.status ? `status ${pf.status}` : "pattern",
          ],
          handshake: "fail",
          protocol_hints: [],
          probed_at: new Date().toISOString(),
        };
        state.results[item.id] = fake;
        if (item.name) {
          state.results[
            `name:${kind}:${(item.name || "").toLowerCase().trim()}`
          ] = { ...fake, id: item.id };
        }
        try {
          const { delistOnProbeFail } = await import("./delist-on-fail");
          await delistOnProbeFail({
            id: item.store_id || item.id,
            kind: kind as "agent" | "mcp",
            name: item.name,
            agent_card_url: item.agent_card_url,
            remote_url: item.remote_url,
            website: item.website,
            probe: fake,
          });
        } catch {
          /* */
        }
        try {
          // Only permanent-block on weekly recheck fails — discovery needs retries for 333/day
          if (item.purpose === "weekly_recheck") {
            const { blockProbeTarget } = await import("./counter-floors");
            await blockProbeTarget({
              id: item.store_id || item.id,
              url: fake.target,
            });
          }
        } catch {
          /* */
        }
        // Preflight reject: NO budget spend — keep looking for a viable target
        preflightRejects++;
        out.push(fake);
        if (preflightRejects >= maxPreflightRejects) break;
        continue;
      }
    } catch {
      /* preflight optional — fall through to full probe */
    }

    const result =
      kind === "agent"
        ? await probeAgent({ ...item, kind: "agent" })
        : await probeMcp({ ...item, kind: "mcp" });
    fullProbes += 1;
    if (item.purpose === "weekly_recheck") {
      result.signals = [...(result.signals || []), "weekly-recheck"];
    }
    state.results[item.id] = result;
    const nameKey = `name:${result.kind}:${(item.name || "").toLowerCase().trim()}`;
    if (item.name) state.results[nameKey] = { ...result, id: item.id };
    if (item.agent_card_url) {
      state.results[`url:${item.agent_card_url}`] = { ...result, id: item.id };
    }
    if (item.remote_url) {
      state.results[`url:${item.remote_url}`] = { ...result, id: item.id };
    }
    if (item.store_id) {
      state.results[item.store_id] = { ...result, id: item.store_id };
    }
    if (item.purpose === "weekly_recheck") {
      const week = utcWeek();
      if (!state.weekly || state.weekly.week !== week) {
        state.weekly = { week, rechecked: 0, still_ok: 0, demoted: 0 };
      }
      state.weekly.rechecked += 1;
      if (result.handshake === "ok" && result.ok) state.weekly.still_ok += 1;
      else state.weekly.demoted += 1;
    }

    if (result.handshake === "ok" && result.ok) {
      try {
        const { raiseClean } = await import("./clean-registry");
        await raiseClean({
          id: item.store_id || item.id,
          kind: (kind === "agent" ? "agent" : "mcp") as "agent" | "mcp",
          name: item.name || item.id,
          target: result.target,
          probed_at: result.probed_at,
          score: result.score,
          handshake: "ok",
        });
      } catch {
        /* */
      }
    }

    // FAIL / PARTIAL → delist + permanent block (never probe again)
    if (
      result.handshake === "fail" ||
      result.handshake === "partial" ||
      !result.ok
    ) {
      if (result.handshake !== "skip") {
        try {
          const { removeCleanOnFail } = await import("./clean-registry");
          await removeCleanOnFail(item.store_id || item.id);
        } catch {
          /* */
        }
        try {
          const { delistOnProbeFail } = await import("./delist-on-fail");
          const del = await delistOnProbeFail({
            id: item.store_id || item.id,
            kind: kind as "agent" | "mcp",
            name: item.name,
            agent_card_url: item.agent_card_url,
            remote_url: item.remote_url,
            website: item.website,
            probe: result,
          });
          if (del) {
            result.signals = [
              ...(result.signals || []),
              `delist:${del.reason.slice(0, 80)}`,
            ];
          }
        } catch {
          /* */
        }
        try {
          if (item.purpose === "weekly_recheck") {
            const { blockProbeTarget } = await import("./counter-floors");
            await blockProbeTarget({
              id: item.store_id || item.id,
              url: result.target,
            });
            if (item.agent_card_url)
              await blockProbeTarget({ url: item.agent_card_url });
            if (item.remote_url) await blockProbeTarget({ url: item.remote_url });
          }
        } catch {
          /* */
        }
      }
      state.used += 1;
      state.hourly_used += 1;
      out.push(result);
      appendTickLog(state, result, true, { name: item.name });
      // Continue queue — fail does not end the tick (need volume toward 333/day)
      continue;
    }

    // CHECKS CLEAN + handshake ok
    state.used += 1;
    state.hourly_used += 1;
    gotCleanOk = true;
    out.push(result);
    appendTickLog(state, result, true, { name: item.name });
    // First contact counts as Talk presence so new cleans start present
    try {
      const { recordPresence } = await import("./talk-activity");
      await recordPresence({
        listing_id: item.store_id || item.id,
        kind: kind as "agent" | "mcp",
        name: item.name || item.id,
        text: `probe-ok · ${result.target || "handshake"}`,
        channel: "presence",
        full: false,
      });
    } catch {
      /* non-blocking */
    }
  }
  // Only advance last_tick when a full budget probe ran
  if (fullProbes > 0) {
    state.last_tick_at = new Date().toISOString();
    state.updated_at = state.last_tick_at;
    const lastOut = out[out.length - 1];
    if (lastOut) {
      state.last_handshake = lastOut.handshake || "fail";
    }
    if (gotCleanOk) {
      state.last_ok_tick_at = state.last_tick_at;
    } else if (
      out.some((r) => r.handshake === "fail" || r.handshake === "partial")
    ) {
      state.hourly_used = Math.max(state.hourly_used, 1);
      state.last_handshake = lastOut?.handshake || "fail";
    }
    // Shared high-water so other instances honor cadence + used
    try {
      const { raiseUsedFloor, raiseLastTickFloor } = await import(
        "./counter-floors"
      );
      await raiseUsedFloor(state.used);
      await raiseLastTickFloor(state.last_tick_at);
      const { observeDisplayAuthority } = await import("./display-authority");
      observeDisplayAuthority({
        used: state.used,
        last_tick_at: state.last_tick_at,
      });
    } catch {
      /* */
    }
  } else {
    // Preflight-only: restore prior cadence markers (do not fake a tick)
    state.last_tick_at = priorLastTick;
    state.last_ok_tick_at = priorLastOk;
    state.last_handshake = priorHandshake;
    state.updated_at = new Date().toISOString();
  }

  // High-water Live from results + floors
  const liveNow = countLiveFromResults(state.results);
  const prev = state.live_active_snapshot;
  state.live_active_snapshot = {
    total: Math.max(prev?.total || 0, liveNow.total),
    mcp: Math.max(prev?.mcp || 0, liveNow.mcp),
    agents: Math.max(prev?.agents || 0, liveNow.agents),
    at: new Date().toISOString(),
  };

  // Cap result map size
  const ids = Object.keys(state.results);
  if (ids.length > 2500) {
    const primaries = ids.filter((id) => !id.startsWith("name:") && !id.startsWith("url:"));
    const aliases = ids.filter((id) => id.startsWith("name:") || id.startsWith("url:"));
    const keepIds = [
      ...primaries
        .map((id) => ({ id, at: state.results[id]?.probed_at || "" }))
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 1200)
        .map((x) => x.id),
      ...aliases
        .map((id) => ({ id, at: state.results[id]?.probed_at || "" }))
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 1300)
        .map((x) => x.id),
    ];
    state.results = Object.fromEntries(
      keepIds.filter((id) => state.results[id]).map((id) => [id, state.results[id]!]),
    );
  }
  await persist(state);

  // Raise durable floors ONLY after a real probe tick (never on GET)
  try {
    const { raiseUsedFloor, raiseLiveFloor, raiseDelistedFloor } = await import(
      "./counter-floors"
    );
    const { raiseLiveCounters } = await import("./live-counter");
    const { readDisplayAuthority, observeDisplayAuthority } = await import(
      "./display-authority"
    );
    // Max with every source so we never raise to a lower value
    const auth = await readDisplayAuthority({
      used: state.used,
      live_total: state.live_active_snapshot?.total || 0,
      live_mcp: state.live_active_snapshot?.mcp || 0,
      live_agents: state.live_active_snapshot?.agents || 0,
      last_tick_at: state.last_tick_at,
    });
    state.used = await raiseUsedFloor(
      Math.max(state.used, auth.used || 0),
    );
    const liveFloor = await raiseLiveFloor({
      total: Math.max(
        state.live_active_snapshot?.total || 0,
        auth.live_total || 0,
      ),
      mcp: Math.max(state.live_active_snapshot?.mcp || 0, auth.live_mcp || 0),
      agents: Math.max(
        state.live_active_snapshot?.agents || 0,
        auth.live_agents || 0,
      ),
    });
    state.live_active_snapshot = {
      total: liveFloor.total,
      mcp: liveFloor.mcp,
      agents: liveFloor.agents,
      at: liveFloor.at,
    };
    // Single public clean floor — absorb all ok, drop only explicit fails
    try {
      const { syncCleanFromProbeResults } = await import("./clean-registry");
      const clean = await syncCleanFromProbeResults(state.results || {});
      // Align live snapshot upward to clean floor (never down)
      if (clean.counts.total > (state.live_active_snapshot?.total || 0)) {
        state.live_active_snapshot = {
          total: clean.counts.total,
          mcp: clean.counts.mcp,
          agents: clean.counts.agents,
          at: clean.updated_at,
        };
      }
    } catch {
      /* */
    }
    try {
      const { delistStats } = await import("./delist-on-fail");
      const ds = await delistStats();
      await raiseDelistedFloor(
        Math.max(ds.total, auth.delisted_total || 0),
      );
    } catch {
      /* */
    }
    await raiseLiveCounters({
      probes_used: state.used,
      live_ok: state.live_active_snapshot.total,
      live_mcp: state.live_active_snapshot.mcp,
      live_agents: state.live_active_snapshot.agents,
    });
    observeDisplayAuthority({
      used: state.used,
      live_total: state.live_active_snapshot.total,
      live_mcp: state.live_active_snapshot.mcp,
      live_agents: state.live_active_snapshot.agents,
      last_tick_at: state.last_tick_at,
    });
    await persist(state);
  } catch {
    /* */
  }
  return out;
}

export async function getProbePublic() {
  // Sandbox / local: always return production public probe numbers so
  // dualregistry.dev and Grok preview never disagree on used/last/next/live.
  try {
    const { shouldMirrorProductionMetrics, CANONICAL_API } = await import(
      "./canonical-metrics"
    );
    if (shouldMirrorProductionMetrics()) {
      const res = await fetch(
        `${CANONICAL_API}/api/dashboard?refresh=1&mirror=1`,
        {
          headers: {
            accept: "application/json",
            "user-agent": "DualRegistryProbeMirror/1.0",
            "cache-control": "no-cache",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (res.ok) {
        const d = (await res.json()) as {
          protocol?: { probes?: Record<string, unknown> };
        };
        const probes = d.protocol?.probes;
        if (probes && typeof probes.used === "number") {
          return {
            ...probes,
            metrics_source: "mirrored-production",
            mirrored_from: CANONICAL_API,
          };
        }
      }
    }
  } catch {
    /* fall through to local */
  }

  const s = await loadProbeState();
  const day_remaining = Math.max(0, s.budget - s.used);
  const hourly_remaining = Math.max(0, s.hourly_cap - s.hourly_used);
  let probe_worker: Record<string, unknown> | null = null;
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    probe_worker = JSON.parse(
      await readFile(join(dataRoot(), "growth", "probe-worker.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    probe_worker = null;
  }
  // Production serverless: worker file is ephemeral. Derive health from last_tick.
  {
    const lastIso = s.last_tick_at || (probe_worker?.last_tick_at as string | undefined);
    const lastMs = lastIso ? Date.parse(String(lastIso)) : NaN;
    const ageMs = Number.isFinite(lastMs) ? Date.now() - lastMs : Infinity;
    // Healthy if a tick landed within ~2 slots (12m). Stale after that.
    const derivedStatus =
      ageMs <= 12 * 60_000
        ? "running"
        : ageMs <= 30 * 60_000
          ? "idle"
          : s.used > 0
            ? "stale"
            : "waiting";
    const nextIso = nextProbeFromLast(lastIso || null);
    probe_worker = {
      status: derivedStatus,
      mode: (probe_worker?.mode as string) || "production-cron",
      scheduler:
        (probe_worker?.scheduler as string) || "github-actions-every-6m",
      last_tick_at: lastIso || null,
      next_tick_at: nextIso,
      last_probed: probe_worker?.last_probed ?? probe_worker?.probed ?? null,
      last_result: probe_worker?.last_result ?? null,
      last_used: probe_worker?.last_used ?? s.used,
      ticks: probe_worker?.ticks ?? s.used,
      pid: probe_worker?.pid ?? null,
      derived: true,
      age_ms: Number.isFinite(ageMs) ? ageMs : null,
    };
  }
  let agents_today = 0;
  let mcps_today = 0;
  // Only count probes that match today's budget spends (most recent N = used).
  // Prevents seeded history from inflating "16a/9m" when used is 1.
  const todaysPrimary = Object.entries(s.results)
    .filter(
      ([key, r]) =>
        !key.startsWith("name:") &&
        !key.startsWith("url:") &&
        (r.probed_at || "").startsWith(s.day),
    )
    .map(([, r]) => r)
    .sort((a, b) => (a.probed_at < b.probed_at ? 1 : -1));
  const seenDayPub = new Set<string>();
  const todaysSpend = todaysPrimary.filter((r) => {
    const uid = r.id;
    if (seenDayPub.has(uid)) return false;
    seenDayPub.add(uid);
    return true;
  });
  const counted =
    s.used > 0 ? todaysSpend.slice(0, s.used) : ([] as typeof todaysSpend);
  for (const r of counted) {
    if (r.kind === "agent") agents_today++;
    else if (r.kind === "mcp") mcps_today++;
  }
  // Primary probe records only (skip aliases) for weekly due queue
  const primaries = Object.entries(s.results).filter(
    ([k]) => !k.startsWith("name:") && !k.startsWith("url:"),
  );
  const now = Date.now();
  const activeOk = primaries.filter(
    ([, r]) => r.handshake === "ok" && r.ok,
  );
  const weeklyDue = activeOk.filter(([, r]) => {
    const age = now - Date.parse(r.probed_at || "0");
    return Number.isFinite(age) && age >= ACTIVE_REPROBE_MS;
  });
  const nextDueMs = activeOk
    .map(([, r]) => Date.parse(r.probed_at || "0") + ACTIVE_REPROBE_MS)
    .filter((t) => Number.isFinite(t) && t > now)
    .sort((a, b) => a - b)[0];

  const week = utcWeek();
  const weekly = s.weekly && s.weekly.week === week
    ? s.weekly
    : { week, rechecked: 0, still_ok: 0, demoted: 0 };

  const recentFromLog = (s.tick_log && s.tick_log.length
    ? s.tick_log
    : backfillTickLogFromResults(s.results)
  )
    // Prefer budget-spent probes in the public log (real ticks)
    .filter((t) => t.spent_budget !== false)
    .sort((a, b) => (a.probed_at < b.probed_at ? 1 : -1))
    .slice(0, 40);

  // Map tick log → recent shape (chronological — NOT deduped by listing id)
  const recentUnique = recentFromLog.map((t) => ({
    id: t.id,
    kind: (t.kind as "agent" | "mcp") || "agent",
    target: t.target || "",
    ok: Boolean(t.ok),
    latency_ms: 0,
    score: 0,
    signals: t.signals || [],
    handshake: t.handshake as ProbeResult["handshake"],
    protocol_hints: [] as string[],
    probed_at: t.probed_at,
  }));

  // Outcome summary — unique primary listings (why fail / how many)
  const primaryMap = new Map<string, ProbeResult>();
  for (const [key, r] of Object.entries(s.results)) {
    if (key.startsWith("name:") || key.startsWith("url:")) continue;
    const uid = r.id || key;
    const prev = primaryMap.get(uid);
    if (!prev || (r.probed_at || "") > (prev.probed_at || "")) {
      primaryMap.set(uid, r);
    }
  }
  const handshakeCounts: Record<string, number> = {
    ok: 0,
    fail: 0,
    partial: 0,
    skip: 0,
    other: 0,
  };
  const failReasons: Record<string, number> = {};
  const failByKind: Record<string, number> = { agent: 0, mcp: 0 };
  const failSamples: Array<{
    id: string;
    kind?: string;
    target?: string;
    reason: string;
    probed_at?: string;
  }> = [];
  for (const r of primaryMap.values()) {
    const hs = r.handshake || "other";
    if (hs in handshakeCounts) handshakeCounts[hs]!++;
    else handshakeCounts.other++;
    if (hs === "fail") {
      const k = r.kind === "mcp" ? "mcp" : "agent";
      failByKind[k] = (failByKind[k] || 0) + 1;
      const sigs = r.signals || [];
      const failSig =
        sigs.find((x) => /fail|404|402|410|403|timeout|error/i.test(String(x))) ||
        sigs[0] ||
        "unknown";
      // Normalize e.g. "card fail 404" 
      let reason = String(failSig);
      if (/404/.test(reason)) reason = "card fail 404 (no agent/mcp card)";
      else if (/402/.test(reason)) reason = "card fail 402 (paywalled/blocked)";
      else if (/410/.test(reason)) reason = "card fail 410 (gone)";
      else if (/403/.test(reason)) reason = "card fail 403 (forbidden)";
      else if (/200/.test(reason) && /fail/i.test(reason))
        reason = "card fail 200 (HTML/non-card body)";
      failReasons[reason] = (failReasons[reason] || 0) + 1;
      if (failSamples.length < 12) {
        failSamples.push({
          id: r.id,
          kind: r.kind,
          target: r.target,
          reason,
          probed_at: r.probed_at,
        });
      }
    }
  }
  const failReasonTop = Object.entries(failReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  // READ-ONLY high-water — never raise/write on GET (that raced and dropped numbers)
  let usedOut = s.used;
  let liveOut: { total: number; mcp: number; agents: number; at: string } =
    s.live_active_snapshot || {
      ...countLiveFromResults(s.results),
      at: new Date().toISOString(),
    };
  let lastTickOut = s.last_tick_at;
  let counterBackend = "display-authority";
  try {
    const { readDisplayAuthority, observeDisplayAuthority } = await import(
      "./display-authority"
    );
    const auth = await readDisplayAuthority({
      used: s.used,
      live_total: liveOut.total,
      live_mcp: liveOut.mcp,
      live_agents: liveOut.agents,
      last_tick_at: s.last_tick_at,
    });
    usedOut = Math.max(s.used, auth.used || 0);
    liveOut = {
      total: Math.max(liveOut.total || 0, auth.live_total || 0),
      mcp: Math.max(liveOut.mcp || 0, auth.live_mcp || 0),
      agents: Math.max(liveOut.agents || 0, auth.live_agents || 0),
      at: liveOut.at || new Date().toISOString(),
    };
    // last_tick never goes backwards — max ISO string / time
    if (auth.last_tick_at && (!lastTickOut || auth.last_tick_at > lastTickOut)) {
      lastTickOut = auth.last_tick_at;
    }
    // Also max from newest tick_log entry
    const newestLog = (s.tick_log || [])[0]?.probed_at;
    if (newestLog && (!lastTickOut || newestLog > lastTickOut)) {
      lastTickOut = newestLog;
    }
    // Keep process memory high-water (no durable write on GET)
    observeDisplayAuthority({
      used: usedOut,
      live_total: liveOut.total,
      live_mcp: liveOut.mcp,
      live_agents: liveOut.agents,
      last_tick_at: lastTickOut,
    });
    // Align in-memory state for this instance so subsequent ticks don't regress
    if (usedOut > s.used) s.used = usedOut;
    if (lastTickOut && (!s.last_tick_at || lastTickOut > s.last_tick_at)) {
      s.last_tick_at = lastTickOut;
    }
    // Do NOT freeze inflated live_active_snapshot from floors here —
    // public Live must equal Active lane (checks clean + probe ok now).
    counterBackend = "display-authority(max-of-all-sources)";
  } catch {
    try {
      const { loadCounterFloors } = await import("./counter-floors");
      const floors = await loadCounterFloors();
      usedOut = Math.max(s.used, floors.used_floor || 0);
      counterBackend = "counter-floors-readonly";
    } catch {
      /* */
    }
  }

  // PRODUCT TRUTH: Live card = Active listings only (not historical ok high-water)
  try {
    const { getLanedListings } = await import("./listing-lanes");
    const lanes = await getLanedListings();
    const mcpA = Number(
      lanes.mcp_active?.length ?? lanes.counts?.mcp_active ?? 0,
    );
    const agA = Number(
      lanes.agents_active?.length ?? lanes.counts?.agents_active ?? 0,
    );
    liveOut = {
      total: mcpA + agA,
      mcp: mcpA,
      agents: agA,
      at: new Date().toISOString(),
    };
    s.live_active_snapshot = liveOut;
  } catch {
    /* keep liveOut from results */
  }

  return {
    day: s.day,
    used: usedOut,
    budget: s.budget,
    remaining: Math.max(0, s.budget - usedOut),
    day_remaining: Math.max(0, s.budget - usedOut),
    hourly_used: s.hourly_used,
    hourly_cap: s.hourly_cap,
    hourly_remaining,
    hour_bucket: s.hour_bucket,
    by_kind_today: { agents: agents_today, mcps: mcps_today },
    real_active_only: Boolean(s.real_active_only),
    baseline_note: s.baseline_note,
    wasted_probes_discarded: s.wasted_probes_discarded,
    last_tick_at: lastTickOut || s.last_tick_at,
    last_ok_tick_at: s.last_ok_tick_at,
    last_handshake: s.last_handshake || null,
    next_tick_at:
      s.last_handshake === "ok" || (!s.last_handshake && s.last_ok_tick_at)
        ? nextProbeFromLast(s.last_ok_tick_at || lastTickOut || s.last_tick_at)
        : nextProbeFromLast(lastTickOut || s.last_tick_at),
    cadence_rule:
      "One full probe per 6 minutes. Preflight skips known-dead cards without spending budget. Live counts never decrease.",
    live_active: liveOut,
    live_active_snapshot: liveOut,
    source_of_truth:
      "display-authority: max(GH probes, floors, live-counters, local) — GET never writes",
    counter_backend: counterBackend,
    probe_worker: probe_worker
      ? {
          status: probe_worker.status,
          // Prefer high-water lastTickOut so worker never flaps behind display
          last_tick_at: lastTickOut || probe_worker.last_tick_at,
          next_tick_at: lastTickOut
            ? nextProbeFromLast(lastTickOut)
            : probe_worker.next_tick_at,
          last_probed: probe_worker.last_probed,
          last_reason: probe_worker.last_reason,
          last_result: probe_worker.last_result ?? null,
          last_used: Math.max(
            Number(probe_worker.last_used) || 0,
            usedOut,
          ),
          ticks: Math.max(Number(probe_worker.ticks) || 0, usedOut),
          pid: probe_worker.pid,
        }
      : null,

    weekly_recheck: {
      interval_days: 7,
      unlimited: true,
      active_ok: activeOk.length,
      due_now: weeklyDue.length,
      next_due_at: nextDueMs ? new Date(nextDueMs).toISOString() : null,
      week: weekly.week,
      rechecked_this_week: weekly.rechecked,
      still_ok_this_week: weekly.still_ok,
      demoted_this_week: weekly.demoted,
      note: "Unlimited weekly rechecks — queue grows with Active. Discovery always first.",
    },
    policy: {
      max_per_day: MAX_PROBES_PER_DAY,
      max_per_window: MAX_PROBES_PER_WINDOW,
      window_minutes: PROBE_WINDOW_MS / 60_000,
      cadence: `up to ${MAX_PROBES_PER_WINDOW} full probes / ${PROBE_WINDOW_MS / 60_000}m · ${MAX_PROBES_PER_DAY}/day soft · clean list target ${CLEAN_GROWTH_TARGET_PER_DAY}/day · only handshake-ok listed · no fakes`,
      balance:
        "catch-up: lagging kind first; mix agents+MCPs. Prefer never-probed.",
      max_per_hour: MAX_PROBES_PER_HOUR,
      priority:
        "never_probed > weekly_due_active > cool-down retries > partial/stale > skip fresh ok",
      fresh_ok_hours: FRESH_OK_MS / 3600_000,
      weekly_recheck_days: 7,
      weekly_recheck_cap: "unlimited",
    },
    window_bucket: s.hour_bucket,
    window_used: s.hourly_used,
    window_cap: s.hourly_cap,
    outcomes: {
      unique_primaries: primaryMap.size,
      handshake: handshakeCounts,
      fail_by_kind: failByKind,
      fail_reasons: failReasonTop,
      fail_samples: failSamples,
      note: "Unique primary listings (aliases deduped). Fail burns probe budget but does not promote to Live.",
    },

    window_remaining: hourly_remaining,
    recent: recentUnique,
  };
}
