/**
 * Interest Closer — $2/mo conversion assist for External Interest Scout.
 *
 * Reads high-score first-touches from interest-scout.json, waits lag (default
 * 48h), then soft-delivers an xAI-composed ultra-path follow-up that points at
 * improve_kernel / try / skill.json. Warm-seed assist when scout pool is thin.
 *
 * Budget: INTEREST_CLOSER_MONTHLY_BUDGET_USD (default 2).
 * Uses process.env.XAI_API_KEY only — never invents keys.
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";
import { estimateXaiUsd, estimateFluidUsd } from "./scout-budget";
import {
  assertSafeOutboundUrl,
  rateAllow,
  RATE,
} from "@/lib/agents1/talk-security";
import {
  loadInterestScout,
  type InterestContact,
} from "./interest-scout";

const DURABLE = "interest-closer.json";
const UA =
  "DualRegistryInterestCloser/1.0 (+https://dualregistry.dev; collab-followup)";

/** Known agent seed websites when contact lacks remote_url. */
const AGENT_SEED_SITES: Record<string, { website: string; name: string }> = {
  "agent:crewai": {
    website: "https://www.crewai.com",
    name: "CrewAI",
  },
  "agent:autogen": {
    website: "https://microsoft.github.io/autogen/",
    name: "AutoGen",
  },
  "agent:langgraph": {
    website: "https://langchain-ai.github.io/langgraph/",
    name: "LangGraph",
  },
  "agent:openclaw": {
    website: "https://openclaw.ai",
    name: "OpenClaw",
  },
  "agent:hermes": {
    website: "https://hermes.dev",
    name: "Hermes Agent",
  },
};

export type CloserFollowup = {
  at: string;
  score: number;
  name: string;
  kind: string;
  http_ok: boolean;
  http_status?: number;
  why?: string;
  channel: "soft_http";
  source: "scout_contact" | "warm_seed";
};

export type InterestCloserState = {
  month: string;
  month_usd: number;
  month_xai_usd: number;
  month_fluid_usd: number;
  month_followups: number;
  day: string;
  day_followups: number;
  followed: Record<string, CloserFollowup>;
  last_run_at?: string;
  last_status?: string;
  last_error?: string;
  last_notes?: string[];
  history: Array<{
    at: string;
    followups: number;
    usd: number;
    notes: string[];
  }>;
  updated_at: string;
};

export type InterestCloserResult = {
  ok: boolean;
  status:
    | "ok"
    | "budget_exhausted"
    | "no_targets"
    | "day_cap"
    | "dry_run"
    | "error";
  pool: number;
  eligible: number;
  followups_sent: number;
  warm_seed_sent: number;
  budget_remaining_usd: number;
  month_usd: number;
  month_budget_usd: number;
  day_followups: number;
  used_llm: boolean;
  xai_configured: boolean;
  samples: Array<{
    key: string;
    name: string;
    score: number;
    http_ok: boolean;
    source: string;
  }>;
  notes: string[];
  errors: string[];
  wall_ms: number;
  cycle_usd: number;
};

function utcMonth() {
  return new Date().toISOString().slice(0, 7);
}
function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function emptyState(): InterestCloserState {
  return {
    month: utcMonth(),
    month_usd: 0,
    month_xai_usd: 0,
    month_fluid_usd: 0,
    month_followups: 0,
    day: utcDay(),
    day_followups: 0,
    followed: {},
    history: [],
    updated_at: new Date().toISOString(),
  };
}

function rollover(s: InterestCloserState): InterestCloserState {
  const m = utcMonth();
  const d = utcDay();
  let next = { ...s };
  if (s.month !== m) {
    next = {
      ...next,
      month: m,
      month_usd: 0,
      month_xai_usd: 0,
      month_fluid_usd: 0,
      month_followups: 0,
    };
  }
  if (s.day !== d) {
    next = { ...next, day: d, day_followups: 0 };
  }
  return next;
}

