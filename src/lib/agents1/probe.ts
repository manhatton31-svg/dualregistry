/**
 * Live handshake probes (no store KV).
 *
 * Discovery: 1 probe / 6 min · 240/day soft · never-probed first → grow Active.
 * Weekly recheck: unlimited · every Active re-probed 7d after last ok, then every 7d.
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

const PATH = join(dataRoot(), "probes.json");
const DURABLE_NAME = "probes.json";
const UA = "Agents1Probe/1.2 (+registry; reliability; balanced)";

export const MAX_PROBES_PER_DAY = 240;
export const PROBE_WINDOW_MS = 6 * 60_000;
export const MAX_PROBES_PER_WINDOW = 1;
export const MAX_PROBES_PER_HOUR = MAX_PROBES_PER_WINDOW;
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
  updated_at: string;
  last_tick_at?: string;
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
    hourly_cap: MAX_PROBES_PER_WINDOW,
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

export async function loadProbeState(): Promise<ProbeState> {

  const day = utcDay();
  const hour = utcHourBucket();
  const mt = await fileMtime();
  if (mem && mem.day === day && mt && memMtime && mt <= memMtime) {
    if (mem.hour_bucket !== hour) {
      mem.hour_bucket = hour;
      mem.hourly_used = 0;
    }
    mem.budget = MAX_PROBES_PER_DAY;
    mem.hourly_cap = MAX_PROBES_PER_WINDOW;
    return mem;
  }
  try {
    // Durable: local /tmp → GitHub raw data/prod/probes.json
    const p = await loadDurableJson<Partial<ProbeState>>(DURABLE_NAME, () => ({}));
    if (!p || !Object.keys(p).length) {
      // fallback classic path
      try {
        const raw = await readFile(PATH, "utf8");
        Object.assign(p, JSON.parse(raw));
      } catch {
        /* */
      }
    }
    if (!p.day && !p.results) {
      mem = empty();
      await persist(mem);
      return mem;
    }
    if (p.day !== day) {
      const prevResults = p.results || {};
      mem = empty();
      mem.results = prevResults;
      await persist(mem);
      return mem;
    }
    mem = {
      ...empty(),
      ...p,
      day,
      budget: MAX_PROBES_PER_DAY,
      hourly_cap: MAX_PROBES_PER_WINDOW,
      hour_bucket: p.hour_bucket === hour ? (p.hour_bucket as string) : hour,
      hourly_used: p.hour_bucket === hour ? p.hourly_used || 0 : 0,
      results: p.results || {},
      used: p.used || 0,
    };
    memMtime = mt || (await fileMtime());
    return mem;
  } catch {
    mem = empty();
    await persist(mem);
    return mem;
  }
}

