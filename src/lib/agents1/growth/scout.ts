/**
 * Growth Scout orchestrator — Dual-native agent attractor.
 * Live-only invites + allowlist registries + $25/mo hard ceiling.
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

  // Prefer http_ok when known (higher deliverability) — async API
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

  return { pool, notes };
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

  const now = Date.now();
  const eligible = pool.filter((L) => !isCooling(state.invited[L.id], now));
  const max = Math.min(
    room,
    eligible.length,
    Math.max(0, opts?.max ?? 8),
    20,
  );

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
  const samples: ScoutCycleResult["samples"] = [];
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
      });
      xai_usd += composed.xai_usd;
      if (composed.used_llm) used_llm = true;

      const sent = await sendScoutInvite(L, composed.text, origin);
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
  };
}

export async function getGrowthScoutStatus() {
  const s = await loadScoutBudget();
  return scoutBudgetPublic(s);
}
