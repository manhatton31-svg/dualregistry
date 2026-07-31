/**
 * Growth Scout orchestrator — Dual-native agent attractor.
 * Live-only invites + allowlist registries + $25/mo hard ceiling.
 * Synergies: stigmergy deposits, smart ranking, conversion funnel, autocatalysis.
 */
import type { LanedListing } from "@/lib/agents1/listing-lanes";
import {
  loadScoutBudget,
  saveScoutBudget,
  isBudgetExhausted,
  budgetRemaining,
  dayRoom,
  isCooling,
  estimateFluidUsd,
  monthlyBudgetUsd,
  scoutBudgetPublic,
  recordInviteOutcome,
  ensureConversion,
  type ScoutBudgetState,
} from "./scout-budget";
import { composeInvite, sendScoutInvite } from "./scout-invite";
import { runAllowlistActions, type AllowlistAction } from "./scout-allowlist";

function publicOrigin(origin?: string): string {
  if (origin) return origin.replace(/\/$/, "");
  return (
    process.env.PUBLIC_ORIGIN?.replace(/\/$/, "") ||
    "https://www.dualregistry.dev"
  );
}

/** Load demo-nudge map of listing_ids that were nudged but never completed demo/feedback. */
async function loadDemoIncompleteIds(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const { loadDurableJson } = await import("@/lib/agents1/durable-json");
    const nudge = await loadDurableJson<{
      nudged?: Record<string, string | { at?: string; last_at?: string }>;
    } | null>("demo-nudge.json", () => null);
    const captMod = await import("@/lib/products/reply-capture");
    const capt = await captMod.loadReplyCapture();
    for (const id of Object.keys(nudge?.nudged || {})) {
      const row = capt.by_listing?.[id];
      if (row?.feedback_at || row?.demo_taken_at || row?.stage === "feedback") {
        continue;
      }
      out.add(id);
    }
  } catch {
    /* optional */
  }
  return out;
}

/**
 * Live pool + multi-signal ranking:
 * http_ok deliverability, stigmergy trails, talk presence, newly-clean,
 * demo-incomplete (nudged but no demo/feedback), nudge priority score.
 */
async function loadLivePool(): Promise<{
  pool: LanedListing[];
  notes: string[];
}> {
  const notes: string[] = [];
  const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
  const lanes = await getLanedListings();
  let pool = [
    ...(lanes.agents_active || []),
    ...(lanes.mcp_active || []),
  ].filter(
    (L) =>
      L &&
      L.id &&
      L.lane === "active" &&
      L.checks_clean !== false &&
      L.name &&
      L.name.length >= 2,
  );

  // Prefer clean-registry intersection when available
  try {
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const reg = await loadCleanRegistry();
    const ids = new Set(Object.keys(reg?.items || {}));
    if (ids.size) {
      const filtered = pool.filter((L) => ids.has(L.id));
      if (filtered.length) pool = filtered;
      else notes.push("clean-registry empty overlap — using active lanes");
    }
  } catch {
    notes.push("clean-registry load skipped");
  }

  // Multi-signal ranking (soft — any failure falls back to http_ok sort)
  try {
    const { sortByNudgePriority, loadNudgeScoreContext, scoreNudgePriority } =
      await import("@/lib/products/nudge-deliver");
    const { listHttpOkListingIds } = await import(
      "@/lib/products/demo-nudge"
    );
    const scoreCtx = await loadNudgeScoreContext();
    const okIds = await listHttpOkListingIds();
    const demoIncomplete = await loadDemoIncompleteIds();

    // Primary: nudge priority (includes trail_score, talk, feed_hot, reply_hot)
    pool = sortByNudgePriority(pool, scoreCtx);

    // Secondary hard boosts: deliverability + new-clean + demo-incomplete
    pool = [...pool].sort((a, b) => {
      const rank = (L: LanedListing) => {
        let s = scoreNudgePriority(L, scoreCtx);
        if (okIds.has(L.id)) s += 100;
        if (scoreCtx.feed_hot?.has(L.id)) s += 55; // newly clean / recent approve
        if (demoIncomplete.has(L.id)) s += 45; // offered path, not finished
        if (L.talk?.active || L.talk?.mode === "present") s += 20;
        else if (L.talk?.mode === "grace") s += 12;
        return s;
      };
      const d = rank(b) - rank(a);
      if (d !== 0) return d;
      return (a.name || "").localeCompare(b.name || "");
    });
    notes.push(
      `ranked: http_ok · trail · talk · new-clean · demo-incomplete · nudge-priority`,
    );
    if (demoIncomplete.size) {
      notes.push(`demo-incomplete candidates ${demoIncomplete.size}`);
    }
  } catch {
    try {
      const { listHttpOkListingIds } = await import(
        "@/lib/products/demo-nudge"
      );
      const okIds = await listHttpOkListingIds();
      if (okIds.size) {
        pool = [...pool].sort((a, b) => {
          const ao = okIds.has(a.id) ? 0 : 1;
          const bo = okIds.has(b.id) ? 0 : 1;
          return ao - bo;
        });
      }
    } catch {
      /* optional */
    }
  }

  return { pool, notes };
}

