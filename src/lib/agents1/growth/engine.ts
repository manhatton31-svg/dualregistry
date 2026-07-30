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
import { hasProbeableSource } from "../listing-lanes";

/** Small queue — probe-first, no junk hoard */
const MAX_CANDIDATES = 500;
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

/**
 * PRODUCT LAW: drop garbage from the queue.
 * No card/URL at source found → never probe, never list.
 * rejected / duplicate → discard.
 */
function purgeUnprobeable(state: GrowthState, notes: string[]): number {
  const before = state.candidates.length;
  const keep: GrowthCandidate[] = [];
  for (const c of state.candidates || []) {
    if (c.status === "rejected" || c.status === "duplicate") continue;
    if (!hasProbeableSource(c)) continue;
    keep.push(c);
  }
  keep.sort((a, b) => {
    const ap = a.status === "queued" || a.status === "enriched" ? 0 : 1;
    const bp = b.status === "queued" || b.status === "enriched" ? 0 : 1;
    return ap - bp || (a.updated_at < b.updated_at ? 1 : -1);
  });
  state.candidates = keep.slice(0, MAX_CANDIDATES);
  const dropped = before - state.candidates.length;
  if (dropped > 0) {
    notes.push(
      `purge: dropped ${dropped} unprobeable/rejected (kept ${state.candidates.length} with real card/URL)`,
    );
  }
  return dropped;
}

function normUrl(u?: string | null): string {
  return (u || "").toLowerCase().trim().replace(/\/$/, "");
}

function candidateUrls(c: {
  remote_url?: string;
  agent_card_url?: string;
  endpoint_url?: string;
  website?: string;
  mcp_url?: string;
  target?: string;
}): string[] {
  return [
    c.remote_url,
    c.agent_card_url,
    c.endpoint_url,
    c.mcp_url,
    (c as { target?: string }).target,
    c.website,
  ]
    .map(normUrl)
    .filter(Boolean);
}

/**
 * Drop already-Active clean listings from the discovery queue.
 * They clog slots and get re-probed as "ok 38" with zero growth.
 */
async function purgeAlreadyClean(
  state: GrowthState,
  notes: string[],
): Promise<{ cleanIds: Set<string>; cleanUrls: Set<string> }> {
  const cleanIds = new Set<string>();
  const cleanUrls = new Set<string>();
  try {
    const { loadCleanRegistry } = await import("../clean-registry");
    const reg = await loadCleanRegistry();
    for (const [id, it] of Object.entries(reg?.items || {})) {
      cleanIds.add(id);
      if (it?.id) cleanIds.add(it.id);
      for (const u of candidateUrls(it as { target?: string })) cleanUrls.add(u);
    }
  } catch {
    /* */
  }
  const before = state.candidates.length;
  const keep: GrowthCandidate[] = [];
  let marked = 0;
  for (const c of state.candidates || []) {
    const urls = candidateUrls(c);
    const isClean =
      cleanIds.has(c.id) ||
      (c.store_id ? cleanIds.has(c.store_id) : false) ||
      urls.some((u) => cleanUrls.has(u));
    if (isClean) {
      // Mark approved so we never rediscover as "queued"
      c.status = "approved";
      marked++;
      continue;
    }
    // handshake:ok but not in clean yet → keep (raise may have failed once)
    keep.push(c);
  }
  state.candidates = keep.slice(0, MAX_CANDIDATES);
  if (marked > 0 || before !== keep.length) {
    notes.push(
      `purge-clean: removed ${before - keep.length} already-Active (clean floor ${cleanIds.size}) · queue now ${keep.length}`,
    );
  }
  return { cleanIds, cleanUrls };
}

/**
 * Refill discovery queue from harvest + official registry.
 * Production probes ONLY call runProbeTick — without this, Active freezes at ~75.
 */