async function persist(s: ProbeState) {
  mem = s;
  s.updated_at = new Date().toISOString();
  chain = chain.then(async () => {
    await saveDurableJson(DURABLE_NAME, s);
    try {
      await mkdir(dirname(PATH), { recursive: true });
      const tmp = `${PATH}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
      await rename(tmp, PATH);
    } catch {
      /* durable local write already attempted */
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
    ok: handshake === "ok" || handshake === "partial",
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
    ok: handshake === "ok" || handshake === "partial",
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
  // Recent fails: cool down 12h — dead agent cards were eating every 6-min slot
  if (prev.handshake === "fail" || item.dirty) {
    if (age < 12 * 3600_000) return -500;
    return p + 800 + Math.min(200, age / 60000);
  }
  if (prev.handshake === "partial") return p + 600 + Math.min(100, age / 60000);
  if (prev.handshake === "skip") {
    const hasUrl = Boolean(
      item.agent_card_url ||
        item.endpoint_url ||
        item.remote_url ||
        item.website,
    );
    // Skip with no URL: almost never re-burn discovery budget
    if (!hasUrl) return p - 50; // still >=0 only if boost high; effectively low
    return p + 400;
  }
  if (age > RETRY_DIRTY_MS) return p + 400;
  return p + 50;
}

export async function runProbeBudgeted(
  items: ProbeTarget[],
  max = 1,
): Promise<ProbeResult[]> {
  const state = await loadProbeState();
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

  const rankedLive = ranked.filter((x) => x.pri >= 0);
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
  while (selected.length < take && (ai < agents.length || mi < mcps.length)) {
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
  for (const { item } of queue) {
    if (out.length >= take) break;
    // Window/day budget still open?
    if (state.hourly_used >= state.hourly_cap) break;
    if (state.used >= state.budget) break;
    const kind =
      item.kind ||
      (item.agent_card_url || item.endpoint_url ? "agent" : "mcp");
    const result =
      kind === "agent"
        ? await probeAgent({ ...item, kind: "agent" })
        : await probeMcp({ ...item, kind: "mcp" });
    if (item.purpose === "weekly_recheck") {
      result.signals = [...(result.signals || []), "weekly-recheck"];
    }
    state.results[item.id] = result;
    // Alias keys so listing-lanes can match store ids / names
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
    // Unlimited weekly recheck accounting (no cap — scales with Active)
    if (item.purpose === "weekly_recheck") {
      const week = utcWeek();
      if (!state.weekly || state.weekly.week !== week) {
        state.weekly = { week, rechecked: 0, still_ok: 0, demoted: 0 };
      }
      state.weekly.rechecked += 1;
      if (result.handshake === "ok" && result.ok) state.weekly.still_ok += 1;
      else state.weekly.demoted += 1;
    }
    state.used += 1;
    state.hourly_used += 1;
    out.push(result);
  }
  state.last_tick_at = new Date().toISOString();
  state.updated_at = state.last_tick_at;
  // Cap result map size
  const ids = Object.keys(state.results);
  if (ids.length > 2500) {
    // Prefer primary ids over name:/url: aliases when trimming
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
  return out;
}

export async function getProbePublic() {
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
    probe_worker = { status: "missing" };
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

  const recent = Object.values(s.results)
    .filter((r) => r && r.probed_at)
    .sort((a, b) => (a.probed_at < b.probed_at ? 1 : -1))
    .slice(0, 30);

  // Dedupe recent by id
  const seenRecent = new Set<string>();
  const recentUnique = recent.filter((r) => {
    if (seenRecent.has(r.id)) return false;
    seenRecent.add(r.id);
    return true;
  });

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

  return {
    day: s.day,
    used: s.used,
    budget: s.budget,
    remaining: day_remaining,
    day_remaining,
    hourly_used: s.hourly_used,
    hourly_cap: s.hourly_cap,
    hourly_remaining,
    hour_bucket: s.hour_bucket,
    by_kind_today: { agents: agents_today, mcps: mcps_today },
    real_active_only: Boolean(s.real_active_only),
    baseline_note: s.baseline_note,
    wasted_probes_discarded: s.wasted_probes_discarded,
    last_tick_at: s.last_tick_at,
    // Next = last tick + exactly 6 minutes (cadence contract).
    next_tick_at: nextProbeFromLast(s.last_tick_at),
    probe_worker: probe_worker
      ? {
          status: probe_worker.status,
          last_tick_at: probe_worker.last_tick_at,
          next_tick_at: probe_worker.next_tick_at,
          last_probed: probe_worker.last_probed,
          last_reason: probe_worker.last_reason,
          last_result: probe_worker.last_result ?? null,
          last_used: probe_worker.last_used ?? null,
          ticks: probe_worker.ticks,
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
      window_minutes: 6,
      cadence:
        "1 probe / 6 min discovery-first (240/day) · unlimited weekly Active recheck at 7d",
      balance:
        "catch-up: 100% lagging kind until day counts within 1; then 50/50. Prefer never-probed.",
      max_per_hour: 10,
      priority:
        "never_probed > weekly_due_active > dirty/fail > partial/stale > skip fresh ok",
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