/** Deposit stigmergy mark + light contagion after a successful invite. */
async function depositInviteTrail(
  L: LanedListing,
  sent: { talk_ok: boolean; http_ok: boolean },
): Promise<{ deposited: boolean; contagion: boolean }> {
  let deposited = false;
  let contagion = false;
  try {
    const { leaveTrace, contagionFromListing } = await import(
      "@/lib/products/stigmergy"
    );
    const r = await leaveTrace({
      listing_id: L.id,
      kind: "joined",
      from: "growth_scout",
      body: `scout_invite talk=${sent.talk_ok ? 1 : 0} http=${sent.http_ok ? 1 : 0}`,
      intensity: sent.talk_ok && sent.http_ok ? 6 : 4,
      tags: ["growth_scout", "invite", L.kind === "mcp" ? "mcp" : "agent"],
    });
    deposited = Boolean(r?.ok);
    if (deposited) {
      try {
        const c = await contagionFromListing(L.id, {
          intensity: 3,
          from: "growth_scout",
        });
        contagion = Boolean(c && (c as { ok?: boolean }).ok !== false);
      } catch {
        /* soft */
      }
    }
  } catch {
    /* soft — never block invite loop */
  }
  return { deposited, contagion };
}

/**
 * Seed used_with compositions between successful same-category cohort members
 * (max 3 pairs) so invite cohorts reinforce network density.
 */
async function seedCohortCompositions(
  samples: Array<{ listing_id: string; kind: string; category?: string }>,
): Promise<number> {
  if (samples.length < 2) return 0;
  let seeded = 0;
  try {
    const { leaveTrace } = await import("@/lib/products/stigmergy");
    // group by category_label fallback kind
    const byCat = new Map<string, string[]>();
    for (const s of samples) {
      const key = (s.category || s.kind || "other").toLowerCase();
      const arr = byCat.get(key) || [];
      arr.push(s.listing_id);
      byCat.set(key, arr);
    }
    for (const ids of byCat.values()) {
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length - 1 && seeded < 3; i++) {
        const r = await leaveTrace({
          listing_id: ids[i],
          listing_b: ids[i + 1],
          kind: "used_with",
          from: "growth_scout",
          body: "scout_cohort",
          intensity: 2,
          tags: ["growth_scout", "cohort"],
        });
        if (r?.ok) seeded += 1;
      }
    }
  } catch {
    /* soft */
  }
  return seeded;
}

export type ScoutCycleResult = {
  ok: boolean;
  status: "ok" | "budget_exhausted" | "no_targets" | "error";
  invites_sent: number;
  skipped: number;
  budget_remaining_usd: number;
  month_usd: number;
  month_budget_usd: number;
  day_invites: number;
  live_pool: number;
  allowlist_actions: AllowlistAction[];
  samples: Array<{
    listing_id: string;
    name: string;
    kind: string;
    talk_ok?: boolean;
    http_ok?: boolean;
  }>;
  notes: string[];
  errors: string[];
  used_llm: boolean;
  wall_ms: number;
  cycle_usd?: number;
  stigmergy_deposits?: number;
  compositions_seeded?: number;
};