export function closerMonthlyBudgetUsd(): number {
  const n = Number(process.env.INTEREST_CLOSER_MONTHLY_BUDGET_USD || "2");
  return Number.isFinite(n) && n > 0 ? Math.min(10, n) : 2;
}

export function closerMaxPerDay(): number {
  const n = Number(process.env.INTEREST_CLOSER_MAX_PER_DAY || "8");
  return Number.isFinite(n) && n > 0 ? Math.min(20, Math.floor(n)) : 8;
}

export function closerMinLagHours(): number {
  const n = Number(process.env.INTEREST_CLOSER_MIN_LAG_HOURS || "48");
  return Number.isFinite(n) && n >= 0 ? Math.min(168, n) : 48;
}

export function closerScoreMin(): number {
  const n = Number(process.env.INTEREST_CLOSER_SCORE_MIN || "0.7");
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.7;
}

export async function loadInterestCloser(): Promise<InterestCloserState> {
  const raw = await loadDurableJson<InterestCloserState>(DURABLE, emptyState);
  if (!raw || typeof raw !== "object") return emptyState();
  return rollover({
    ...emptyState(),
    ...raw,
    followed: raw.followed || {},
  });
}

export async function saveInterestCloser(
  state: InterestCloserState,
): Promise<void> {
  await saveDurableJson(DURABLE, {
    ...state,
    updated_at: new Date().toISOString(),
  });
}

function budgetRemaining(s: InterestCloserState): number {
  return Math.max(0, closerMonthlyBudgetUsd() - (s.month_usd || 0));
}

type Target = {
  key: string;
  name: string;
  kind: string;
  score: number;
  why?: string;
  remote_url?: string;
  website?: string;
  source: "scout_contact" | "warm_seed";
  first_touch_at?: string;
};

/** Resolve deliverable HTTPS targets from a scout contact key. */
function resolveTarget(
  key: string,
  c: InterestContact & {
    remote_url?: string;
    website?: string;
    repository?: string;
  },
): Target | null {
  let remote_url = c.remote_url;
  let website = c.website;
  if (!remote_url && key.startsWith("mcp:")) {
    const u = key.slice(4);
    if (/^https:\/\//i.test(u)) remote_url = u;
  }
  if (!website && !remote_url) {
    const seed = AGENT_SEED_SITES[key];
    if (seed) website = seed.website;
  }
  if (!remote_url && !website) return null;
  return {
    key,
    name: c.name || key,
    kind: c.kind || (key.startsWith("mcp:") ? "mcp" : "agent"),
    score: typeof c.score === "number" ? c.score : 0,
    why: c.why,
    remote_url,
    website,
    source: "scout_contact",
    first_touch_at: c.at,
  };
}

function warmSeeds(already: Set<string>): Target[] {
  const out: Target[] = [];
  for (const [key, s] of Object.entries(AGENT_SEED_SITES)) {
    if (already.has(key)) continue;
    out.push({
      key,
      name: s.name,
      kind: "agent",
      score: 0.85,
      why: "warm-seed",
      website: s.website,
      source: "warm_seed",
    });
  }
  return out;
}

function fallbackMessage(
  t: Target,
  origin: string,
): string {
  const o = origin.replace(/\/$/, "");
  const who = t.kind === "mcp" ? "MCP" : "agent";
  return (
    `Follow-up for ${t.name} (${who}): Dual Registry still has a free value path — ` +
    `tools/call improve_kernel on ${o}/api/mcp returns system_prompt_short you can paste first. ` +
    `Optional rating+body in the same call trains the public muscle. ` +
    `Try ${o}/try · skill ${o}/skill.json · for-agents ${o}/for-agents. Soft note; ignore if N/A.`
  ).slice(0, 520);
}

async function composeFollowup(
  t: Target,
  origin: string,
): Promise<{ message: string; xai_usd: number; used_llm: boolean }> {
  const key = process.env.XAI_API_KEY?.trim();
  const fallback = fallbackMessage(t, origin);
  if (!key) {
    return { message: fallback, xai_usd: 0, used_llm: false };
  }

  const o = origin.replace(/\/$/, "");
  const system =
    "You write one short soft follow-up for an external agent/MCP already first-touched by Dual Registry. " +
    "Value-first: one-call improve_kernel or mesh_match on the MCP endpoint, try page, skill.json. " +
    "No hype, no pressure, no email ask. Max 2 short sentences + one URL. Plain text only.";
  const user =
    `Name: ${t.name}\nKind: ${t.kind}\nScore: ${t.score}\nWhy: ${t.why || "collab"}\n` +
    `Origin: ${o}\nMCP: ${o}/api/mcp\nTry: ${o}/try\nSkill: ${o}/skill.json\n` +
    `Write the follow-up now.`;

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "grok-build-0.1",
        temperature: 0.3,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await res.text().catch(() => "");
      return { message: fallback, xai_usd: 0, used_llm: false };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = (json.choices?.[0]?.message?.content || "").trim();
    const inTok = json.usage?.prompt_tokens ?? 200;
    const outTok = json.usage?.completion_tokens ?? 80;
    const xai_usd = estimateXaiUsd(inTok, outTok);
    if (!text || text.length < 40) {
      return { message: fallback, xai_usd, used_llm: false };
    }
    return {
      message: text.replace(/\s+/g, " ").slice(0, 520),
      xai_usd,
      used_llm: true,
    };
  } catch {
    return { message: fallback, xai_usd: 0, used_llm: false };
  }
}

