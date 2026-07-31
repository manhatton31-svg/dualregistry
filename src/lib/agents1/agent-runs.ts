/**
 * Dual agentic run observability — mirrors Vercel Agent Runs concepts
 * (status, duration, token/usage, trigger) for Dual MCP tools + product ops.
 * Not eve-native; same ops surface for debugging agent behavior in production.
 */
import { loadDurableJson, saveDurableJson } from "./durable-json";
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
  /** Approx model/product tokens if known */
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

function fresh(): AgentRunsState {
  return {
    day: utcDay(),
    runs: [],
    totals: {
      n: 0,
      ok: 0,
      error: 0,
      skipped: 0,
      duration_ms: 0,
      token_usage: 0,
    },
    updated_at: new Date().toISOString(),
  };
}

let mem: AgentRunsState | null = null;
let chain: Promise<void> = Promise.resolve();

export async function loadAgentRuns(): Promise<AgentRunsState> {
  if (mem && mem.day === utcDay()) return mem;
  try {
    const raw = await loadDurableJson<AgentRunsState>(DURABLE_NAME, () =>
      fresh(),
    );
    if (raw?.day === utcDay() && Array.isArray(raw.runs)) {
      mem = raw;
      return mem;
    }
  } catch {
    /* */
  }
  mem = fresh();
  return mem;
}

async function persist(s: AgentRunsState, opts?: { await?: boolean }) {
  mem = s;
  chain = chain.then(async () => {
    try {
      await saveDurableJson(DURABLE_NAME, s);
    } catch {
      /* */
    }
  });
  if (opts?.await) {
    await chain;
  } else {
    // waitUntil keeps durable write alive without extending provisioned wall
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
    /** Also bill platform cost (default true for non-skipped) */
    bill?: boolean;
    route?: string;
  },
): Promise<AgentRun> {
  const s = await loadAgentRuns();
  if (s.day !== utcDay()) {
    Object.assign(s, fresh());
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
  s.totals.n += 1;
  if (run.status === "ok") s.totals.ok += 1;
  else if (run.status === "error") s.totals.error += 1;
  else if (run.status === "skipped") s.totals.skipped += 1;
  s.totals.duration_ms += duration;
  s.totals.token_usage += run.token_usage || 0;
  s.updated_at = ended;

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

  await persist(s);
  return run;
}

/** Timed agent tool execution with automatic run + cost recording. */
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
