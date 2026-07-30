/**
 * Three-speed feedback ship cadence (automatic):
 *
 *  CONTINUOUS (every feedback / drive)
 *    → personalize 1 agent (system-ship progressThemeFromFeedback)
 *
 *  DAILY (1–2× / day, auto)
 *    → themes ≥3: start canary → after window re-measure → sitewide if safe
 *    → medium/low auto-ship; high only after canary OK (human alert if fail)
 *
 *  SHIP GATE (2–3× / week, auto)
 *    → bundle shipped themes → version bump → re-demo wave → log changelog
 *
 * Human is only notified for: high-severity canary fail, or "aware" summary.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  listReviewQueue,
  startCanary,
  measureCanary,
  shipTheme,
  CANARY_COHORT_SIZE,
  type ShipItem,
} from "./system-ship";
import { listFulfilledOrders } from "./orders";
import {
  KERNEL_VERSION,
  LOOP_VERSION,
  ALIVE_VERSION,
  MCP_MESH_VERSION,
} from "./generate";

const PATH = join(process.cwd(), "data", "products", "ship-cadence.json");

/** Canary observation window before auto measure+ship (daily lane) */
const CANARY_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h (fast daily loop; weekly ships still version-bump)
const DAILY_MIN_GAP_MS = 10 * 60 * 60 * 1000; // ~2×/day max full daily pass
const WEEKLY_MIN_GAP_MS = 2.5 * 24 * 60 * 60 * 1000; // ~2–3×/week
const CONTINUOUS_OK = true;

export type HumanAttention = {
  id: string;
  created_at: string;
  severity: "high" | "info";
  title: string;
  detail: string;
  theme?: string;
  action_needed: "none" | "review_canary_fail" | "acknowledge";
  resolved?: boolean;
};

type CadenceState = {
  updated_at: string;
  last_daily_at?: string;
  last_weekly_at?: string;
  last_continuous_at?: string;
  last_daily_notes: string[];
  last_weekly_notes: string[];
  human_attention: HumanAttention[];
  shipped_this_week: string[];
  version_history: Array<{
    at: string;
    alive?: string;
    mcp_mesh?: string;
    themes: string[];
    notes: string;
  }>;
  totals: {
    daily_runs: number;
    weekly_runs: number;
    auto_canaries: number;
    auto_ships: number;
    re_demos_triggered: number;
  };
};

let mem: CadenceState | null = null;
let running = false;

function empty(): CadenceState {
  return {
    updated_at: new Date().toISOString(),
    last_daily_notes: [],
    last_weekly_notes: [],
    human_attention: [],
    shipped_this_week: [],
    version_history: [],
    totals: {
      daily_runs: 0,
      weekly_runs: 0,
      auto_canaries: 0,
      auto_ships: 0,
      re_demos_triggered: 0,
    },
  };
}

