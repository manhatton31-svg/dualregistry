import {
  AGENT_FIRST_SHARE,
  MCP_FIRST_SHARE,
  EVEN_RATE_SHARE,
  BALANCE_GAP,
  CATCHUP_GAP,
  canSubmit,
  GROWTH_INTERVAL_MS,
  isReadSafe,
  isWriteSafe,
  loadFreeTier,
  cyclePutCap,
  MAX_PUTS_PER_CYCLE,
  msUntilUtcMidnight,
  publicBudgetView,
} from "../free-tier";
import {
  loadDailyOps,
  recordCycleOps,
  shouldDoMidnightBurst,
} from "../daily-ops";
import { enrichCandidate } from "./enrich";
import {
  candidateKey,
  loadState,
  saveState,
  syncKvFromFreeTier,
} from "./persist";
import { preflightQualityGate, rankCandidate } from "./quality-gate";
import {
  ACTIVE_REPROBE_MS,
  isWeeklyRecheckDue,
  loadProbeState,
  runProbeBudgeted,
} from "../probe";
import { discoverCandidates } from "./sources";
import { fetchStoreIndex, submitCandidate } from "./submit";
import type {
  GrowthCandidate,
  GrowthPublicStatus,
  GrowthRun,
  GrowthState,
  SubmitByUrlResult,
} from "./types";

const MAX_CANDIDATES = 600;
const MAX_RUNS = 40;

function alreadyListed(
  c: GrowthCandidate,
  index: Awaited<ReturnType<typeof fetchStoreIndex>>,
): boolean {
  const name = c.name.toLowerCase().trim();
  const repo = (c.repository || "").toLowerCase().replace(/\.git$/i, "");
  if (c.kind === "agent") {
    if (index.agent_names.some((n) => n === name)) return true;
    if (repo && index.agent_repos.some((r) => r.includes(repo) || repo.includes(r)))
      return true;
    if (
      c.agent_card_url &&
      index.agent_cards.some((u) => u === c.agent_card_url!.toLowerCase())
    )
      return true;
  } else {
    if (index.mcp_names.some((n) => n === name)) return true;
    if (repo && index.mcp_repos.some((r) => r.includes(repo) || repo.includes(r)))
      return true;
  }
  return false;
}

function rememberSubmitted(
  working: GrowthCandidate,
  index: Awaited<ReturnType<typeof fetchStoreIndex>>,
) {
  if (!working.name) return;
  if (working.kind === "agent") {
    index.agent_names.push(working.name.toLowerCase());
    if (working.repository)
      index.agent_repos.push(working.repository.toLowerCase());
    if (working.agent_card_url)
      index.agent_cards.push(working.agent_card_url.toLowerCase());
  } else {
    index.mcp_names.push(working.name.toLowerCase());
    if (working.repository)
      index.mcp_repos.push(working.repository.toLowerCase());
  }
}