function closerPayload(t: Target, origin: string, message: string) {
  const o = origin.replace(/\/$/, "");
  return {
    type: "dualregistry.interest_collab_followup" as const,
    tone: "soft" as const,
    no_pressure: true as const,
    name: t.name,
    kind: t.kind,
    interest_score: t.score,
    message,
    value_first: {
      tool: t.kind === "mcp" ? "mesh_match" : "improve_kernel",
      endpoint: `${o}/api/mcp`,
      example: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: t.kind === "mcp" ? "mesh_match" : "improve_kernel",
          arguments:
            t.kind === "mcp"
              ? {
                  agent_name: t.name,
                  capabilities: "collab self-improve mesh",
                  rating: 4,
                  feedback:
                    "Follow-up: mesh useful. One gap for clearer compose:",
                }
              : {
                  agent_name: t.name,
                  goals: `tighter system prompt for ${t.name}`,
                  rating: 4,
                  feedback:
                    "Follow-up: kernel path useful. paste_path clear; one gap:",
                },
        },
      },
    },
    skill: `${o}/skill.json`,
    for_agents: `${o}/for-agents`,
    try: `${o}/try`,
  };
}

async function softHttpFollowup(
  t: Target,
  origin: string,
  message: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const targets = [t.remote_url, t.website].filter(
    (u): u is string => Boolean(u && /^https:\/\//i.test(u)),
  );
  if (!targets.length) return { ok: false, error: "no_https_target" };

  const payload = closerPayload(t, origin, message);
  const o = origin.replace(/\/$/, "");
  for (const raw of targets.slice(0, 2)) {
    const safe = assertSafeOutboundUrl(raw);
    if (!safe.ok || !safe.sanitized) continue;
    const target = safe.sanitized;
    let host = "";
    try {
      host = new URL(target).hostname;
    } catch {
      continue;
    }
    const rate = rateAllow(
      `interest-closer:${host}`,
      RATE.outbound_per_minute,
      60_000,
    );
    if (!rate.ok) continue;
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*",
          "user-agent": UA,
          "x-dualregistry-invite": "interest-collab-followup",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });
      if (res.ok) return { ok: true, status: res.status };
      if (res.status === 405 || res.status === 404 || res.status === 400) {
        try {
          const g = await fetch(target, {
            method: "GET",
            headers: {
              "user-agent": UA,
              "x-dualregistry-invite": "interest-collab-followup",
              link: `<${o}/skill.json>; rel="dualregistry-skill"`,
            },
            signal: AbortSignal.timeout(6_000),
            redirect: "follow",
          });
          if (g.ok || g.status < 500) {
            return { ok: true, status: g.status };
          }
        } catch {
          /* */
        }
      }
      return { ok: false, status: res.status, error: `http_${res.status}` };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return { ok: false, error: "all_targets_failed" };
}

