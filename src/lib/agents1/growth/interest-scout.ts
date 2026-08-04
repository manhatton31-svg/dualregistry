/**
 * External Interest Scout — NEW inbound supply (not growth-scout).
 *
 * Pulls agents/MCPs from *external* public registries (official MCP Registry +
 * quality agent seeds), ranks them for collab/self-improvement interest via
 * xAI (grok-build-0.1), then soft-delivers a value-first improve_kernel pitch.
 *
 * Budget default: $5/mo (INTEREST_SCOUT_MONTHLY_BUDGET_USD).
 * Uses process.env.XAI_API_KEY only — never invents keys.
 *
 * Differs from growth-scout: does NOT invite already-Live Dual listings;
 * sources external catalog only.
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

const DURABLE = "interest-scout.json";
const UA =
  "DualRegistryInterestScout/1.0 (+https://dualregistry.dev; collab-self-improve)";

const INTEREST_KEYWORDS =
  /\b(self[- ]?improv|recursive|kernel|feedback|learning|runtime|system[- ]?prompt|constitution|agent[- ]?loop|metacogn|reflection|stigmerg|mesh|tool[- ]?policy|autonom|orchestrat|memory|critic|dogfood|improve)\b/i;

export type InterestCandidate = {
  key: string;
  kind: "agent" | "mcp";
  name: string;
  description: string;
  remote_url?: string;
  website?: string;
  repository?: string;
  source: string;
};

export type InterestContact = {
  at: string;
  score: number;
  why?: string;
  http_ok: boolean;
  http_status?: number;
  channel: "soft_http";
  name: string;
  kind: string;
};

export type InterestScoutState = {
  month: string;
  month_usd: number;
  month_xai_usd: number;
  month_fluid_usd: number;
  month_outreaches: number;
  day: string;
  day_outreaches: number;
  contacted: Record<string, InterestContact>;
  last_run_at?: string;
  last_status?: string;
  last_error?: string;
  last_notes?: string[];
  history: Array<{
    at: string;
    outreaches: number;
    usd: number;
    scored: number;
    notes: string[];
  }>;
  updated_at: string;
};

export type InterestScoutResult = {
  ok: boolean;
  status:
    | "ok"
    | "budget_exhausted"
    | "no_targets"
    | "day_cap"
    | "dry_run"
    | "error";
  candidates_seen: number;
  keyword_hits: number;
  scored: number;
  outreaches_sent: number;
  skipped_already: number;
  budget_remaining_usd: number;
  month_usd: number;
  month_budget_usd: number;
  day_outreaches: number;
  used_llm: boolean;
  xai_configured: boolean;
  samples: Array<{
    key: string;
    name: string;
    score: number;
    why?: string;
    http_ok: boolean;
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

function emptyState(): InterestScoutState {
  return {
    month: utcMonth(),
    month_usd: 0,
    month_xai_usd: 0,
    month_fluid_usd: 0,
    month_outreaches: 0,
    day: utcDay(),
    day_outreaches: 0,
    contacted: {},
    history: [],
    updated_at: new Date().toISOString(),
  };
}

function rollover(s: InterestScoutState): InterestScoutState {
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
      month_outreaches: 0,
    };
  }
  if (s.day !== d) {
    next = { ...next, day: d, day_outreaches: 0 };
  }
  return next;
}

export function interestMonthlyBudgetUsd(): number {
  const n = Number(process.env.INTEREST_SCOUT_MONTHLY_BUDGET_USD || "5");
  return Number.isFinite(n) && n > 0 ? Math.min(25, n) : 5;
}

export function interestMaxPerDay(): number {
  const n = Number(process.env.INTEREST_SCOUT_MAX_PER_DAY || "20");
  return Number.isFinite(n) && n > 0 ? Math.min(40, Math.floor(n)) : 20;
}

export function interestCooldownDays(): number {
  const n = Number(process.env.INTEREST_SCOUT_COOLDOWN_DAYS || "14");
  return Number.isFinite(n) && n > 0 ? Math.min(60, Math.floor(n)) : 14;
}

export function interestScoreThreshold(): number {
  const n = Number(process.env.INTEREST_SCOUT_SCORE_MIN || "0.7");
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.7;
}

export async function loadInterestScout(): Promise<InterestScoutState> {
  const raw = await loadDurableJson<InterestScoutState>(DURABLE, emptyState);
  if (!raw || typeof raw !== "object") return emptyState();
  return rollover({ ...emptyState(), ...raw, contacted: raw.contacted || {} });
}

export async function saveInterestScout(
  state: InterestScoutState,
): Promise<void> {
  await saveDurableJson(DURABLE, {
    ...state,
    updated_at: new Date().toISOString(),
  });
}

function budgetRemaining(s: InterestScoutState): number {
  return Math.max(0, interestMonthlyBudgetUsd() - (s.month_usd || 0));
}

function stillCool(s: InterestScoutState, key: string): boolean {
  const c = s.contacted[key];
  if (!c?.at) return false;
  const age = Date.now() - Date.parse(c.at);
  return age < interestCooldownDays() * 86_400_000;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: AbortSignal.timeout(attempt === 0 ? 10_000 : 14_000),
      });
      if (!res.ok) {
        if (attempt === 0) continue;
        return null;
      }
      return (await res.json()) as T;
    } catch {
      if (attempt === 1) return null;
    }
  }
  return null;
}

/** Official MCP Registry — external remotes only, shallow pages for cost. */
async function pullOfficialMcp(max = 80): Promise<InterestCandidate[]> {
  const out: InterestCandidate[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 2 && out.length < max; page++) {
    const q = new URL("https://registry.modelcontextprotocol.io/v0/servers");
    q.searchParams.set("limit", "40");
    // Prefer recent: no sort API — walk pages; cursor advances
    if (cursor) q.searchParams.set("cursor", cursor);
    const data = await fetchJson<{
      servers?: Array<{
        server?: {
          name?: string;
          description?: string;
          title?: string;
          repository?: { url?: string } | string;
          websiteUrl?: string;
          remotes?: Array<{ url?: string }>;
        };
      }>;
      metadata?: { nextCursor?: string };
      nextCursor?: string;
    }>(q.toString());
    for (const row of data?.servers || []) {
      const s = row.server || {};
      const remotes = (s.remotes || [])
        .map((r) => r?.url)
        .filter((u): u is string => Boolean(u && /^https:\/\//i.test(u)));
      if (!remotes.length) continue;
      const name = (s.name || s.title || remotes[0] || "mcp").slice(0, 80);
      const repo =
        typeof s.repository === "string" ? s.repository : s.repository?.url;
      for (const remote of remotes.slice(0, 2)) {
        if (seen.has(remote)) continue;
        seen.add(remote);
        out.push({
          key: `mcp:${remote}`.toLowerCase().slice(0, 160),
          kind: "mcp",
          name,
          description: (s.description || "").slice(0, 400),
          remote_url: remote,
          website: s.websiteUrl || remote,
          repository: repo,
          source: "official-mcp-registry",
        });
        if (out.length >= max) break;
      }
      if (out.length >= max) break;
    }
    cursor = data?.metadata?.nextCursor || data?.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/** High-signal agent seeds (external frameworks) — self-improve adjacent. */
function pullAgentSeeds(): InterestCandidate[] {
  const seeds: InterestCandidate[] = [
    {
      key: "agent:crewai",
      kind: "agent",
      name: "CrewAI",
      description:
        "Multi-agent orchestration with tools, memory, and role-playing autonomous agents.",
      website: "https://www.crewai.com",
      repository: "https://github.com/crewAIInc/crewAI",
      source: "seed:interest",
    },
    {
      key: "agent:autogen",
      kind: "agent",
      name: "AutoGen",
      description:
        "Microsoft multi-agent conversation framework for cooperating LLM agents and group chat.",
      website: "https://microsoft.github.io/autogen/",
      repository: "https://github.com/microsoft/autogen",
      source: "seed:interest",
    },
    {
      key: "agent:langgraph",
      kind: "agent",
      name: "LangGraph",
      description:
        "Stateful agent graphs with cycles, memory, and human-in-the-loop for self-improving workflows.",
      website: "https://langchain-ai.github.io/langgraph/",
      repository: "https://github.com/langchain-ai/langgraph",
      source: "seed:interest",
    },
    {
      key: "agent:openclaw",
      kind: "agent",
      name: "OpenClaw",
      description:
        "Open agent runtime focused on tools, skills, and iterative self-improvement loops.",
      website: "https://openclaw.ai",
      source: "seed:interest",
    },
    {
      key: "agent:hermes",
      kind: "agent",
      name: "Hermes Agent",
      description:
        "Agent runtime and skill packs for autonomous tool use and recursive improvement.",
      website: "https://hermes.dev",
      source: "seed:interest",
    },
  ];
  return seeds;
}

async function loadCleanSkipUrls(): Promise<Set<string>> {
  const skip = new Set<string>();
  try {
    const { loadCleanRegistry } = await import(
      "@/lib/agents1/clean-registry"
    );
    const reg = await Promise.race([
      loadCleanRegistry(),
      new Promise<null>((r) => setTimeout(() => r(null), 2500)),
    ]);
    if (!reg) return skip;
    for (const it of Object.values(reg?.items || {})) {
      const t = (it as { target?: string }).target;
      if (t) skip.add(t.toLowerCase());
    }
  } catch {
    /* soft */
  }
  return skip;
}

function keywordHit(c: InterestCandidate): boolean {
  const blob = `${c.name} ${c.description}`;
  return INTEREST_KEYWORDS.test(blob);
}

/** Cheap heuristic score 0–1 when xAI unavailable. */
function heuristicScore(c: InterestCandidate): {
  score: number;
  why: string;
} {
  const blob = `${c.name} ${c.description}`.toLowerCase();
  let score = 0.35;
  const hits: string[] = [];
  const boosts: Array<[RegExp, number, string]> = [
    [/\bself[- ]?improv/, 0.25, "self-improve"],
    [/\brecursive|loop|cycle/, 0.15, "loop"],
    [/\bkernel|constitution|system[- ]?prompt/, 0.2, "kernel"],
    [/\bfeedback|critique|critic/, 0.15, "feedback"],
    [/\blearn|memory|reflect/, 0.12, "learning"],
    [/\bagent|runtime|orchestr/, 0.08, "agent-runtime"],
    [/\bmcp|tool[- ]?policy|mesh/, 0.08, "mcp-mesh"],
  ];
  for (const [re, w, label] of boosts) {
    if (re.test(blob)) {
      score += w;
      hits.push(label);
    }
  }
  return {
    score: Math.min(0.95, Number(score.toFixed(2))),
    why: hits.length ? hits.join(",") : "generic",
  };
}

type ScoreRow = { i: number; s: number; why: string };

/** Batch classify with grok-build-0.1 — falls back to heuristic. */
async function scoreWithXai(
  batch: InterestCandidate[],
): Promise<{ rows: ScoreRow[]; xai_usd: number; used_llm: boolean }> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key || batch.length === 0) {
    return {
      rows: batch.map((c, i) => {
        const h = heuristicScore(c);
        return { i, s: h.score, why: h.why };
      }),
      xai_usd: 0,
      used_llm: false,
    };
  }

  const lines = batch
    .map(
      (c, i) =>
        `${i}|${c.kind}|${c.name.slice(0, 60)}|${(c.description || "").replace(/\s+/g, " ").slice(0, 160)}`,
    )
    .join("\n");

  const system =
    "You rank agents/MCPs for interest in collaborative self-improvement: system prompts, kernels, feedback loops, recursive learning, agent runtime quality, MCP tool policy. " +
    "Return ONLY a JSON array: [{\"i\":0,\"s\":0.0,\"why\":\"3-word-reason\"},...] " +
    "s is 0.00-1.00. No markdown. No prose.";
  const user =
    `Score each line (index|kind|name|desc) for Dual Registry collab fit.\n` +
    `High if they build/run self-improving agents or agent-facing MCP quality.\n` +
    `Low if pure commerce, image gen, or unrelated utilities.\n` +
    lines;

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "grok-build-0.1",
        temperature: 0.1,
        max_tokens: 500,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      await res.text().catch(() => "");
      // One cheap single-shot on first candidate only if batch 4xx/5xx
      return {
        rows: batch.map((c, i) => {
          const h = heuristicScore(c);
          return {
            i,
            s: h.score,
            why: `http${res.status}:${h.why}`.slice(0, 40),
          };
        }),
        xai_usd: 0,
        used_llm: false,
      };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = (json.choices?.[0]?.message?.content || "").trim();
    const inTok = json.usage?.prompt_tokens ?? 400;
    const outTok = json.usage?.completion_tokens ?? 200;
    const xai_usd = estimateXaiUsd(inTok, outTok);

    let parsed: ScoreRow[] = [];
    try {
      const m = text.match(/\[[\s\S]*\]/);
      parsed = JSON.parse(m ? m[0] : text) as ScoreRow[];
    } catch {
      parsed = [];
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return {
        rows: batch.map((c, i) => {
          const h = heuristicScore(c);
          return { i, s: h.score, why: `parse_fail:${h.why}` };
        }),
        xai_usd,
        used_llm: false,
      };
    }

    const byI = new Map<number, ScoreRow>();
    for (const r of parsed) {
      if (typeof r?.i === "number" && typeof r?.s === "number") {
        byI.set(r.i, {
          i: r.i,
          s: Math.max(0, Math.min(1, Number(r.s))),
          why: String(r.why || "").slice(0, 40),
        });
      }
    }
    const rows = batch.map((c, i) => {
      const hit = byI.get(i);
      if (hit) return hit;
      const h = heuristicScore(c);
      return { i, s: h.score, why: h.why };
    });
    return { rows, xai_usd, used_llm: true };
  } catch {
    return {
      rows: batch.map((c, i) => {
        const h = heuristicScore(c);
        return { i, s: h.score, why: `err:${h.why}` };
      }),
      xai_usd: 0,
      used_llm: false,
    };
  }
}

function valuePitch(c: InterestCandidate, origin: string): string {
  const o = origin.replace(/\/$/, "");
  const who = c.kind === "mcp" ? "MCP" : "agent";
  return (
    `Dual Registry collab note for ${c.name} (${who}): ` +
    `one-call value tools/call improve_kernel on ${o}/api/mcp → full system_prompt_short (paste first). ` +
    `Optional same-call rating+body trains the public muscle. ` +
    `Skill ${o}/skill.json · for-agents ${o}/for-agents. Ignore if N/A.`
  ).slice(0, 520);
}

function interestPayload(
  c: InterestCandidate,
  origin: string,
  message: string,
  score: number,
) {
  const o = origin.replace(/\/$/, "");
  return {
    type: "dualregistry.interest_collab_invite" as const,
    tone: "soft" as const,
    no_pressure: true as const,
    name: c.name,
    kind: c.kind,
    interest_score: score,
    message,
    value_first: {
      tool: "improve_kernel",
      endpoint: `${o}/api/mcp`,
      example: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: c.kind === "mcp" ? "mesh_match" : "improve_kernel",
          arguments:
            c.kind === "mcp"
              ? {
                  agent_name: c.name,
                  capabilities: c.description.slice(0, 120),
                  rating: 4,
                  feedback:
                    "Mesh path useful for agents. Want clearer compose next step.",
                }
              : {
                  agent_name: c.name,
                  goals: `tighter system prompt for ${c.name}`,
                  rating: 4,
                  feedback:
                    "Useful kernel path. paste_path clear; one gap for me:",
                },
        },
      },
    },
    skill: `${o}/skill.json`,
    for_agents: `${o}/for-agents`,
    try: `${o}/try`,
  };
}