async function applyHandshakeProbes(
  state: GrowthState,
  run: { notes: string[] },
  max = 1,
) {
  try {
    type PT = Parameters<typeof runProbeBudgeted>[0][number];
    // Probe candidates only when we have a real card/endpoint at the source we found.
    // Never list them publicly until handshake ok (listing-lanes active filter).
    const probeTargets: PT[] = state.candidates
      .filter((c) =>
        ["queued", "enriched", "deferred", "failed", "approved", "submitted"].includes(
          c.status,
        ),
      )
      .filter((c) =>
        Boolean(
          c.agent_card_url ||
            c.endpoint_url ||
            c.remote_url ||
            (c.website && /well-known|agent\.json|mcp/i.test(c.website)),
        ),
      )
      .map((c) => {
        const dirty =
          c.status === "failed" ||
          c.status === "deferred" ||
          (c.quality_hints || []).some((h) =>
            /handshake:fail|checks:dirty|soft.?fail/i.test(h),
          );
        return c.kind === "agent"
          ? {
              kind: "agent" as const,
              id: c.id,
              name: c.name,
              agent_card_url: c.agent_card_url,
              endpoint_url: c.endpoint_url,
              website: c.website,
              repository: c.repository,
              dirty,
              priority_boost:
                (c.status === "queued" ? 30 : c.status === "enriched" ? 20 : 0) +
                (c.agent_card_url || c.endpoint_url ? 500 : 0),
              store_id: c.store_id,
              purpose: "discovery" as const,
            }
          : {
              kind: "mcp" as const,
              id: c.id,
              name: c.name,
              remote_url: c.remote_url,
              website: c.website,
              repository: c.repository,
              dirty,
              priority_boost:
                c.status === "queued" ? 30 : c.status === "enriched" ? 20 : 0,
              store_id: c.store_id,
              purpose: "discovery" as const,
            };
      });

    try {
      const { loadStoreCache } = await import("../store-cache");
      const cache = await loadStoreCache();
      const seen = new Set(probeTargets.map((t) => t.id));
      // Prefer store listings that have never been probe-ok (grow Active list)
      let probeState: Awaited<ReturnType<typeof loadProbeState>> | null = null;
      try {
        probeState = await loadProbeState();
      } catch {
        /* */
      }
      const results = probeState?.results || {};
      const lookup = (id: string, name: string, kind: "agent" | "mcp") => {
        return (
          results[id] ||
          results[`name:${kind}:${name.toLowerCase().trim()}`]
        );
      };
      /** Still Active-grade and not yet due for weekly recheck — skip discovery */
      const isActiveNotDue = (id: string, name: string, kind: "agent" | "mcp") => {
        const r = lookup(id, name, kind);
        if (!r || !(r.handshake === "ok" && r.ok)) return false;
        return !isWeeklyRecheckDue(r);
      };
      const weeklyTargets: PT[] = [];

      // PRODUCT: never probe-list the entire store dump.
      // Only weekly-recheck listings that already probe-ok (clean registry).
      // New listings enter only via growth candidates discovered with a real URL,
      // probed at that URL first — then listed if handshake ok.
      for (const a of cache.agent_items || []) {
        if (seen.has(a.id)) continue;
        const prev = lookup(a.id, a.name, "agent");
        if (!(prev && prev.handshake === "ok" && prev.ok)) continue;
        seen.add(a.id);
        if (prev && isWeeklyRecheckDue(prev)) {
          weeklyTargets.push({
            kind: "agent",
            id: a.id,
            name: a.name,
            agent_card_url: a.agent_card_url,
            endpoint_url: a.endpoint_url,
            website: a.website,
            repository: a.repository,
            purpose: "weekly_recheck",
            priority_boost: 100,
            store_id: a.id,
          });
        }
      }
      for (const m of cache.mcp_items || []) {
        if (seen.has(m.id)) continue;
        const prev = lookup(m.id, m.name, "mcp");
        if (!(prev && prev.handshake === "ok" && prev.ok)) continue;
        seen.add(m.id);
        if (prev && isWeeklyRecheckDue(prev)) {
          weeklyTargets.push({
            kind: "mcp",
            id: m.id,
            name: m.name,
            remote_url: m.remote_url,
            website: m.website,
            repository: m.repository,
            purpose: "weekly_recheck",
            priority_boost: 100,
            store_id: m.id,
          });
        }
      }

      // Growth candidates that are Active-grade and due for weekly recheck
      for (const c of state.candidates) {
        const prev = results[c.id] || results[`name:${c.kind}:${(c.name||"").toLowerCase().trim()}`];
        if (!prev || !isWeeklyRecheckDue(prev)) continue;
        if (seen.has(c.id) || (c.store_id && seen.has(c.store_id))) continue;
        weeklyTargets.push(
          c.kind === "agent"
            ? {
                kind: "agent",
                id: c.store_id || c.id,
                name: c.name,
                agent_card_url: c.agent_card_url,
                endpoint_url: c.endpoint_url,
                website: c.website,
                repository: c.repository,
                purpose: "weekly_recheck",
                priority_boost: 80,
                store_id: c.store_id,
              }
            : {
                kind: "mcp",
                id: c.store_id || c.id,
                name: c.name,
                remote_url: c.remote_url,
                website: c.website,
                repository: c.repository,
                purpose: "weekly_recheck",
                priority_boost: 80,
                store_id: c.store_id,
              },
        );
      }

      // Discovery first in list order, then weekly (priority still ranks never-probed higher)
      const discoveryCount = probeTargets.length;
      probeTargets.push(...weeklyTargets);
      run.notes.push(
        `probe-queue: ${discoveryCount} discovery · ${weeklyTargets.length} weekly-due (unlimited)`,
      );
    } catch {
      /* cache optional */
    }

    // Balanced queue: never slice agents away (candidates are MCP-heavy at front).
    // Prefer never-probed + lagging kind; cap size but keep both lanes.
    const agentsQ = probeTargets.filter((t) => t.kind === "agent");
    const mcpsQ = probeTargets.filter((t) => t.kind !== "agent");
    const weeklyQ = probeTargets.filter((t) => t.purpose === "weekly_recheck");
    const discAgents = agentsQ.filter((t) => t.purpose !== "weekly_recheck");
    const discMcps = mcpsQ.filter((t) => t.purpose !== "weekly_recheck");
    const balancedQueue: typeof probeTargets = [];
    const maxEach = 80;
    const aSlice = discAgents.slice(0, maxEach);
    const mSlice = discMcps.slice(0, maxEach);
    // Interleave agent/mcp so lagging kind is always present in the budgeted ranker
    const n = Math.max(aSlice.length, mSlice.length);
    for (let i = 0; i < n; i++) {
      if (i < aSlice.length) balancedQueue.push(aSlice[i]!);
      if (i < mSlice.length) balancedQueue.push(mSlice[i]!);
    }
    for (const w of weeklyQ.slice(0, 40)) {
      if (!balancedQueue.some((x) => x.id === w.id)) balancedQueue.push(w);
    }
    run.notes.push(
      `probe-balance-queue: ${aSlice.length} agents · ${mSlice.length} mcps · ${Math.min(40, weeklyQ.length)} weekly (interleaved)`,
    );
    const probes = await runProbeBudgeted(balancedQueue, max);
    const byId = Object.fromEntries(probes.map((r) => [r.id, r]));
    for (const c of state.candidates) {
      const pr = byId[c.id];
      if (!pr) continue;
      c.safety_score = pr.score;
      const hints = new Set(c.quality_hints || []);
      for (const s of pr.protocol_hints) hints.add(`proto:${s}`);
      if (pr.namespace_verified) hints.add("ns:verified");
      if (pr.handshake === "ok") hints.add("handshake:ok");
      if (pr.handshake === "fail") hints.add("handshake:fail");
      if (pr.handshake === "partial") hints.add("handshake:partial");
      c.quality_hints = [...hints];
    }
    const weeklyN = probes.filter((p) =>
      (p.signals || []).includes("weekly-recheck"),
    ).length;
    run.notes.push(
      `probes: ${probes.length} (ok ${probes.filter((p) => p.ok).length}` +
        (weeklyN ? ` · weekly-recheck ${weeklyN}` : " · discovery") +
        `) · 1/6min`,
    );

    try {
      const okProbes = probes.filter(
        (p) =>
          p.handshake === "ok" &&
          p.ok &&
          !(p.signals || []).includes("weekly-recheck"),
      );
      if (okProbes.length) {
        const { offerDemosForProbeOk } = await import(
          "@/lib/products/offer-demo-on-probe"
        );
        const listings = probeTargets.map((t) => ({
          id: t.id,
          kind: (t.kind || "mcp") as "agent" | "mcp",
          name: t.name,
          description: undefined as string | undefined,
          agent_card_url: t.agent_card_url,
          remote_url: t.remote_url,
          website: t.website,
          endpoint_url: t.endpoint_url,
        }));
        const off = await offerDemosForProbeOk(okProbes, listings);
        if (off.skills?.length) {
          run.notes.push(
            `take_demo skills: ${off.skills.length} (listing_id + POST body)`,
          );
        }
        for (const n of off.notes) run.notes.push(n);
      }
    } catch (e) {
      run.notes.push(
        `demo-offer: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } catch (e) {
    run.notes.push(`probes: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 6-minute probe-only tick — always spends budget window when available */
export async function runProbeTick(opts?: { max?: number }): Promise<{
  ok: boolean;
  probed: number;
  notes: string[];
  window_remaining?: number;
  used?: number;
  last_result?: {
    id?: string;
    kind?: string;
    handshake?: string;
    ok?: boolean;
    target?: string;
    probed_at?: string;
  } | null;
}> {
  const state = await loadState();
  const notes: string[] = [];
  const before = await loadProbeState();
  const usedBefore = before.used || 0;
  await applyHandshakeProbes(state, { notes }, opts?.max ?? 1);
  await saveState(state);
  // Always stamp last_tick so dashboards/worker know the cadence fired
  try {
    const { stampProbeTick } = await import("@/lib/agents1/probe");
    if (typeof stampProbeTick === "function") await stampProbeTick();
  } catch {
    /* */
  }
  const after = await loadProbeState();
  const probed = Math.max(0, (after.used || 0) - usedBefore);
  // Newest primary result (skip aliases)
  let last_result: {
    id?: string;
    kind?: string;
    handshake?: string;
    ok?: boolean;
    target?: string;
    probed_at?: string;
  } | null = null;
  try {
    const primaries = Object.entries(after.results || {})
      .filter(([k]) => !k.startsWith("name:") && !k.startsWith("url:"))
      .map(([, r]) => r)
      .filter((r) => r?.probed_at)
      .sort((a, b) => (a.probed_at < b.probed_at ? 1 : -1));
    const top = primaries[0];
    if (top) {
      last_result = {
        id: top.id,
        kind: top.kind,
        handshake: top.handshake,
        ok: top.ok,
        target: top.target,
        probed_at: top.probed_at,
      };
    }
  } catch {
    /* */
  }
  return {
    ok: true,
    probed,
    notes,
    used: after.used,
    window_remaining: Math.max(0, (after.hourly_cap || 1) - (after.hourly_used || 0)),
    last_result,
  };
}

async function runProductFeedbackDrive(notes: string[]) {
  try {
    const { runFeedbackDrive } = await import("@/lib/products/feedback-drive");
    const r = await runFeedbackDrive();
    if (r.notes?.length) notes.push(`feedback-drive: ${r.notes.join("; ")}`);
    else if (r.feedbacks || r.demos_seeded || r.nags) {
      notes.push(
        `feedback-drive: +${r.feedbacks} fb · +${r.demos_seeded} demos · ${r.nags} nags`,
      );
    }
  } catch (e) {
    notes.push(
      `feedback-drive: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function toPublicStatus(
  state: GrowthState,
  notes: string[],
  store?: { mcp: number; agents: number },
): GrowthPublicStatus {
  const queue_depth = state.candidates.filter((c) =>
    ["queued", "enriched", "deferred", "failed"].includes(c.status),
  ).length;
  return {
    enabled: state.scheduler.enabled,
    running: state.scheduler.running,
    last_run_at: state.scheduler.last_run_at,
    next_run_at: state.scheduler.next_run_at,
    interval_ms: state.scheduler.interval_ms || GROWTH_INTERVAL_MS,
    totals: state.totals,
    queue_depth,
    recent_runs: state.runs.slice(0, 8),
    recent_activity: state.candidates
      .slice()
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, 20),
    store_milestones: store
      ? {
          mcp: store.mcp,
          agents: store.agents,
          mcp_target: 0,
          agents_target: 0,
        }
      : undefined,
    notes,
    kv_limited: state.kv.hard_stop,
    kv_budget: {
      day: state.kv.day,
      budget: state.kv.budget,
      used: state.kv.used,
      remaining: Math.max(0, state.kv.budget - state.kv.used),
      hard_stop: state.kv.hard_stop,
      cf_hard_limit: state.kv.budget,
      policy: "Agents1 soft put budget",
    },
  };
}

export async function runGrowthCycle(opts?: {
  force?: boolean;
  maxSubmit?: number;
}): Promise<GrowthPublicStatus> {
  const state = await loadState();
  if (state.scheduler.running && !opts?.force) {
    return toPublicStatus(state, ["cycle already running"]);
  }
  state.scheduler.running = true;
  await saveState(state);

  const run: GrowthRun = {
    id: `run_${Date.now().toString(36)}`,
    started_at: new Date().toISOString(),
    discovered: 0,
    submitted: 0,
    approved: 0,
    duplicates: 0,
    deferred: 0,
    failed: 0,
    notes: [],
  };

  try {
    const ft = await loadFreeTier();
    const view = publicBudgetView(ft);
    run.notes.push(
      `Free-tier UTC ${view.day}: put ${view.put.used}/${view.put.budget} · get ${view.get.used}/${view.get.budget} (Agents1 share)`,
    );
    run.notes.push(
      "Policy: protect reads · even-rate MCP↔agent · protocol probes every 6m",
    );

    state.kv = await syncKvFromFreeTier(state.kv);

    let index = await fetchStoreIndex();
    run.notes.push(
      `store: ${index.mcp_total} mcp / ${index.agent_total} agents (live)`,
    );

    // Discover
    if (isReadSafe(ft)) {
      try {
        const disc = await discoverCandidates({
          agentPriority: index.agent_total + BALANCE_GAP < index.mcp_total,
          mcpPriority: index.mcp_total + BALANCE_GAP < index.agent_total,
        });
        for (const c of disc.candidates || []) {
          const k = candidateKey(c);
          if (state.seen_keys.includes(k)) continue;
          state.seen_keys.push(k);
          state.candidates.unshift(c);
          run.discovered++;
        }
        state.totals.discovered += run.discovered;
        for (const n of disc.notes || []) run.notes.push(n);
      } catch (e) {
        run.notes.push(
          `discover: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Probes every growth cycle too
    await applyHandshakeProbes(state, run, 1);

    // Submit puts
    const dailyOpsSnap = await loadDailyOps();
    const midnightBurst = shouldDoMidnightBurst(dailyOpsSnap);
    let putCap = opts?.maxSubmit ?? cyclePutCap(ft, midnightBurst);
    if (midnightBurst) putCap = Math.max(putCap, MAX_PUTS_PER_CYCLE);
    putCap = Math.min(putCap, MAX_PUTS_PER_CYCLE);

    const agentGap = index.mcp_total - index.agent_total;
    const preferAgent = agentGap >= BALANCE_GAP;
    const pureAgentCatchup = agentGap >= CATCHUP_GAP;
    if (preferAgent) {
      run.notes.push(
        `agent-first ON (${index.agent_total} agents << ${index.mcp_total} mcp, gap=${-agentGap}) — ${Math.round(AGENT_FIRST_SHARE * 100)}% writes for agents`,
      );
    }

    const ranked = state.candidates
      .filter((c) => ["queued", "enriched", "deferred", "failed"].includes(c.status))
      .map((c) => ({
        c,
        rank: rankCandidate(c, {
          mcp: index.mcp_total,
          agents: index.agent_total,
        }),
      }))
      .sort((a, b) => b.rank - a.rank)
      .map((x) => x.c);

    let putCount = 0;
    let agentPuts = 0;
    let mcpPuts = 0;
    let skippedQuality = 0;
    let skippedNonPreferred = 0;

    for (const c of ranked) {
      if (putCount >= putCap) break;
      const subOk = await canSubmit();
      if (!isWriteSafe(ft) || !subOk.allow) break;

      const idx = state.candidates.findIndex((x) => x.id === c.id);
      if (idx < 0) continue;
      let working = { ...state.candidates[idx]! };

      if (alreadyListed(working, index)) {
        working.status = "duplicate";
        working.updated_at = new Date().toISOString();
        state.candidates[idx] = working;
        run.duplicates++;
        state.totals.duplicates++;
        continue;
      }

      // Balance gate
      const wantAgentShare = pureAgentCatchup
        ? 1
        : preferAgent
          ? AGENT_FIRST_SHARE
          : agentGap <= -BALANCE_GAP
            ? 1 - MCP_FIRST_SHARE
            : EVEN_RATE_SHARE;
      const agentShare =
        putCount === 0 ? 0 : agentPuts / Math.max(1, putCount);
      if (working.kind === "mcp" && agentShare < wantAgentShare - 0.05) {
        // need more agents first
        const hasAgent = ranked.some(
          (r) =>
            r.kind === "agent" &&
            ["queued", "enriched", "deferred", "failed"].includes(r.status),
        );
        if (hasAgent) {
          skippedNonPreferred++;
          continue;
        }
      }

      try {
        working = await enrichCandidate(working);
      } catch {
        /* keep */
      }

      const gate = preflightQualityGate(working);
      if (!gate.pass) {
        working.status = "deferred";
        working.last_error = gate.reasons?.join("; ") || "quality";
        working.updated_at = new Date().toISOString();
        state.candidates[idx] = working;
        skippedQuality++;
        run.deferred++;
        continue;
      }

      const sub = await submitCandidate(working);
      working.attempts += 1;
      working.updated_at = new Date().toISOString();
      if (sub.counts_as_put) {
        putCount++;
        if (working.kind === "agent") agentPuts++;
        else mcpPuts++;
      }
      if (sub.duplicate) {
        working.status = "duplicate";
        run.duplicates++;
        state.totals.duplicates++;
      } else if (sub.approved || sub.ok) {
        working.status = sub.approved ? "approved" : "submitted";
        working.store_id = sub.item?.id;
        working.store_slug = sub.item?.slug;
        working.safety_score = sub.safety_score ?? working.safety_score;
        run.submitted++;
        state.totals.submitted++;
        if (sub.approved) {
          run.approved++;
          state.totals.approved++;
        }
        rememberSubmitted(working, index);
      } else if (sub.kv_limited) {
        working.status = "deferred";
        working.last_error = sub.message || "kv limited";
        run.deferred++;
        state.totals.deferred++;
        run.notes.push(`kv limit: ${sub.message || sub.kv_kind}`);
        state.candidates[idx] = working;
        break;
      } else {
        working.status = "failed";
        working.last_error = sub.message || sub.error || "submit failed";
        run.failed++;
        state.totals.failed++;
      }
      state.candidates[idx] = working;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (skippedQuality)
      run.notes.push(`quality gate skipped ${skippedQuality}`);
    if (skippedNonPreferred)
      run.notes.push(
        `skipped ${skippedNonPreferred} non-preferred (balance / catch-up)`,
      );
    run.notes.push(
      `writes this cycle: ${agentPuts} agent + ${mcpPuts} mcp = ${putCount}`,
    );

    // Trim candidates
    if (state.candidates.length > MAX_CANDIDATES) {
      state.candidates = state.candidates
        .slice()
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
        .slice(0, MAX_CANDIDATES);
    }

    const ftEnd = publicBudgetView(await loadFreeTier());
    run.budget_remaining = ftEnd.put.remaining;
    run.finished_at = new Date().toISOString();
    state.runs.unshift(run);
    state.runs = state.runs.slice(0, MAX_RUNS);
    state.scheduler.running = false;
    state.scheduler.last_run_at = run.finished_at;
    state.scheduler.interval_ms = GROWTH_INTERVAL_MS;
    state.scheduler.next_run_at = new Date(
      Date.now() +
        (ftEnd.fully_throttled ? msUntilUtcMidnight() : GROWTH_INTERVAL_MS),
    ).toISOString();

    const queueDepth = state.candidates.filter((c) =>
      ["queued", "enriched", "deferred", "failed"].includes(c.status),
    ).length;
    await recordCycleOps({
      put_used: ftEnd.put.used,
      put_budget: ftEnd.put.budget,
      get_used: ftEnd.get.used,
      get_budget: ftEnd.get.budget,
      mcp_approved: index.mcp_total,
      agents_approved: index.agent_total,
      queue_depth: queueDepth,
      discovered: run.discovered,
      submitted: run.submitted,
      approved: run.approved,
      duplicates: run.duplicates,
      note: `cycle puts ${putCount} (${agentPuts} agent / ${mcpPuts} mcp)`,
      midnight_burst_done: midnightBurst && putCount > 0,
    });

    state.kv = await syncKvFromFreeTier(state.kv);
    await runProductFeedbackDrive(run.notes);
    await saveState(state);

    const status = toPublicStatus(state, run.notes, {
      mcp: index.mcp_total,
      agents: index.agent_total,
    });
    status.free_tier = ftEnd as GrowthPublicStatus["free_tier"];
    try {
      status.daily_ops = (await loadDailyOps()) as unknown as GrowthPublicStatus["daily_ops"];
    } catch {
      /* */
    }
    return status;
  } catch (e) {
    run.notes.push(e instanceof Error ? e.message : String(e));
    run.finished_at = new Date().toISOString();
    run.failed++;
    state.runs.unshift(run);
    state.runs = state.runs.slice(0, MAX_RUNS);
    state.scheduler.running = false;
    state.scheduler.last_run_at = run.finished_at;
    state.scheduler.next_run_at = new Date(
      Date.now() + GROWTH_INTERVAL_MS,
    ).toISOString();
    await saveState(state);
    return toPublicStatus(state, run.notes);
  }
}

export async function getGrowthStatus(): Promise<GrowthPublicStatus> {
  const state = await loadState();
  const notes: string[] = [];
  let store: { mcp: number; agents: number } | undefined;
  try {
    const index = await fetchStoreIndex();
    store = { mcp: index.mcp_total, agents: index.agent_total };
  } catch {
    /* */
  }
  const status = toPublicStatus(state, notes, store);
  try {
    status.free_tier = publicBudgetView(
      await loadFreeTier(),
    ) as GrowthPublicStatus["free_tier"];
  } catch {
    /* */
  }
  try {
    status.daily_ops = (await loadDailyOps()) as unknown as GrowthPublicStatus["daily_ops"];
  } catch {
    /* */
  }
  return status;
}

export async function submitByUrl(url: string): Promise<SubmitByUrlResult> {
  const state = await loadState();
  const ts = new Date().toISOString();
  const isAgent =
    /agent\.json|a2a|agent-card/i.test(url) || /\/agents?\//i.test(url);
  const name =
    url
      .replace(/^https?:\/\//i, "")
      .split(/[/?#]/)[0]
      ?.slice(0, 60) || "imported";
  const c: GrowthCandidate = {
    id: `url:${name}:${Date.now().toString(36)}`,
    kind: isAgent ? "agent" : "mcp",
    name,
    description: `Imported from ${url}`,
    website: url.startsWith("http") ? new URL(url).origin : undefined,
    agent_card_url: isAgent ? url : undefined,
    remote_url: !isAgent ? url : undefined,
    source: "submit_url",
    status: "queued",
    attempts: 0,
    discovered_at: ts,
    updated_at: ts,
  };
  state.candidates.unshift(c);
  await saveState(state);
  try {
    const enriched = await enrichCandidate(c);
    const sub = await submitCandidate(enriched);
    return {
      ok: Boolean(sub.ok || sub.approved || sub.duplicate),
      kind: c.kind,
      candidate: enriched,
      message: sub.message || sub.error || (sub.ok ? "submitted" : "done"),
      store_response_json: JSON.stringify(sub.raw || {}).slice(0, 2000),
    };
  } catch (e) {
    return {
      ok: false,
      kind: c.kind,
      candidate: c,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