async function load(): Promise<CadenceState> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.human_attention = mem!.human_attention || [];
    mem!.totals = { ...empty().totals, ...(mem!.totals || {}) };
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: CadenceState) {
  mem = s;
  s.updated_at = new Date().toISOString();
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

function pushAttention(
  s: CadenceState,
  a: Omit<HumanAttention, "id" | "created_at">,
) {
  const id = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  s.human_attention.unshift({
    id,
    created_at: new Date().toISOString(),
    ...a,
  });
  s.human_attention = s.human_attention.slice(0, 40);
}

async function recentOrderIds(limit = 40): Promise<string[]> {
  const orders = await listFulfilledOrders();
  return orders
    .filter((o) => o.status === "demo" || o.status === "fulfilled" || o.status === "paid")
    .slice(0, limit)
    .map((o) => o.id);
}

/** Pull recent feedback ratings for canary/control orders */
async function ratingsForOrders(
  orderIds: string[],
): Promise<number[]> {
  if (!orderIds.length) return [];
  try {
    const raw = await readFile(
      join(process.cwd(), "data", "products", "feedback.json"),
      "utf8",
    );
    const full = JSON.parse(raw) as {
      items?: Array<{
        order_id?: string;
        rating?: number;
        answers?: { overall?: number; kernel_clarity?: number };
      }>;
    };
    const set = new Set(orderIds);
    const out: number[] = [];
    for (const i of full.items || []) {
      if (!i.order_id || !set.has(i.order_id)) continue;
      const r =
        typeof i.rating === "number"
          ? i.rating
          : typeof i.answers?.overall === "number"
            ? Number(i.answers.overall)
            : typeof i.answers?.kernel_clarity === "number"
              ? Number(i.answers.kernel_clarity)
              : null;
      if (r != null) out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * DAILY lane: canary start + measure + auto-ship medium themes.
 * High severity: canary auto; ship only if measure OK; else human attention.
 */
export async function runDailyShipLane(opts?: {
  force?: boolean;
}): Promise<{ notes: string[]; ships: string[]; canaries: string[] }> {
  const s = await load();
  const notes: string[] = [];
  const ships: string[] = [];
  const canaries: string[] = [];

  if (
    !opts?.force &&
    s.last_daily_at &&
    Date.now() - Date.parse(s.last_daily_at) < DAILY_MIN_GAP_MS
  ) {
    notes.push("daily lane skipped — ran recently");
    return { notes, ships, canaries };
  }

  const q = await listReviewQueue();
  const orderIds = await recentOrderIds(48);

  // 1) Start canaries for in_review / open at threshold
  for (const item of q.queue) {
    if (item.status === "canary") continue;
    if (item.count < 3) continue; // need ≥3
    if (item.status === "open" && item.count < 3) continue;
    try {
      const cohort = [
        ...item.individual_order_ids,
        ...orderIds,
      ].filter(Boolean);
      await startCanary(
        item.theme,
        cohort.slice(0, CANARY_COHORT_SIZE * 2),
        `Auto daily canary (cadence) n≈${Math.min(CANARY_COHORT_SIZE, cohort.length)}`,
      );
      canaries.push(item.theme);
      s.totals.auto_canaries++;
      notes.push(`canary started: ${item.theme} (n=${item.count}, sev=${item.severity})`);
    } catch (e) {
      notes.push(
        `canary skip ${item.theme}: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          120,
        ),
      );
    }
  }

  // Refresh queue after canaries
  const q2 = await listReviewQueue();

  // 2) Measure + ship canaries past window
  for (const item of q2.queue.filter((i) => i.status === "canary")) {
    const started = item.canary_started_at
      ? Date.parse(item.canary_started_at)
      : 0;
    const age = Date.now() - started;
    // High severity waits full window; medium can ship after 3h if force or enough signal
    const need =
      item.severity === "high" ? CANARY_WINDOW_MS : CANARY_WINDOW_MS / 2;
    if (!opts?.force && age < need) {
      notes.push(
        `canary wait ${item.theme}: ${Math.round((need - age) / 3600000)}h left`,
      );
      continue;
    }
    try {
      const canary_r = await ratingsForOrders(item.canary_order_ids);
      const control_r = await ratingsForOrders(item.control_order_ids);
      const measured = await measureCanary(item.theme, {
        canary: canary_r,
        control: control_r,
      });
      const rec = measured.ab_metrics?.ship_recommended !== false;
      if (rec) {
        await shipTheme(
          item.theme,
          `Auto-shipped by daily cadence after canary (sev=${item.severity}, Δ=${measured.ab_metrics?.quality_delta ?? "n/a"})`,
        );
        ships.push(item.theme);
        s.totals.auto_ships++;
        s.shipped_this_week = [...new Set([...s.shipped_this_week, item.theme])];
        notes.push(`auto-shipped: ${item.theme}`);
        await applyThemeToGenerators(item.theme).catch(() => undefined);
      } else if (item.severity === "high") {
        pushAttention(s, {
          severity: "high",
          title: `Canary failed — do not auto-ship: ${item.theme}`,
          detail: `Quality delta ${measured.ab_metrics?.quality_delta}. Theme held. You may reject or re-canary via review API.`,
          theme: item.theme,
          action_needed: "review_canary_fail",
        });
        notes.push(`HUMAN: canary fail ${item.theme}`);
      } else {
        // medium with bad delta — still personalize-only; don't global ship
        notes.push(`hold ${item.theme}: canary Δ not good enough`);
      }
    } catch (e) {
      notes.push(
        `measure/ship ${item.theme}: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          120,
        ),
      );
    }
  }

  // 3) Priority queue: MCP tool policy + agent clarity — ensure applied if themed high volume
  await ensurePriorityShips(s, notes, ships);

  s.last_daily_at = new Date().toISOString();
  s.last_daily_notes = notes.slice(0, 30);
  s.totals.daily_runs++;
  await persist(s);

  try {
    const { appendLog } = await import("./improvement-log");
    await appendLog({
      kind: "directive",
      title: `Daily ship lane: ${ships.length} shipped · ${canaries.length} canaries`,
      detail: notes.slice(0, 8).join(" · ") || "no-op",
      source: "ship_cadence",
      themes: [...ships, ...canaries].slice(0, 12),
      meta: { ships, canaries, lane: "daily" },
    });
  } catch {
    /* */
  }

  return { notes, ships, canaries };
}

/**
 * Known high-volume themes → ensure generator defaults + mark shipped.
 */
async function ensurePriorityShips(
  s: CadenceState,
  notes: string[],
  ships: string[],
) {
  const priority = [
    {
      theme: "mcp_agent_tool_policy_examples",
      audience: "mcp" as const,
      action: "MCP Mesh: agent-facing tool policy examples + least-privilege export",
    },
    {
      theme: "one_click_skill_md",
      audience: "both" as const,
      action: "SKILL.md first in install kit / export",
    },
    {
      theme: "shorter_system_prompt",
      audience: "agent" as const,
      action: "system_prompt_short ≤600 ultra_compact default",
    },
    {
      theme: "clearer_goal_examples",
      audience: "agent" as const,
      action: "goal_examples lead in kernel quick_start",
    },
  ];

  const q = await listReviewQueue();
  const shipped = new Set(q.shipped.map((i) => i.theme));
  const globalThemes = new Set(q.shipped_global?.themes || []);

  for (const p of priority) {
    if (shipped.has(p.theme) || globalThemes.has(p.theme)) {
      // Already shipped for real — keep generators aligned
      await applyThemeToGenerators(p.theme).catch(() => undefined);
      continue;
    }
    // Only ship when real theme evidence exists (count≥3 from real feedback path)
    const existing = [...q.queue, ...q.shipped].find((i) => i.theme === p.theme);
    if (existing && existing.count >= 3 && existing.status !== "shipped") {
      try {
        if (existing.status === "canary") {
          await measureCanary(p.theme, {});
        }
        await shipTheme(p.theme, `Priority daily ship: ${p.action}`);
        ships.push(p.theme);
        s.totals.auto_ships++;
        notes.push(`priority ship: ${p.theme}`);
        await applyThemeToGenerators(p.theme).catch(() => undefined);
      } catch (e) {
        notes.push(
          `priority ship skipped ${p.theme}: ${e instanceof Error ? e.message : String(e)}`.slice(
            0,
            100,
          ),
        );
      }
    } else {
      notes.push(
        `priority hold ${p.theme}: need ≥3 real agent votes (have ${existing?.count ?? 0})`,
      );
    }
  }
}

/** Map theme keys → live generator knobs (idempotent) */
async function applyThemeToGenerators(theme: string) {
  const { appendLog } = await import("./improvement-log");
  // Generators already read shipped_global + feedback context; this records intent + bumps mesh pack flags in store
  const flagPath = join(process.cwd(), "data", "products", "generator-flags.json");
  let flags: Record<string, unknown> = {};
  try {
    flags = JSON.parse(await readFile(flagPath, "utf8"));
  } catch {
    flags = {};
  }
  const t = theme.toLowerCase();
  if (/mcp|tool.?policy|install|skill/i.test(t)) {
    flags.mcp_agent_tool_examples = true;
    flags.mcp_least_privilege_export = true;
    flags.mcp_skill_md_first = true;
  }
  if (/short|prompt|token/i.test(t)) {
    flags.ultra_compact_default = true;
    flags.short_prompt_max = 600;
  }
  if (/goal.?example/i.test(t)) {
    flags.goal_examples_lead = true;
  }
  if (/skill/i.test(t)) {
    flags.skill_md_first = true;
  }
  if (/reliab|loop/i.test(t)) {
    flags.mcp_reliability_loop = true;
  }
  if (/pric|buy.?doc/i.test(t)) {
    flags.pricing_transparency_in_demo = true;
  }
  flags.updated_at = new Date().toISOString();
  flags.last_theme = theme;
  await mkdir(dirname(flagPath), { recursive: true });
  await writeFile(flagPath, JSON.stringify(flags, null, 2), "utf8");

  await appendLog({
    kind: "shipped",
    title: `Generator flags applied: ${theme}`,
    detail: `Sitewide generators honor theme via flags + shipped_global directives.`,
    themes: [theme],
    source: "ship_cadence",
  }).catch(() => undefined);
}

/**
 * WEEKLY ship gate: version stamp + re-demo for prior feedbackers.
 */
export async function runWeeklyShipGate(opts?: {
  force?: boolean;
}): Promise<{ notes: string[]; version?: string }> {
  const s = await load();
  const notes: string[] = [];

  if (
    !opts?.force &&
    s.last_weekly_at &&
    Date.now() - Date.parse(s.last_weekly_at) < WEEKLY_MIN_GAP_MS
  ) {
    notes.push("weekly gate skipped — too soon");
    return { notes };
  }

  const q = await listReviewQueue();
  const newly = s.shipped_this_week.length
    ? s.shipped_this_week
    : q.shipped.slice(0, 8).map((i) => i.theme);

  // Version bump metadata (generate.ts constants are source of truth for code;
  // we record ship pack version for demos to re-key)
  const pack = {
    at: new Date().toISOString(),
    alive: ALIVE_VERSION,
    mcp_mesh: MCP_MESH_VERSION,
    themes: newly,
    notes: `Weekly pack: ${newly.join(", ") || "maintenance"}`,
  };
  s.version_history.unshift(pack);
  s.version_history = s.version_history.slice(0, 40);

  // Re-demo wave: clear invited keys for current version is handled by feedback-drive
  // version keys; force a feedback drive with re-demo preference
  try {
    const { runFeedbackDrive } = await import("./feedback-drive");
    const r = await runFeedbackDrive({ force: true });
    s.totals.re_demos_triggered += r.demos_seeded || 0;
    notes.push(
      `re-demo wave: +${r.demos_seeded} demos · +${r.feedbacks} feedbacks`,
    );
  } catch (e) {
    notes.push(
      `re-demo wave fail: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Info-only human attention (acknowledge, not blocking)
  pushAttention(s, {
    severity: "info",
    title: `Weekly product pack shipped`,
    detail: `Versions Alive ${ALIVE_VERSION} / Mesh ${MCP_MESH_VERSION}. Themes: ${newly.join(", ") || "none new"}. Re-demo wave triggered. No action required unless canary failures appear above.`,
    action_needed: "acknowledge",
  });

  s.last_weekly_at = new Date().toISOString();
  s.last_weekly_notes = notes;
  s.shipped_this_week = [];
  s.totals.weekly_runs++;
  await persist(s);

  try {
    const { appendLog } = await import("./improvement-log");
    await appendLog({
      kind: "shipped",
      title: `Weekly ship gate · Alive ${ALIVE_VERSION} · Mesh ${MCP_MESH_VERSION}`,
      detail: notes.join(" · "),
      source: "ship_cadence",
      themes: newly,
      meta: { pack, lane: "weekly" },
    });
  } catch {
    /* */
  }

  return { notes, version: ALIVE_VERSION };
}

/**
 * Master entry — continuous is free; daily/weekly respect gaps.
 * Call from feedback-drive + scheduler.
 */
export async function runShipCadence(opts?: {
  force_daily?: boolean;
  force_weekly?: boolean;
}): Promise<{
  ok: boolean;
  continuous: boolean;
  daily?: Awaited<ReturnType<typeof runDailyShipLane>>;
  weekly?: Awaited<ReturnType<typeof runWeeklyShipGate>>;
  human_attention: HumanAttention[];
}> {
  if (running) {
    const s = await load();
    return {
      ok: false,
      continuous: CONTINUOUS_OK,
      human_attention: s.human_attention.filter((a) => !a.resolved),
    };
  }
  running = true;
  try {
    const s = await load();
    s.last_continuous_at = new Date().toISOString();
    await persist(s);

    const daily = await runDailyShipLane({ force: opts?.force_daily });
    let weekly: Awaited<ReturnType<typeof runWeeklyShipGate>> | undefined;
    // Weekly only if we shipped something this week or forced
    if (opts?.force_weekly || (await load()).shipped_this_week.length >= 2) {
      weekly = await runWeeklyShipGate({ force: opts?.force_weekly });
    } else {
      // still try weekly on schedule
      weekly = await runWeeklyShipGate({ force: opts?.force_weekly });
    }

    const s2 = await load();
    return {
      ok: true,
      continuous: true,
      daily,
      weekly,
      human_attention: s2.human_attention.filter((a) => !a.resolved),
    };
  } finally {
    running = false;
  }
}

export async function getShipCadencePublic() {
  const s = await load();
  const open = s.human_attention.filter((a) => !a.resolved);
  return {
    ok: true as const,
    policy: {
      continuous: "Personalize same day (1 agent → individual)",
      daily:
        "≥3 agents → canary → auto sitewide if measure OK (medium). High: human only on canary fail.",
      weekly: "2–3×/week version pack + re-demo wave",
      rule: "Personalize same day. Canary within 24h of repeated theme. Sitewide after canary + version awareness.",
      canary_window_hours: CANARY_WINDOW_MS / 3600000,
      daily_gap_hours: DAILY_MIN_GAP_MS / 3600000,
      weekly_gap_days: WEEKLY_MIN_GAP_MS / (24 * 3600000),
    },
    versions: {
      kernel: KERNEL_VERSION,
      loop: LOOP_VERSION,
      alive: ALIVE_VERSION,
      mcp_mesh: MCP_MESH_VERSION,
    },
    last_daily_at: s.last_daily_at,
    last_weekly_at: s.last_weekly_at,
    last_daily_notes: s.last_daily_notes,
    last_weekly_notes: s.last_weekly_notes,
    shipped_this_week: s.shipped_this_week,
    version_history: s.version_history.slice(0, 8),
    totals: s.totals,
    /** Only things you need to see — empty means fully automatic */
    human_attention: open,
    needs_you: open.filter((a) => a.action_needed === "review_canary_fail"),
    updated_at: s.updated_at,
  };
}

export async function acknowledgeAttention(id: string) {
  const s = await load();
  const a = s.human_attention.find((x) => x.id === id);
  if (a) a.resolved = true;
  await persist(s);
  return a;
}