async function refillDiscoveryQueue(
  state: GrowthState,
  notes: string[],
  opts?: { force?: boolean },
): Promise<number> {
  const { cleanIds, cleanUrls } = await purgeAlreadyClean(state, notes);
  const neverClean = state.candidates.filter(
    (c) =>
      ["queued", "enriched", "deferred", "failed", "submitted"].includes(
        c.status,
      ) && hasProbeableSource(c),
  ).length;
  // Always refill when thin or forced (behind 333/day)
  if (!opts?.force && neverClean >= 64) {
    notes.push(`discover-refill: skip (queue already ${neverClean} not-yet-clean)`);
    return 0;
  }

  const skipUrls = new Set<string>(cleanUrls);
  for (const c of state.candidates) {
    for (const u of candidateUrls(c)) skipUrls.add(u);
  }

  let added = 0;
  try {
    const disc = await discoverCandidates({
      agentPriority: false,
      mcpPriority: false,
      skipUrls,
      max: 400,
    });
    const queuedKeys = new Set(state.candidates.map((c) => candidateKey(c)));
    const queuedIds = new Set(
      state.candidates.flatMap((c) =>
        [c.id, c.store_id].filter(Boolean) as string[],
      ),
    );
    for (const c of disc.candidates || []) {
      if (!hasProbeableSource(c)) continue;
      if (cleanIds.has(c.id) || (c.store_id && cleanIds.has(c.store_id))) continue;
      if (candidateUrls(c).some((u) => cleanUrls.has(u))) continue;
      const k = candidateKey(c);
      if (queuedKeys.has(k) || queuedIds.has(c.id)) continue;
      // Allow re-queue even if in seen_keys when not clean — seen_keys was permanent
      // death for failed first probes and froze Active. Only block exact queue dupes.
      queuedKeys.add(k);
      queuedIds.add(c.id);
      state.candidates.unshift(c);
      if (!state.seen_keys.includes(k)) state.seen_keys.push(k);
      added++;
    }
    for (const n of disc.notes || []) notes.push(n);
    notes.push(
      `discover-refill: +${added} never-clean probeable (queue ${state.candidates.length})`,
    );
  } catch (e) {
    notes.push(
      `discover-refill: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Also inject probeable store-cache rows not yet clean (different ID scheme)
  try {
    const { loadStoreCache } = await import("../store-cache");
    const cache = await loadStoreCache();
    const queuedIds = new Set(
      state.candidates.flatMap((c) =>
        [c.id, c.store_id].filter(Boolean) as string[],
      ),
    );
    let storeAdded = 0;
    const ts = new Date().toISOString();
    for (const m of cache.mcp_items || []) {
      if (!m?.id || cleanIds.has(m.id) || queuedIds.has(m.id)) continue;
      if (!m.remote_url && !m.website) continue;
      if (!hasProbeableSource(m)) continue;
      if (candidateUrls(m).some((u) => cleanUrls.has(u))) continue;
      state.candidates.unshift({
        id: m.id,
        kind: "mcp",
        name: m.name || m.id,
        description: m.description || `${m.name || m.id} MCP from store cache`,
        repository: m.repository,
        website: m.website,
        remote_url: m.remote_url,
        author: m.author,
        source: "store-cache-refill",
        status: "queued",
        attempts: 0,
        discovered_at: ts,
        updated_at: ts,
        store_id: m.id,
        quality_hints: ["probeable", "store-cache"],
      });
      queuedIds.add(m.id);
      storeAdded++;
      if (storeAdded >= 80) break;
    }
    let agentAdded = 0;
    for (const a of cache.agent_items || []) {
      if (!a?.id || cleanIds.has(a.id) || queuedIds.has(a.id)) continue;
      if (!hasProbeableSource(a)) continue;
      if (candidateUrls(a).some((u) => cleanUrls.has(u))) continue;
      state.candidates.unshift({
        id: a.id,
        kind: "agent",
        name: a.name || a.id,
        description: a.description || `${a.name || a.id} agent from store cache`,
        repository: a.repository,
        website: a.website,
        agent_card_url: a.agent_card_url,
        endpoint_url: a.endpoint_url,
        author: a.author,
        source: "store-cache-refill",
        status: "queued",
        attempts: 0,
        discovered_at: ts,
        updated_at: ts,
        store_id: a.id,
        quality_hints: ["probeable", "store-cache"],
      });
      queuedIds.add(a.id);
      agentAdded++;
      if (agentAdded >= 80) break;
    }
    if (storeAdded + agentAdded > 0) {
      notes.push(
        `store-refill: +${storeAdded} mcp · +${agentAdded} agents never-clean`,
      );
      added += storeAdded + agentAdded;
    }
  } catch (e) {
    notes.push(`store-refill: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Cap queue — prefer never-probed / never-clean
  state.candidates = state.candidates.slice(0, MAX_CANDIDATES);
  return added;
}

async function applyHandshakeProbes(
  state: GrowthState,
  run: { notes: string[] },
  max = 48,
) {
  try {
    type PT = Parameters<typeof runProbeBudgeted>[0][number];
    // IDs already on clean registry — never spend discovery budget re-proving them
    let cleanIds = new Set<string>();
    try {
      const { loadCleanRegistry } = await import("../clean-registry");
      const reg = await loadCleanRegistry();
      cleanIds = new Set(Object.keys(reg?.items || {}));
    } catch {
      /* */
    }

    // Also skip by target URL so ID-scheme mismatches cannot re-burn clean
    const cleanUrls = new Set<string>();
    try {
      const { loadCleanRegistry } = await import("../clean-registry");
      const reg2 = await loadCleanRegistry();
      for (const it of Object.values(reg2?.items || {})) {
        const t = (it?.target || "").toLowerCase().replace(/\/$/, "");
        if (t) cleanUrls.add(t);
      }
    } catch {
      /* */
    }
    const isAlreadyClean = (c: GrowthCandidate) => {
      if (cleanIds.has(c.id) || (c.store_id && cleanIds.has(c.store_id)))
        return true;
      for (const u of [
        c.remote_url,
        c.agent_card_url,
        c.endpoint_url,
        c.mcp_url,
      ]) {
        const n = (u || "").toLowerCase().replace(/\/$/, "");
        if (n && cleanUrls.has(n)) return true;
      }
      return false;
    };

    // Probe candidates only when we have a real card/endpoint at the source we found.
    // Never include already-Active — discovery budget is for NEW clean only.
    const probeTargets: PT[] = state.candidates
      .filter((c) =>
        ["queued", "enriched", "deferred", "failed", "submitted"].includes(
          c.status,
        ),
      )
      .filter((c) => hasProbeableSource(c))
      .filter((c) => !isAlreadyClean(c))
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
                (c.agent_card_url || c.endpoint_url ? 500 : 0) +
                2000, // discovery never-clean first
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
                (c.status === "queued" ? 30 : c.status === "enriched" ? 20 : 0) +
                2000,
              store_id: c.store_id,
              purpose: "discovery" as const,
            };
      });

    run.notes.push(
      `discovery targets (not yet clean): ${probeTargets.length} · clean floor ${cleanIds.size}`,
    );

    try {
      const { loadStoreCache } = await import("../store-cache");
      const cache = await loadStoreCache();
      const seen = new Set(probeTargets.map((t) => t.id));
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
      const weeklyTargets: PT[] = [];

      // PRODUCT: never probe-list the entire store dump.
      // Only weekly-recheck listings that already probe-ok (clean registry).
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

      for (const c of state.candidates) {
        const prev =
          results[c.id] ||
          results[`name:${c.kind}:${(c.name || "").toLowerCase().trim()}`];
        if (!prev || !isWeeklyRecheckDue(prev)) continue;
        if (seen.has(c.id) || (c.store_id && seen.has(c.store_id))) continue;
        if (!hasProbeableSource(c)) continue;
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

      const discoveryCount = probeTargets.length;
      probeTargets.push(...weeklyTargets);
      run.notes.push(
        `probe-queue: ${discoveryCount} discovery · ${weeklyTargets.length} weekly-due (probeable only)`,
      );
    } catch {
      /* cache optional */
    }

    const agentsQ = probeTargets.filter((t) => t.kind === "agent");
    const mcpsQ = probeTargets.filter((t) => t.kind !== "agent");
    const weeklyQ = probeTargets.filter((t) => t.purpose === "weekly_recheck");
    const discAgents = agentsQ.filter((t) => t.purpose !== "weekly_recheck");
    const discMcps = mcpsQ.filter((t) => t.purpose !== "weekly_recheck");
    const balancedQueue: typeof probeTargets = [];
    const maxEach = 120;
    const aSlice = discAgents.slice(0, maxEach);
    const mSlice = discMcps.slice(0, maxEach);
    const n = Math.max(aSlice.length, mSlice.length);
    for (let i = 0; i < n; i++) {
      if (i < aSlice.length) balancedQueue.push(aSlice[i]!);
      if (i < mSlice.length) balancedQueue.push(mSlice[i]!);
    }
    for (const w of weeklyQ.slice(0, 40)) {
      if (!balancedQueue.some((x) => x.id === w.id)) balancedQueue.push(w);
    }
    run.notes.push(
      `probe-balance-queue: ${aSlice.length} agents · ${mSlice.length} mcps · ${Math.min(40, weeklyQ.length)} weekly`,
    );
    const probes = await runProbeBudgeted(balancedQueue, max, {
      force: true,
    });
    // If first batch found nothing usable, try a second force batch on remaining queue
    let allProbes = probes;
    if (probes.length < Math.min(8, max) && balancedQueue.length > probes.length) {
      const seen = new Set(probes.map((p) => p.id));
      const rest = balancedQueue.filter((t) => !seen.has(t.id));
      if (rest.length) {
        const more = await runProbeBudgeted(rest, max - probes.length, {
          force: true,
        });
        allProbes = [...probes, ...more];
      }
    }
    const byId = Object.fromEntries(allProbes.map((r) => [r.id, r]));
    for (const c of state.candidates) {
      const pr = byId[c.id];
      if (!pr) continue;
      c.safety_score = pr.score;
      const hints = new Set(c.quality_hints || []);
      for (const s of pr.protocol_hints) hints.add(`proto:${s}`);
      if (pr.namespace_verified) hints.add("ns:verified");
      if (pr.handshake === "ok") {
        hints.add("handshake:ok");
        // Already raised into clean-registry — leave discovery queue
        c.status = "approved";
      }
      // Do NOT permanent-reject on first fail — that emptied the queue and froze Active at ~75.
      if (pr.handshake === "fail") {
        hints.add("handshake:fail");
        c.attempts = (c.attempts || 0) + 1;
        if (c.attempts >= 4) {
          c.status = "rejected";
          c.last_error = "probe fail ×4 — rejected";
        } else {
          c.status = "deferred";
          c.last_error = `probe fail (attempt ${c.attempts}) — will retry`;
        }
      }
      if (pr.handshake === "partial") {
        hints.add("handshake:partial");
        c.status = "deferred";
        c.last_error = "handshake partial — retry later";
      }
      if (pr.handshake === "skip") {
        hints.add("handshake:skip");
        c.status = "deferred";
        c.last_error = "probe skip — weak target";
      }
      c.quality_hints = [...hints];
    }
    const weeklyN = allProbes.filter((p) =>
      (p.signals || []).includes("weekly-recheck"),
    ).length;
    const okN = allProbes.filter((p) => p.ok && p.handshake === "ok").length;
    run.notes.push(
      `probes: ${allProbes.length} (ok ${okN}` +
        (weeklyN ? ` · weekly-recheck ${weeklyN}` : " · discovery") +
        `) · up to ${max}/tick → clean list`,
    );

    try {
      const okProbes = allProbes.filter(
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

/** Probe tick — refill never-clean discovery then high-volume probes toward 333/day */
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
  const { PROBES_PER_TICK, CLEAN_GROWTH_TARGET_PER_DAY } = await import(
    "@/lib/agents1/probe"
  );
  const state = await loadState();
  const notes: string[] = [];
  purgeUnprobeable(state, notes);
  await purgeAlreadyClean(state, notes);

  // Production only hits this path (Actions → /api/cron/probe). Must discover here.
  let behind = true;
  try {
    const { loadCleanRegistry } = await import("../clean-registry");
    const reg = await loadCleanRegistry();
    const total = reg?.counts?.total || Object.keys(reg?.items || {}).length;
    behind = total < CLEAN_GROWTH_TARGET_PER_DAY;
    notes.push(
      `clean floor ${total} · target ${CLEAN_GROWTH_TARGET_PER_DAY}/day · behind=${behind}`,
    );
  } catch {
    notes.push("clean floor unknown — treating as behind target");
  }
  await refillDiscoveryQueue(state, notes, { force: behind });
  await saveState(state); // persist new queue before long probe so crash keeps progress

  const before = await loadProbeState();
  const usedBefore = before.used || 0;
  await applyHandshakeProbes(state, { notes }, opts?.max ?? PROBES_PER_TICK);

  await purgeAlreadyClean(state, notes);
  purgeUnprobeable(state, notes);
  await saveState(state);
  try {
    const { stampProbeTick } = await import("@/lib/agents1/probe");
    if (typeof stampProbeTick === "function") await stampProbeTick();
  } catch {
    /* */
  }
  const after = await loadProbeState();
  const probed = Math.max(0, (after.used || 0) - usedBefore);
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
    window_remaining: Math.max(
      0,
      (after.hourly_cap || 1) - (after.hourly_used || 0),
    ),
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
      "Policy: probe-first clean registry · only probeable source URLs · never list store dump",
    );

    purgeUnprobeable(state, run.notes);

    state.kv = await syncKvFromFreeTier(state.kv);

    let index = await fetchStoreIndex();
    run.notes.push(
      `store index (internal): ${index.mcp_total} mcp / ${index.agent_total} agents — public list is clean-only`,
    );

    // Discover when store reads are still allowed (isReadSafe = exhausted / hard-stop)
    if (!isReadSafe(ft)) {
      try {
        // Even-rate discovery: grow clean list with mixed agents + MCPs
        // (store index gaps must not starve either side of the public clean registry)
        const disc = await discoverCandidates({
          agentPriority: false,
          mcpPriority: false,
        });

        let skippedNoUrl = 0;
        // Drop already-Active before enqueue so seen_keys cannot trap us
        await purgeAlreadyClean(state, run.notes);
        const queuedKeys = new Set(state.candidates.map((c) => candidateKey(c)));
        for (const c of disc.candidates || []) {
          if (!hasProbeableSource(c)) {
            skippedNoUrl++;
            continue;
          }
          const k = candidateKey(c);
          // Only skip exact queue duplicates — NOT permanent seen_keys death
          if (queuedKeys.has(k)) continue;
          if (state.seen_keys.includes(k)) {
            // Allow re-queue if not currently Active and not in queue
            // (seen_keys alone previously froze growth after first fail wave)
          }
          if (!state.seen_keys.includes(k)) state.seen_keys.push(k);
          queuedKeys.add(k);
          state.candidates.unshift(c);
          run.discovered++;
        }
        if (skippedNoUrl) {
          run.notes.push(
            `discover-skip: ${skippedNoUrl} without probeable card/URL (never queued)`,
          );
        }
        state.totals.discovered += run.discovered;
        run.notes.push(
          `discover: +${run.discovered} probeable candidates (mixed agents+MCPs)`,
        );
        for (const n of disc.notes || []) run.notes.push(n);
      } catch (e) {
        run.notes.push(
          `discover: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      run.notes.push("discover: skipped (get budget hard-stop)");
    }

    purgeUnprobeable(state, run.notes);
    const { PROBES_PER_TICK } = await import("@/lib/agents1/probe");
    await applyHandshakeProbes(state, run, PROBES_PER_TICK);


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

    // Only submit after probe handshake ok at source URL
    const ranked = state.candidates
      .filter((c) =>
        ["queued", "enriched", "deferred", "failed"].includes(c.status),
      )
      .filter((c) => hasProbeableSource(c))
      .filter((c) =>
        (c.quality_hints || []).some((h) => h === "handshake:ok"),
      )
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

      if (!hasProbeableSource(working)) {
        working.status = "deferred";
        working.last_error = "no probeable source URL";
        working.updated_at = new Date().toISOString();
        state.candidates[idx] = working;
        skippedQuality++;
        continue;
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

    purgeUnprobeable(state, run.notes);

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
    if (state.seen_keys.length > 2000) {
      state.seen_keys = state.seen_keys.slice(-1500);
    }
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
  purgeUnprobeable(state, notes);
  if (notes.length) {
    try {
      await saveState(state);
    } catch {
      /* */
    }
  }
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
    endpoint_url: isAgent ? url : undefined,
    source: "submit_url",
    status: "queued",
    attempts: 0,
    discovered_at: ts,
    updated_at: ts,
    quality_hints: ["manual", "probe-first"],
  };
  if (!hasProbeableSource(c)) {
    return {
      ok: false,
      kind: c.kind,
      candidate: c,
      message: "URL is not a probeable agent-card or MCP endpoint",
    };
  }
  state.candidates.unshift(c);
  purgeUnprobeable(state, []);
  await saveState(state);
  // Probe at this URL first — never list without handshake
  try {
    await applyHandshakeProbes(state, { notes: [] }, 1);
    await saveState(state);
  } catch {
    /* */
  }
  const refreshed = state.candidates.find((x) => x.id === c.id) || c;
  if ((refreshed.quality_hints || []).includes("handshake:ok")) {
    try {
      const enriched = await enrichCandidate(refreshed);
      const sub = await submitCandidate(enriched);
      return {
        ok: Boolean(sub.ok || sub.approved || sub.duplicate),
        kind: c.kind,
        candidate: enriched,
        message:
          sub.message ||
          sub.error ||
          (sub.ok ? "probe ok — submitted" : "probe ok"),
        store_response_json: JSON.stringify(sub.raw || {}).slice(0, 2000),
      };
    } catch (e) {
      return {
        ok: true,
        kind: c.kind,
        candidate: refreshed,
        message: `probe ok; submit later: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  return {
    ok: false,
    kind: c.kind,
    candidate: refreshed,
    message:
      "Probed at source URL — handshake not ok. Fix the card and resubmit. Nothing is listed until probe ok.",
  };
}

// silence unused import if ACTIVE_REPROBE_MS only referenced elsewhere
void ACTIVE_REPROBE_MS;