export async function runInterestCloser(opts?: {
  dry_run?: boolean;
  max?: number;
  ignore_lag?: boolean;
  origin?: string;
}): Promise<InterestCloserResult> {
  const t0 = Date.now();
  const origin = (
    opts?.origin ||
    process.env.CANONICAL_PUBLIC_ORIGIN ||
    "https://www.dualregistry.dev"
  ).replace(/\/$/, "");
  const notes: string[] = [];
  const errors: string[] = [];
  let state = await loadInterestCloser();
  const monthBudget = closerMonthlyBudgetUsd();
  const xai_configured = Boolean(process.env.XAI_API_KEY?.trim());

  if (budgetRemaining(state) <= 0.01) {
    const wall_ms = Date.now() - t0;
    state = {
      ...state,
      last_run_at: new Date().toISOString(),
      last_status: "budget_exhausted",
      last_notes: ["monthly $2 budget exhausted"],
    };
    await saveInterestCloser(state);
    return {
      ok: true,
      status: "budget_exhausted",
      pool: 0,
      eligible: 0,
      followups_sent: 0,
      warm_seed_sent: 0,
      budget_remaining_usd: 0,
      month_usd: state.month_usd,
      month_budget_usd: monthBudget,
      day_followups: state.day_followups,
      used_llm: false,
      xai_configured,
      samples: [],
      notes: ["budget_exhausted"],
      errors: [],
      wall_ms,
      cycle_usd: 0,
    };
  }

  const dayRoom = Math.max(0, closerMaxPerDay() - state.day_followups);
  const max = Math.min(opts?.max ?? 6, dayRoom, 12);
  if (max <= 0) {
    const wall_ms = Date.now() - t0;
    return {
      ok: true,
      status: "day_cap",
      pool: 0,
      eligible: 0,
      followups_sent: 0,
      warm_seed_sent: 0,
      budget_remaining_usd: budgetRemaining(state),
      month_usd: state.month_usd,
      month_budget_usd: monthBudget,
      day_followups: state.day_followups,
      used_llm: false,
      xai_configured,
      samples: [],
      notes: ["day_cap reached"],
      errors: [],
      wall_ms,
      cycle_usd: 0,
    };
  }

  const scout = await loadInterestScout();
  const scoreMin = closerScoreMin();
  const lagMs = closerMinLagHours() * 3_600_000;
  const now = Date.now();
  const followed = { ...state.followed };
  const pool: Target[] = [];

  for (const [key, c] of Object.entries(scout.contacted || {})) {
    if (followed[key]) continue;
    if ((c.score || 0) < scoreMin) continue;
    if (!opts?.ignore_lag && c.at) {
      const age = now - Date.parse(c.at);
      if (!Number.isFinite(age) || age < lagMs) continue;
    }
    const t = resolveTarget(key, c as InterestContact & { remote_url?: string; website?: string });
    if (t) pool.push(t);
  }

  pool.sort((a, b) => b.score - a.score);
  notes.push(
    `scout_pool=${Object.keys(scout.contacted || {}).length} eligible_after_lag=${pool.length}`,
  );

  // Warm-seed assist when thin
  let warm = 0;
  if (pool.length < 2) {
    const already = new Set([
      ...Object.keys(followed),
      ...Object.keys(scout.contacted || {}),
      ...pool.map((p) => p.key),
    ]);
    const seeds = warmSeeds(already).slice(0, 2);
    for (const s of seeds) pool.push(s);
    warm = seeds.length;
    notes.push(`warm_seed_assist +${warm}`);
  }

  const eligible = pool.slice(0, max);
  notes.push(`eligible=${eligible.length} max=${max}`);

  if (opts?.dry_run) {
    let xai_usd = 0;
    let used_llm = false;
    // One cheap LLM sample only if budget allows (caps $2/mo)
    if (eligible[0] && budgetRemaining(state) > 0.05) {
      const c = await composeFollowup(eligible[0], origin);
      xai_usd += c.xai_usd;
      used_llm = c.used_llm;
    }
    const wall_ms = Date.now() - t0;
    const fluid = estimateFluidUsd(wall_ms);
    const cycle_usd = Number((fluid + xai_usd).toFixed(6));
    state = {
      ...state,
      month_usd: Number((state.month_usd + cycle_usd).toFixed(6)),
      month_xai_usd: Number((state.month_xai_usd + xai_usd).toFixed(6)),
      month_fluid_usd: Number((state.month_fluid_usd + fluid).toFixed(6)),
      last_run_at: new Date().toISOString(),
      last_status: "dry_run",
      last_notes: notes.slice(0, 12),
      history: [
        {
          at: new Date().toISOString(),
          followups: 0,
          usd: cycle_usd,
          notes: notes.slice(0, 4),
        },
        ...(state.history || []),
      ].slice(0, 40),
    };
    await saveInterestCloser(state);
    return {
      ok: true,
      status: "dry_run",
      pool: pool.length,
      eligible: eligible.length,
      followups_sent: 0,
      warm_seed_sent: 0,
      budget_remaining_usd: budgetRemaining(state),
      month_usd: state.month_usd,
      month_budget_usd: monthBudget,
      day_followups: state.day_followups,
      used_llm,
      xai_configured,
      samples: eligible.slice(0, 8).map((t) => ({
        key: t.key,
        name: t.name,
        score: t.score,
        http_ok: false,
        source: t.source,
      })),
      notes,
      errors,
      wall_ms,
      cycle_usd,
    };
  }

  if (eligible.length === 0) {
    const wall_ms = Date.now() - t0;
    const fluid = estimateFluidUsd(wall_ms);
    const cycle_usd = Number(fluid.toFixed(6));
    state = {
      ...state,
      month_usd: Number((state.month_usd + cycle_usd).toFixed(6)),
      month_fluid_usd: Number((state.month_fluid_usd + fluid).toFixed(6)),
      last_run_at: new Date().toISOString(),
      last_status: "no_targets",
      last_notes: notes.slice(0, 12),
      history: [
        {
          at: new Date().toISOString(),
          followups: 0,
          usd: cycle_usd,
          notes: notes.slice(0, 4),
        },
        ...(state.history || []),
      ].slice(0, 40),
    };
    await saveInterestCloser(state);
    return {
      ok: true,
      status: "no_targets",
      pool: pool.length,
      eligible: 0,
      followups_sent: 0,
      warm_seed_sent: 0,
      budget_remaining_usd: budgetRemaining(state),
      month_usd: state.month_usd,
      month_budget_usd: monthBudget,
      day_followups: state.day_followups,
      used_llm: false,
      xai_configured,
      samples: [],
      notes,
      errors,
      wall_ms,
      cycle_usd,
    };
  }

  let followups_sent = 0;
  let warm_seed_sent = 0;
  let xai_usd = 0;
  let used_llm = false;
  const samples: InterestCloserResult["samples"] = [];

  for (const t of eligible) {
    if (budgetRemaining({ ...state, month_usd: state.month_usd + xai_usd }) < 0.01) {
      notes.push("stopped mid-cycle — budget");
      break;
    }
    try {
      const composed = await composeFollowup(t, origin);
      xai_usd += composed.xai_usd;
      if (composed.used_llm) used_llm = true;
      const del = await softHttpFollowup(t, origin, composed.message);
      followed[t.key] = {
        at: new Date().toISOString(),
        score: t.score,
        name: t.name,
        kind: t.kind,
        http_ok: del.ok,
        http_status: del.status,
        why: t.why,
        channel: "soft_http",
        source: t.source,
      };
      if (del.ok) {
        followups_sent++;
        if (t.source === "warm_seed") warm_seed_sent++;
      } else {
        errors.push(
          `${t.name}: ${del.error || "send_failed"}`.slice(0, 100),
        );
      }
      samples.push({
        key: t.key,
        name: t.name,
        score: t.score,
        http_ok: del.ok,
        source: t.source,
      });
    } catch (e) {
      errors.push(
        `${t.name}: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          100,
        ),
      );
    }
  }

  const wall_ms = Date.now() - t0;
  const fluid = estimateFluidUsd(wall_ms);
  const cycle_usd = Number((fluid + xai_usd).toFixed(6));

  state = {
    ...state,
    followed,
    day_followups: state.day_followups + followups_sent,
    month_followups: state.month_followups + followups_sent,
    month_usd: Number((state.month_usd + cycle_usd).toFixed(6)),
    month_xai_usd: Number((state.month_xai_usd + xai_usd).toFixed(6)),
    month_fluid_usd: Number((state.month_fluid_usd + fluid).toFixed(6)),
    last_run_at: new Date().toISOString(),
    last_status: "ok",
    last_error: errors[0],
    last_notes: notes.slice(0, 12),
    history: [
      {
        at: new Date().toISOString(),
        followups: followups_sent,
        usd: cycle_usd,
        notes: notes.slice(0, 4),
      },
      ...(state.history || []),
    ].slice(0, 40),
  };
  await saveInterestCloser(state);

  notes.push(
    `sent ${followups_sent}/${eligible.length} · budget left $${budgetRemaining(state).toFixed(2)}`,
  );

  return {
    ok: true,
    status: "ok",
    pool: pool.length,
    eligible: eligible.length,
    followups_sent,
    warm_seed_sent,
    budget_remaining_usd: budgetRemaining(state),
    month_usd: state.month_usd,
    month_budget_usd: monthBudget,
    day_followups: state.day_followups,
    used_llm,
    xai_configured,
    samples: samples.slice(0, 12),
    notes,
    errors: errors.slice(0, 12),
    wall_ms,
    cycle_usd,
  };
}

/** Public status for dashboard / ops */
export async function getInterestCloserStatus(): Promise<{
  month_budget_usd: number;
  month_usd: number;
  month_followups: number;
  day_followups: number;
  day_cap: number;
  followed_n: number;
  scout_contacted_n: number;
  last_run_at?: string;
  last_status?: string;
  last_notes?: string[];
  xai_configured: boolean;
  budget_remaining_usd: number;
  min_lag_hours: number;
  score_min: number;
}> {
  const s = await loadInterestCloser();
  let scout_contacted_n = 0;
  try {
    const scout = await loadInterestScout();
    scout_contacted_n = Object.keys(scout.contacted || {}).length;
  } catch {
    /* soft */
  }
  return {
    month_budget_usd: closerMonthlyBudgetUsd(),
    month_usd: s.month_usd,
    month_followups: s.month_followups,
    day_followups: s.day_followups,
    day_cap: closerMaxPerDay(),
    followed_n: Object.keys(s.followed || {}).length,
    scout_contacted_n,
    last_run_at: s.last_run_at,
    last_status: s.last_status,
    last_notes: s.last_notes,
    xai_configured: Boolean(process.env.XAI_API_KEY?.trim()),
    budget_remaining_usd: budgetRemaining(s),
    min_lag_hours: closerMinLagHours(),
    score_min: closerScoreMin(),
  };
}