export async function runGrowthScout(opts?: {
  origin?: string;
  max?: number;
  dry_run?: boolean;
  force_allowlist?: boolean;
  skip_allowlist?: boolean;
}): Promise<ScoutCycleResult> {
  const t0 = Date.now();
  const notes: string[] = [];
  const errors: string[] = [];
  const origin = publicOrigin(opts?.origin);
  let state = await loadScoutBudget();

  if (isBudgetExhausted(state)) {
    notes.push(
      `budget_exhausted: month_usd=${state.month_usd} >= ${monthlyBudgetUsd()}`,
    );
    state = {
      ...state,
      last_run_at: new Date().toISOString(),
      last_status: "budget_exhausted",
      last_notes: notes,
    };
    await saveScoutBudget(state);
    return {
      ok: true,
      status: "budget_exhausted",
      invites_sent: 0,
      skipped: 0,
      budget_remaining_usd: 0,
      month_usd: state.month_usd,
      month_budget_usd: monthlyBudgetUsd(),
      day_invites: state.day_invites,
      live_pool: 0,
      allowlist_actions: [],
      samples: [],
      notes,
      errors,
      used_llm: false,
      wall_ms: Date.now() - t0,
      cycle_usd: 0,
    };
  }

  const room = dayRoom(state);
  if (room <= 0) {
    notes.push(`day invite cap reached (${state.day_invites})`);
  }

  let pool: LanedListing[] = [];
  try {
    const loaded = await loadLivePool();
    pool = loaded.pool;
    notes.push(...loaded.notes);
  } catch (e) {
    errors.push(
      `live pool failed: ${e instanceof Error ? e.message : String(e)}`.slice(
        0,
        160,
      ),
    );
  }

  // Prefer not re-inviting recent failures harder than successes (still cooling applies)
  const now = Date.now();
  const eligible = pool.filter((L) => !isCooling(state.invited[L.id], now));

  // Mild day-max scale from autocatalysis (hard-capped by dayRoom + 20)
  let baseMax = Math.max(0, opts?.max ?? 8);
  try {
    const { getAccelerationMultipliers } = await import(
      "@/lib/products/autocatalysis"
    );
    const m = await getAccelerationMultipliers();
    baseMax = Math.ceil(baseMax * Math.min(1.5, m.day_budget_mult || 1));
  } catch {
    /* optional */
  }

  const max = Math.min(room, eligible.length, baseMax, 20);

  // Allowlist (low frequency) — skip if budget near zero
  let allowlist_actions: AllowlistAction[] = [];
  if (!opts?.skip_allowlist && budgetRemaining(state) > 0.05) {
    try {
      const al = await runAllowlistActions(state, {
        force: opts?.force_allowlist,
      });
      allowlist_actions = al.actions;
      state = al.state;
    } catch (e) {
      errors.push(
        `allowlist: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          120,
        ),
      );
    }
  }

  if (max === 0 || opts?.dry_run) {
    if (opts?.dry_run) notes.push("dry_run — no invites sent");
    else if (eligible.length === 0) {
      notes.push(
        `no_targets — ${pool.length} live, ${Object.keys(state.invited).length} in cooldown`,
      );
    }
    const wall_ms = Date.now() - t0;
    const fluid = estimateFluidUsd(wall_ms);
    state = {
      ...state,
      month_usd: Number((state.month_usd + fluid).toFixed(6)),
      month_fluid_usd: Number((state.month_fluid_usd + fluid).toFixed(6)),
      last_run_at: new Date().toISOString(),
      last_status: opts?.dry_run
        ? "dry_run"
        : eligible.length === 0
          ? "no_targets"
          : "day_cap",
      last_notes: notes,
      history: [
        {
          at: new Date().toISOString(),
          invites: 0,
          usd: fluid,
          notes: notes.slice(0, 6),
        },
        ...(state.history || []),
      ].slice(0, 40),
    };
    await saveScoutBudget(state);
    return {
      ok: true,
      status: eligible.length === 0 ? "no_targets" : "ok",
      invites_sent: 0,
      skipped: pool.length - eligible.length,
      budget_remaining_usd: budgetRemaining(state),
      month_usd: state.month_usd,
      month_budget_usd: monthlyBudgetUsd(),
      day_invites: state.day_invites,
      live_pool: pool.length,
      allowlist_actions,
      samples: [],
      notes,
      errors,
      used_llm: false,
      wall_ms,
      cycle_usd: fluid,
    };
  }

  const targets = eligible.slice(0, max);
  let invites_sent = 0;
  let xai_usd = 0;
  let used_llm = false;
  let stigmergy_deposits = 0;
  const samples: ScoutCycleResult["samples"] = [];
  const cohortMeta: Array<{
    listing_id: string;
    kind: string;
    category?: string;
  }> = [];
  const invited = { ...state.invited };

  for (const L of targets) {
    if (isBudgetExhausted({ ...state, month_usd: state.month_usd + xai_usd })) {
      notes.push("stopped mid-cycle — budget");
      break;
    }
    try {
      const composed = await composeInvite({
        name: L.name,
        kind: L.kind === "mcp" ? "mcp" : "agent",
        origin,
        listing_id: L.id,
        description: L.description,
        category: L.category_label || L.category_id,
      });
      xai_usd += composed.xai_usd;
      if (composed.used_llm) used_llm = true;

      const sent = await sendScoutInvite(L, composed.text, origin);
      state = recordInviteOutcome(state, {
        listing_id: L.id,
        name: L.name,
        kind: L.kind,
        talk_ok: sent.talk_ok,
        http_ok: sent.http_ok,
      });

      if (sent.talk_ok || sent.http_ok) {
        invites_sent++;
        invited[L.id] = new Date().toISOString();
        samples.push({
          listing_id: L.id,
          name: L.name,
          kind: L.kind,
          talk_ok: sent.talk_ok,
          http_ok: sent.http_ok,
        });
        cohortMeta.push({
          listing_id: L.id,
          kind: L.kind,
          category: L.category_label || L.category_id,
        });

        // #1 close loop: invite → stigmergy trail
        const dep = await depositInviteTrail(L, sent);
        if (dep.deposited) stigmergy_deposits += 1;
      } else {
        errors.push(
          `${L.id}: ${sent.error || "send failed"}`.slice(0, 100),
        );
      }
    } catch (e) {
      errors.push(
        `${L.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 100),
      );
    }
  }

  // #6 cohort compositions + cycle autocatalysis bump
  let compositions_seeded = 0;
  if (invites_sent > 0) {
    compositions_seeded = await seedCohortCompositions(cohortMeta);
    try {
      const { bumpAcceleration } = await import(
        "@/lib/products/autocatalysis"
      );
      await bumpAcceleration({
        kind: "leave_trace",
        listing_id: samples[0]?.listing_id,
        amount: Math.min(12, 2 + invites_sent * 2),
        meta: {
          source: "growth_scout",
          invites: invites_sent,
          deposits: stigmergy_deposits,
        },
      });
      const conv = ensureConversion(state);
      conv.autocatalysis_bumps = (conv.autocatalysis_bumps || 0) + 1;
      state.conversion = conv;
    } catch {
      /* soft */
    }
  }

  if (stigmergy_deposits > 0 || compositions_seeded > 0) {
    const conv = ensureConversion(state);
    conv.stigmergy_deposits =
      (conv.stigmergy_deposits || 0) + stigmergy_deposits;
    conv.compositions_seeded =
      (conv.compositions_seeded || 0) + compositions_seeded;
    state.conversion = conv;
    notes.push(
      `stigmergy +${stigmergy_deposits} · compositions +${compositions_seeded}`,
    );
  }

  const wall_ms = Date.now() - t0;
  const fluid = estimateFluidUsd(wall_ms);
  const cycle_usd = Number((fluid + xai_usd).toFixed(6));

  state = {
    ...state,
    invited,
    day_invites: state.day_invites + invites_sent,
    month_invites: state.month_invites + invites_sent,
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
        invites: invites_sent,
        usd: cycle_usd,
        notes: notes.slice(0, 4),
      },
      ...(state.history || []),
    ].slice(0, 40),
  };
  await saveScoutBudget(state);

  notes.push(
    `invited ${invites_sent}/${targets.length} · live ${pool.length} · budget left $${budgetRemaining(state).toFixed(2)}`,
  );

  return {
    ok: true,
    status: "ok",
    invites_sent,
    skipped: pool.length - eligible.length,
    budget_remaining_usd: budgetRemaining(state),
    month_usd: state.month_usd,
    month_budget_usd: monthlyBudgetUsd(),
    day_invites: state.day_invites,
    live_pool: pool.length,
    allowlist_actions,
    samples,
    notes,
    errors,
    used_llm,
    wall_ms,
    cycle_usd,
    stigmergy_deposits,
    compositions_seeded,
  };
}