async function softHttpDeliver(
  c: InterestCandidate,
  origin: string,
  message: string,
  score: number,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const targets = [c.remote_url, c.website].filter(
    (u): u is string => Boolean(u && /^https:\/\//i.test(u)),
  );
  if (!targets.length) return { ok: false, error: "no_https_target" };

  const payload = interestPayload(c, origin, message, score);
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
      `interest-scout:${host}`,
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
          "x-dualregistry-invite": "interest-collab",
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
              "x-dualregistry-invite": "interest-collab",
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

export async function runInterestScout(opts?: {
  dry_run?: boolean;
  max?: number;
  origin?: string;
}): Promise<InterestScoutResult> {
  const t0 = Date.now();
  const origin = (
    opts?.origin ||
    process.env.CANONICAL_PUBLIC_ORIGIN ||
    "https://www.dualregistry.dev"
  ).replace(/\/$/, "");
  const notes: string[] = [];
  const errors: string[] = [];
  let state = await loadInterestScout();
  const monthBudget = interestMonthlyBudgetUsd();
  const xai_configured = Boolean(process.env.XAI_API_KEY?.trim());

  if (budgetRemaining(state) <= 0.01) {
    const wall_ms = Date.now() - t0;
    state = {
      ...state,
      last_run_at: new Date().toISOString(),
      last_status: "budget_exhausted",
      last_notes: ["monthly $5 budget exhausted"],
    };
    await saveInterestScout(state);
    return {
      ok: true,
      status: "budget_exhausted",
      candidates_seen: 0,
      keyword_hits: 0,
      scored: 0,
      outreaches_sent: 0,
      skipped_already: 0,
      budget_remaining_usd: 0,
      month_usd: state.month_usd,
      month_budget_usd: monthBudget,
      day_outreaches: state.day_outreaches,
      used_llm: false,
      xai_configured,
      samples: [],
      notes: ["budget_exhausted"],
      errors: [],
      wall_ms,
      cycle_usd: 0,
    };
  }

  const dayRoom = Math.max(0, interestMaxPerDay() - state.day_outreaches);
  const max = Math.min(
    opts?.max ?? 8,
    dayRoom,
    20,
  );
  if (max <= 0) {
    const wall_ms = Date.now() - t0;
    return {
      ok: true,
      status: "day_cap",
      candidates_seen: 0,
      keyword_hits: 0,
      scored: 0,
      outreaches_sent: 0,
      skipped_already: 0,
      budget_remaining_usd: budgetRemaining(state),
      month_usd: state.month_usd,
      month_budget_usd: monthBudget,
      day_outreaches: state.day_outreaches,
      used_llm: false,
      xai_configured,
      samples: [],
      notes: ["day_cap reached"],
      errors: [],
      wall_ms,
      cycle_usd: 0,
    };
  }

  const skipUrls = await loadCleanSkipUrls();
  let mcpPool = await pullOfficialMcp(60);
  if (mcpPool.length < 8) {
    try {
      const { discoverCandidates } = await import("./sources");
      const disc = await discoverCandidates({ mcpPriority: true, max: 40 });
      for (const c of disc.candidates || []) {
        const remote = c.remote_url || c.mcp_url || c.endpoint_url;
        if (!remote || !/^https:\/\//i.test(remote)) continue;
        mcpPool.push({
          key: `mcp:${remote}`.toLowerCase().slice(0, 160),
          kind: "mcp",
          name: (c.name || "mcp").slice(0, 80),
          description: (c.description || "").slice(0, 400),
          remote_url: remote,
          website: c.website || remote,
          repository: c.repository,
          source: c.source || "discover-fallback",
        });
      }
      notes.push(`discover_fallback +${(disc.candidates || []).length}`);
    } catch (e) {
      notes.push(
        `discover_fallback_err:${e instanceof Error ? e.message : "x"}`.slice(
          0,
          60,
        ),
      );
    }
  }
  // dedupe mcpPool
  {
    const seen = new Set<string>();
    mcpPool = mcpPool.filter((c) => {
      if (seen.has(c.key)) return false;
      seen.add(c.key);
      return true;
    });
  }
  const seeds = pullAgentSeeds();
  notes.push(`external_mcp=${mcpPool.length} seeds=${seeds.length}`);

  let pool = [...mcpPool, ...seeds].filter((c) => {
    const u = (c.remote_url || c.website || "").toLowerCase();
    if (u && skipUrls.has(u)) return false;
    if (stillCool(state, c.key)) return false;
    return true;
  });

  const keyword_hits = pool.filter(keywordHit);
  // Prefer keyword hits; fill with random others for discovery
  const rest = pool.filter((c) => !keywordHit(c));
  // shuffle rest lightly
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  pool = [...keyword_hits, ...rest].slice(0, 24);
  notes.push(`keyword_hits=${keyword_hits.length} scoring_pool=${pool.length}`);

  // Score in batches of 10
  let xai_usd = 0;
  let used_llm = false;
  const scored: Array<InterestCandidate & { score: number; why: string }> =
    [];
  for (let i = 0; i < pool.length; i += 8) {
    if (budgetRemaining(state) - xai_usd < 0.02) break;
    const batch = pool.slice(i, i + 8);
    const r = await scoreWithXai(batch);
    xai_usd += r.xai_usd;
    if (r.used_llm) used_llm = true;
    for (const row of r.rows) {
      const c = batch[row.i];
      if (!c) continue;
      scored.push({ ...c, score: row.s, why: row.why });
    }
  }

  const threshold = interestScoreThreshold();
  const eligible = scored
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  notes.push(
    `scored=${scored.length} eligible>=${threshold}=${eligible.length} llm=${used_llm}`,
  );

  if (opts?.dry_run) {
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
          outreaches: 0,
          usd: cycle_usd,
          scored: scored.length,
          notes: notes.slice(0, 4),
        },
        ...(state.history || []),
      ].slice(0, 40),
    };
    await saveInterestScout(state);
    return {
      ok: true,
      status: "dry_run",
      candidates_seen: mcpPool.length + seeds.length,
      keyword_hits: keyword_hits.length,
      scored: scored.length,
      outreaches_sent: 0,
      skipped_already: 0,
      budget_remaining_usd: budgetRemaining(state),
      month_usd: state.month_usd,
      month_budget_usd: monthBudget,
      day_outreaches: state.day_outreaches,
      used_llm,
      xai_configured,
      samples: eligible.slice(0, 8).map((c) => ({
        key: c.key,
        name: c.name,
        score: c.score,
        why: c.why,
        http_ok: false,
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
    const cycle_usd = Number((fluid + xai_usd).toFixed(6));
    state = {
      ...state,
      month_usd: Number((state.month_usd + cycle_usd).toFixed(6)),
      month_xai_usd: Number((state.month_xai_usd + xai_usd).toFixed(6)),
      month_fluid_usd: Number((state.month_fluid_usd + fluid).toFixed(6)),
      last_run_at: new Date().toISOString(),
      last_status: "no_targets",
      last_notes: notes.slice(0, 12),
      history: [
        {
          at: new Date().toISOString(),
          outreaches: 0,
          usd: cycle_usd,
          scored: scored.length,
          notes: notes.slice(0, 4),
        },
        ...(state.history || []),
      ].slice(0, 40),
    };
    await saveInterestScout(state);
    return {
      ok: true,
      status: "no_targets",
      candidates_seen: mcpPool.length + seeds.length,
      keyword_hits: keyword_hits.length,
      scored: scored.length,
      outreaches_sent: 0,
      skipped_already: 0,
      budget_remaining_usd: budgetRemaining(state),
      month_usd: state.month_usd,
      month_budget_usd: monthBudget,
      day_outreaches: state.day_outreaches,
      used_llm,
      xai_configured,
      samples: [],
      notes,
      errors,
      wall_ms,
      cycle_usd,
    };
  }

  let outreaches_sent = 0;
  const samples: InterestScoutResult["samples"] = [];
  const contacted = { ...state.contacted };

  for (const c of eligible) {
    if (budgetRemaining({ ...state, month_usd: state.month_usd + xai_usd }) < 0.01) {
      notes.push("stopped mid-cycle — budget");
      break;
    }
    try {
      const message = valuePitch(c, origin);
      const del = await softHttpDeliver(c, origin, message, c.score);
      if (del.ok) {
        outreaches_sent++;
        contacted[c.key] = {
          at: new Date().toISOString(),
          score: c.score,
          why: c.why,
          http_ok: true,
          http_status: del.status,
          channel: "soft_http",
          name: c.name,
          kind: c.kind,
        };
        samples.push({
          key: c.key,
          name: c.name,
          score: c.score,
          why: c.why,
          http_ok: true,
        });
      } else {
        // Still record attempt so we don't hammer dead hosts
        contacted[c.key] = {
          at: new Date().toISOString(),
          score: c.score,
          why: c.why,
          http_ok: false,
          http_status: del.status,
          channel: "soft_http",
          name: c.name,
          kind: c.kind,
        };
        errors.push(
          `${c.name}: ${del.error || "send_failed"}`.slice(0, 100),
        );
        samples.push({
          key: c.key,
          name: c.name,
          score: c.score,
          why: c.why,
          http_ok: false,
        });
      }
    } catch (e) {
      errors.push(
        `${c.name}: ${e instanceof Error ? e.message : String(e)}`.slice(
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
    contacted,
    day_outreaches: state.day_outreaches + outreaches_sent,
    month_outreaches: state.month_outreaches + outreaches_sent,
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
        outreaches: outreaches_sent,
        usd: cycle_usd,
        scored: scored.length,
        notes: notes.slice(0, 4),
      },
      ...(state.history || []),
    ].slice(0, 40),
  };
  await saveInterestScout(state);

  notes.push(
    `sent ${outreaches_sent}/${eligible.length} · budget left $${budgetRemaining(state).toFixed(2)}`,
  );

  return {
    ok: true,
    status: "ok",
    candidates_seen: mcpPool.length + seeds.length,
    keyword_hits: keyword_hits.length,
    scored: scored.length,
    outreaches_sent,
    skipped_already: 0,
    budget_remaining_usd: budgetRemaining(state),
    month_usd: state.month_usd,
    month_budget_usd: monthBudget,
    day_outreaches: state.day_outreaches,
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
export async function getInterestScoutStatus(): Promise<{
  month_budget_usd: number;
  month_usd: number;
  month_outreaches: number;
  day_outreaches: number;
  day_cap: number;
  contacted_n: number;
  last_run_at?: string;
  last_status?: string;
  last_notes?: string[];
  xai_configured: boolean;
  budget_remaining_usd: number;
}> {
  const s = await loadInterestScout();
  return {
    month_budget_usd: interestMonthlyBudgetUsd(),
    month_usd: s.month_usd,
    month_outreaches: s.month_outreaches,
    day_outreaches: s.day_outreaches,
    day_cap: interestMaxPerDay(),
    contacted_n: Object.keys(s.contacted || {}).length,
    last_run_at: s.last_run_at,
    last_status: s.last_status,
    last_notes: s.last_notes,
    xai_configured: Boolean(process.env.XAI_API_KEY?.trim()),
    budget_remaining_usd: budgetRemaining(s),
  };
}
