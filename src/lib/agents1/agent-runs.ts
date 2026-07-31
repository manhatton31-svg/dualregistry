/**
 * Dual agentic run observability — mirrors Vercel Agent Runs concepts
 * (status, duration, token/usage, trigger) for Dual MCP tools + product ops.
 *
 * High-water merge: multi-instance cold starts must not zero "today" totals.
 */
import {
  loadDurableJson,
  saveDurableJson,
  durableRemoteRawUrl,
} from "./durable-json";
import { recordPlatformUsage } from "./platform-cost";
import { deferWork } from "./defer-work";

const DURABLE_NAME = "agent-runs.json";
const MAX_RUNS = 120;

export type AgentRunStatus =
  | "ok"
  | "error"
  | "skipped"
  | "partial"
  | "running";

export type AgentRun = {
  id: string;
  title: string;
  tool?: string;
  trigger: "mcp" | "a2a" | "http" | "cron" | "product" | "internal";
  status: AgentRunStatus;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  token_usage?: number;
  usd_estimate?: number;
  listing_id?: string;
  error?: string;
  meta?: Record<string, unknown>;
};

export type AgentRunsState = {
  day: string;
  runs: AgentRun[];
  totals: {
    n: number;
    ok: number;
    error: number;
    skipped: number;
    duration_ms: number;
    token_usage: number;
  };
  updated_at: string;
};

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function emptyTotals() {
  return {
    n: 0,
    ok: 0,
    error: 0,
    skipped: 0,
    duration_ms: 0,
    token_usage: 0,
  };
}

function fresh(): AgentRunsState {
  return {
    day: utcDay(),
    runs: [],
    totals: emptyTotals(),
    updated_at: new Date().toISOString(),
  };
}

function recomputeTotals(runs: AgentRun[]): AgentRunsState["totals"] {
  const t = emptyTotals();
  for (const run of runs) {
    t.n += 1;
    if (run.status === "ok") t.ok += 1;
    else if (run.status === "error") t.error += 1;
    else if (run.status === "skipped") t.skipped += 1;
    t.duration_ms += run.duration_ms || 0;
    t.token_usage += run.token_usage || 0;
  }
  return t;
}

/** Union runs by id; keep same-day only; recompute totals from runs. */
export function mergeAgentRuns(
  a: AgentRunsState,
  b: AgentRunsState,
): AgentRunsState {
  const day = utcDay();
  const map = new Map<string, AgentRun>();
  for (const run of [...(a.runs || []), ...(b.runs || [])]) {
    if (!run?.id) continue;
    // Keep runs from today (started_at day) or if state.day is today and run lacks day
    const startedDay = (run.started_at || "").slice(0, 10);
    if (startedDay && startedDay !== day) continue;
    const prev = map.get(run.id);
    if (!prev) {
      map.set(run.id, run);
      continue;
    }
    // Prefer completed / longer duration
    const prevEnded = prev.ended_at || prev.started_at || "";
    const nextEnded = run.ended_at || run.started_at || "";
    if (nextEnded >= prevEnded) map.set(run.id, { ...prev, ...run });
  }
  const runs = [...map.values()]
    .sort((x, y) =>
      (y.started_at || "").localeCompare(x.started_at || ""),
    )
    .slice(0, MAX_RUNS);
  return {
    day,
    runs,
    totals: recomputeTotals(runs),
    updated_at:
      (a.updated_at || "") >= (b.updated_at || "")
        ? a.updated_at || new Date().toISOString()
        : b.updated_at || new Date().toISOString(),
  };
}

let mem: AgentRunsState | null = null;
let chain: Promise<void> = Promise.resolve();