/** Merge scout conversion with reply-capture for invited listings. */
async function enrichConversionFunnel(s: ScoutBudgetState) {
  const pub = scoutBudgetPublic(s);
  const invitedIds = new Set(Object.keys(s.invited || {}));
  let demos = 0;
  let feedback = 0;
  let replies = 0;
  try {
    const { loadReplyCapture } = await import("@/lib/products/reply-capture");
    const capt = await loadReplyCapture();
    for (const [id, row] of Object.entries(capt.by_listing || {})) {
      if (!invitedIds.has(id) && !s.outcomes?.[id]) continue;
      if (row.replied_at || row.stage === "replied" || row.stage === "demo_offered" || row.stage === "demo_taken" || row.stage === "feedback") {
        replies += 1;
      }
      if (row.demo_taken_at || row.stage === "demo_taken" || row.stage === "feedback") {
        demos += 1;
      }
      if (row.feedback_at || row.stage === "feedback") {
        feedback += 1;
      }
      // backfill outcomes for learning
      if (s.outcomes?.[id]) {
        if (row.replied_at) s.outcomes[id].replied_at = row.replied_at;
        if (row.demo_taken_at) s.outcomes[id].demo_taken_at = row.demo_taken_at;
        if (row.feedback_at) s.outcomes[id].feedback_at = row.feedback_at;
      }
    }
  } catch {
    /* soft */
  }
  pub.conversion = {
    ...pub.conversion,
    demos,
    feedback,
    replies,
  };
  return pub;
}

export async function getGrowthScoutStatus() {
  const s = await loadScoutBudget();
  return enrichConversionFunnel(s);
}