async function fetchRemoteRuns(): Promise<AgentRunsState | null> {
  try {
    const url = durableRemoteRawUrl(DURABLE_NAME) + `?t=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryRuns/1.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<!") || text.trim().startsWith("404"))
      return null;
    const j = JSON.parse(text) as AgentRunsState;
    if (!j || !Array.isArray(j.runs)) return null;
    return j;
  } catch {
    return null;
  }
}

export async function loadAgentRuns(): Promise<AgentRunsState> {
  let local: AgentRunsState | null = null;
  try {
    const raw = await loadDurableJson<AgentRunsState>(DURABLE_NAME, () =>
      fresh(),
    );
    if (raw && Array.isArray(raw.runs)) local = raw;
  } catch {
    /* */
  }
  const remote = await fetchRemoteRuns();

  let merged = fresh();
  if (local) merged = mergeAgentRuns(merged, local);
  if (remote) merged = mergeAgentRuns(merged, remote);
  if (mem) merged = mergeAgentRuns(merged, mem);

  // If everything empty but mem has same-day, keep mem
  if (merged.totals.n === 0 && mem && mem.day === utcDay() && mem.totals.n > 0) {
    merged = mem;
  }

  mem = merged;
  return merged;
}

async function persist(s: AgentRunsState, opts?: { await?: boolean }) {
  // High-water merge before write
  let next = s;
  if (mem) next = mergeAgentRuns(next, mem);
  try {
    const remote = await fetchRemoteRuns();
    if (remote) next = mergeAgentRuns(next, remote);
  } catch {
    /* */
  }
  next = {
    ...next,
    day: utcDay(),
    totals: recomputeTotals(next.runs),
    updated_at: new Date().toISOString(),
  };
  mem = next;

  chain = chain.then(async () => {
    try {
      await saveDurableJson(DURABLE_NAME, next);
    } catch {
      /* */
    }
  });
  if (opts?.await) {
    await chain;
  } else {
    deferWork(chain);
  }
}

function newId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function recordAgentRun(
  input: Omit<AgentRun, "id" | "started_at"> & {
    started_at?: string;
    id?: string;
    bill?: boolean;
    route?: string;
    await_persist?: boolean;
  },
): Promise<AgentRun> {
  const s = await loadAgentRuns();
  // Do NOT wipe other instances' today runs — mergeAgentRuns already filters day
  if (s.day !== utcDay()) {
    // keep only fresh shell; merge will drop old-day runs
    Object.assign(s, { day: utcDay(), runs: s.runs, totals: s.totals });
  }
  const started = input.started_at || new Date().toISOString();
  const ended = input.ended_at || new Date().toISOString();
  const duration =
    input.duration_ms ??
    Math.max(0, Date.parse(ended) - Date.parse(started) || 0);
  const run: AgentRun = {
    id: input.id || newId(),
    title: input.title,
    tool: input.tool,
    trigger: input.trigger,
    status: input.status,
    started_at: started,
    ended_at: ended,
    duration_ms: duration,
    token_usage: input.token_usage,
    usd_estimate: input.usd_estimate,
    listing_id: input.listing_id,
    error: input.error,
    meta: input.meta,
  };

  s.runs = [run, ...s.runs].slice(0, MAX_RUNS);
  s.totals = recomputeTotals(s.runs);
  s.updated_at = ended;
  s.day = utcDay();

  if (input.bill !== false) {
    try {
      const cost = await recordPlatformUsage({
        class:
          input.trigger === "cron"
            ? "cron_probe"
            : input.trigger === "mcp" || input.trigger === "a2a"
              ? "agent_tool"
              : input.trigger === "product"
                ? "product"
                : "other",
        wall_ms: duration,
        route: input.route,
        label: run.tool || run.title,
        skipped: run.status === "skipped",
      });
      const last = cost.today.events[0];
      if (last) run.usd_estimate = last.usd;
    } catch {
      /* */
    }
  }

  await persist(s, { await: input.await_persist === true });
  return run;
}

export async function withAgentRun<T>(
  meta: {
    title: string;
    tool?: string;
    trigger: AgentRun["trigger"];
    listing_id?: string;
    route?: string;
    bill?: boolean;
  },
  fn: () => Promise<T>,
): Promise<{ result: T; run: AgentRun }> {
  const started_at = new Date().toISOString();
  const t0 = Date.now();
  try {
    const result = await fn();
    const duration_ms = Date.now() - t0;
    const run = await recordAgentRun({
      ...meta,
      started_at,
      ended_at: new Date().toISOString(),
      duration_ms,
      status: "ok",
    });
    return { result, run };
  } catch (e) {
    const duration_ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    await recordAgentRun({
      ...meta,
      started_at,
      ended_at: new Date().toISOString(),
      duration_ms,
      status: "error",
      error: msg.slice(0, 400),
    });
    throw e;
  }
}

export function agentRunsPublic(s: AgentRunsState) {
  const avg =
    s.totals.n > 0 ? Math.round(s.totals.duration_ms / s.totals.n) : 0;
  return {
    ok: true,
    framework: "dual-registry",
    note: "Agent Runs-style observability for Dual MCP/tools (not eve). Same ops questions: what ran, duration, cost, errors.",
    day: s.day,
    totals: {
      ...s.totals,
      avg_duration_ms: avg,
      success_rate:
        s.totals.n > 0
          ? Math.round((s.totals.ok / s.totals.n) * 1000) / 1000
          : null,
    },
    recent: s.runs.slice(0, 40),
    updated_at: s.updated_at,
  };
}
