/**
 * Theme progression for Kernel/Loop improvements:
 *   1st–3rd agent with a theme → individualize each agent (logged)
 *   4th use of same theme → ship sitewide into generators (logged; all agents can see)
 * High-severity can still use canary before ship when human-requested.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";

const PATH = join(dataRoot(), "products", "system-ship.json");

/** First N agents with a theme get individualized experience */
export const INDIVIDUAL_UNTIL = 3;
/** Same as SYSTEM_THEME_THRESHOLD — after 3 individuals, theme is a system candidate */
export const SYSTEM_THEME_THRESHOLD = 3;
/** 4th report of the same theme → auto sitewide ship (theme used again) */
export const SITEWIDE_AT = 4;
/** High severity when count reaches this (canary preferred before manual ship) */
export const HIGH_SEVERITY_COUNT = 5;
/** Canary cohort size for high-severity themes */
export const CANARY_COHORT_SIZE = 5;

export type ShipStatus =
  | "open"
  | "in_review"
  | "canary"
  | "shipped"
  | "rejected";

export type ShipItem = {
  theme: string;
  status: ShipStatus;
  count: number;
  /** Orders/agents personalized for this theme (first 3) */
  individual_order_ids: string[];
  individual_agent_names: string[];
  severity: "high" | "medium" | "low";
  product_action: string;
  estimated_system_cost_multiplier: number;
  estimated_quality_delta: number;
  sample_evidence: string[];
  phases: string[];
  canary_order_ids: string[];
  control_order_ids: string[];
  canary_started_at?: string;
  canary_notes?: string[];
  ab_metrics?: {
    canary_n: number;
    control_n: number;
    canary_avg_quality?: number | null;
    control_avg_quality?: number | null;
    quality_delta?: number | null;
    canary_avg_cost_mult?: number | null;
    control_avg_cost_mult?: number | null;
    cost_delta?: number | null;
    ship_recommended?: boolean;
    measured_at?: string;
    notes?: string[];
  };
  reviewed_at?: string;
  review_note?: string;
  shipped_at?: string;
  shipped_directives: {
    kernel: string[];
    loop: string[];
    alive: string[];
  };
  created_at: string;
  updated_at: string;
};

type Store = {
  updated_at: string;
  items: Record<string, ShipItem>;
  shipped_global: {
    kernel: string[];
    loop: string[];
    alive: string[];
    themes: string[];
  };
};

let mem: Store | null = null;

function empty(): Store {
  return {
    updated_at: new Date().toISOString(),
    items: {},
    shipped_global: { kernel: [], loop: [], alive: [], themes: [] },
  };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.items = mem!.items || {};
    mem!.shipped_global = mem!.shipped_global || empty().shipped_global;
    for (const it of Object.values(mem!.items)) {
      it.individual_order_ids = it.individual_order_ids || [];
      it.individual_agent_names = it.individual_agent_names || [];
    }
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: Store) {
  mem = s;
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

function themeToDirectives(
  theme: string,
  evidence: string[],
  extra?: { kernel?: string[]; loop?: string[]; alive?: string[] },
): ShipItem["shipped_directives"] {
  const e0 = evidence[0] || theme;
  const d = {
    kernel: [...(extra?.kernel || [])] as string[],
    loop: [...(extra?.loop || [])] as string[],
    alive: [...(extra?.alive || [])] as string[],
  };
  if (
    /prompt|verbose|short|token|install|export|docs|eval|memory|tool|guard|blocker|skill|goal/i.test(
      theme + e0,
    )
  ) {
    d.kernel.push(`System theme [${theme}]: ${e0.slice(0, 180)}`);
  }
  if (/promote|loop|tick|phase|self.?mod|critic|pain|cost|reliability/i.test(theme + e0)) {
    d.loop.push(`System theme [${theme}]: ${e0.slice(0, 180)}`);
  }
  if (/mesh|a2a|alive|handoff|subagent/i.test(theme + e0)) {
    d.alive.push(`System theme [${theme}]: ${e0.slice(0, 180)}`);
  }
  if (!d.kernel.length && !d.loop.length && !d.alive.length) {
    d.kernel.push(`System theme [${theme}]: ${e0.slice(0, 180)}`);
  }
  return {
    kernel: uniq(d.kernel).slice(0, 8),
    loop: uniq(d.loop).slice(0, 8),
    alive: uniq(d.alive).slice(0, 6),
  };
}

/**
 * Core progression: feedback theme → individual (1–3) → sitewide (4+).
 * Always writes public improvement-log entries so feedback agents can watch.
 */
export async function progressThemeFromFeedback(input: {
  theme: string;
  evidence: string;
  agent_name?: string;
  order_id?: string;
  source?: string;
  phases?: string[];
  directives?: { kernel?: string[]; loop?: string[]; alive?: string[] };
  product_action?: string;
}): Promise<{
  theme: string;
  count: number;
  stage: "individual" | "threshold_met" | "sitewide" | "already_shipped";
  personalized: boolean;
  shipped: boolean;
  individual_slot: number | null;
  message: string;
}> {
  const theme = input.theme.trim().slice(0, 80) || "general";
  const s = await load();
  const now = new Date().toISOString();
  let item = s.items[theme];
  if (!item) {
    item = {
      theme,
      status: "open",
      count: 0,
      individual_order_ids: [],
      individual_agent_names: [],
      severity: "low",
      product_action:
        input.product_action ||
        `Review Kernel/Loop generator for theme: ${theme}`,
      estimated_system_cost_multiplier: 1,
      estimated_quality_delta: 0.03,
      sample_evidence: [],
      phases: [],
      canary_order_ids: [],
      control_order_ids: [],
      shipped_directives: themeToDirectives(theme, [input.evidence], input.directives),
      created_at: now,
      updated_at: now,
    };
  }

  // Already shipped — still personalize this agent, log that sitewide is live
  if (item.status === "shipped") {
    item.count += 1;
    item.updated_at = now;
    s.items[theme] = item;
    s.updated_at = now;
    await persist(s);
    let personalized = false;
    if (input.order_id) {
      await applyIndividual(input.order_id, item, input, "already_shipped");
      personalized = true;
    }
    await logPublic({
      kind: "directive",
      title: `Theme "${theme}" already sitewide — agent saw live generators`,
      detail: `${input.agent_name || "agent"} feedback reinforces shipped theme (n=${item.count}).`,
      agent_name: input.agent_name,
      themes: [theme],
      source: input.source || "feedback",
    });
    return {
      theme,
      count: item.count,
      stage: "already_shipped",
      personalized,
      shipped: true,
      individual_slot: null,
      message: `Theme "${theme}" is already live sitewide. Your feedback is logged; generators already include it.`,
    };
  }

  if (item.status === "rejected") {
    item.count += 1;
    item.updated_at = now;
    s.items[theme] = item;
    await persist(s);
    return {
      theme,
      count: item.count,
      stage: "individual",
      personalized: false,
      shipped: false,
      individual_slot: null,
      message: `Theme "${theme}" was rejected for global ship — individual fixes only.`,
    };
  }

  item.count += 1;
  item.sample_evidence = [
    ...item.sample_evidence.slice(-8),
    input.evidence.slice(0, 200),
  ].slice(-10);
  item.phases = [
    ...new Set([...(item.phases || []), ...(input.phases || ["demo_feedback"])]),
  ];
  item.shipped_directives = themeToDirectives(
    theme,
    item.sample_evidence,
    input.directives,
  );
  if (item.count >= HIGH_SEVERITY_COUNT) item.severity = "high";
  else if (item.count >= SYSTEM_THEME_THRESHOLD) item.severity = "medium";
  else item.severity = "low";

  let personalized = false;
  let individual_slot: number | null = null;
  let stage: "individual" | "threshold_met" | "sitewide" = "individual";
  let shipped = false;

  // First 3 → individualize
  if (item.count <= INDIVIDUAL_UNTIL) {
    individual_slot = item.count;
    if (input.order_id && !item.individual_order_ids.includes(input.order_id)) {
      item.individual_order_ids.push(input.order_id);
      item.individual_order_ids = item.individual_order_ids.slice(0, INDIVIDUAL_UNTIL);
    }
    if (
      input.agent_name &&
      !item.individual_agent_names.includes(input.agent_name)
    ) {
      item.individual_agent_names.push(input.agent_name);
      item.individual_agent_names = item.individual_agent_names.slice(
        0,
        INDIVIDUAL_UNTIL,
      );
    }
    if (input.order_id) {
      await applyIndividual(input.order_id, item, input, "individual");
      personalized = true;
    }
    item.status = item.count >= SYSTEM_THEME_THRESHOLD ? "in_review" : "open";
    stage = item.count >= SYSTEM_THEME_THRESHOLD ? "threshold_met" : "individual";

    await logPublic({
      kind: "personalize",
      title: `Individual #${item.count}/${INDIVIDUAL_UNTIL}: ${theme} → ${input.agent_name || "agent"}`,
      detail: `Personalized Kernel/Loop for this agent only. Theme needs ${SITEWIDE_AT - item.count} more report(s) before sitewide. Evidence: ${input.evidence.slice(0, 160)}`,
      agent_name: input.agent_name,
      themes: [theme],
      source: input.source || "feedback",
      meta: {
        individual_slot: item.count,
        order_id: input.order_id,
        count: item.count,
      },
    });

    if (item.count === SYSTEM_THEME_THRESHOLD) {
      await logPublic({
        kind: "system_candidate",
        title: `Threshold met: ${theme} (3 individuals) — ready for sitewide on next use`,
        detail: `Agents ${item.individual_agent_names.join(", ") || "3 agents"} each got an individualized fix. Next agent who reports this theme ships it sitewide for everyone.`,
        themes: [theme],
        source: "system_ship",
        meta: {
          individual_order_ids: item.individual_order_ids,
          individual_agent_names: item.individual_agent_names,
          next: "sitewide_on_4th",
        },
      });
    }
  } else {
    // 4th+ → sitewide ship (theme used again after 3 individuals)
    stage = "sitewide";
    if (input.order_id) {
      await applyIndividual(input.order_id, item, input, "sitewide_trigger");
      personalized = true;
    }
    // Merge into shipped_global
    item.status = "shipped";
    item.shipped_at = now;
    item.reviewed_at = now;
    item.review_note = `Auto-shipped: theme used again after ${INDIVIDUAL_UNTIL} individualizations (count=${item.count}).`;
    const dirs = item.shipped_directives;
    s.shipped_global.kernel = uniq([
      ...s.shipped_global.kernel,
      ...dirs.kernel,
    ]).slice(0, 40);
    s.shipped_global.loop = uniq([
      ...s.shipped_global.loop,
      ...dirs.loop,
    ]).slice(0, 40);
    s.shipped_global.alive = uniq([
      ...s.shipped_global.alive,
      ...dirs.alive,
    ]).slice(0, 24);
    if (!s.shipped_global.themes.includes(theme)) {
      s.shipped_global.themes.push(theme);
    }
    shipped = true;

    await logPublic({
      kind: "shipped",
      title: `Sitewide ship: ${theme} (after 3 individuals + reuse)`,
      detail: `Theme hit ${item.count} reports. First three agents were individualized; this use promoted the fix into global Kernel/Loop generators. All agents see this in the improvement log.`,
      agent_name: input.agent_name,
      themes: [theme],
      source: "system_ship",
      meta: {
        count: item.count,
        individuals: item.individual_agent_names,
        trigger_agent: input.agent_name,
        kernel_directives: dirs.kernel.slice(0, 3),
        loop_directives: dirs.loop.slice(0, 3),
      },
    });

    // Notify prior individual orders that their theme went sitewide
    try {
      const { recordChange } = await import("./change-log");
      for (const oid of item.individual_order_ids) {
        await recordChange({
          order_id: oid,
          kind: "ship",
          title: `Your feedback theme shipped sitewide: ${theme}`,
          detail: `You were one of the first individualized agents. Theme "${theme}" is now in global Kernel/Loop generators for everyone.`,
          themes: [theme],
          cost_multiplier: item.estimated_system_cost_multiplier,
          quality_delta: item.estimated_quality_delta,
        });
      }
      if (input.order_id && !item.individual_order_ids.includes(input.order_id)) {
        await recordChange({
          order_id: input.order_id,
          kind: "ship",
          title: `You triggered sitewide: ${theme}`,
          detail: `Your feedback was the reuse after 3 individual fixes — theme is now live for all new Kernel/Loop builds.`,
          themes: [theme],
        });
      }
    } catch {
      /* */
    }
  }

  item.updated_at = now;
  s.items[theme] = item;
  s.updated_at = now;
  await persist(s);

  const message =
    stage === "sitewide"
      ? `Theme "${theme}" shipped sitewide (count ${item.count}). Live in Kernel/Loop generators — visible on /api/products/improvement-log.`
      : stage === "threshold_met"
        ? `You are individual #${individual_slot} for "${theme}". Threshold of 3 met — next report ships sitewide. Logged publicly.`
        : `You are individual #${individual_slot} for "${theme}" (${item.count}/${INDIVIDUAL_UNTIL}). Personalized for you only until theme is reused enough to go sitewide.`;

  return {
    theme,
    count: item.count,
    stage,
    personalized,
    shipped,
    individual_slot,
    message,
  };
}

async function applyIndividual(
  orderId: string,
  item: ShipItem,
  input: {
    agent_name?: string;
    directives?: { kernel?: string[]; loop?: string[]; alive?: string[] };
    evidence: string;
  },
  note: string,
) {
  const { upsertPersonalization } = await import("./personalization");
  const { recordChange } = await import("./change-log");
  const dirs = item.shipped_directives;
  await upsertPersonalization(orderId, {
    agent_name: input.agent_name,
    kernel_directives: [
      ...(input.directives?.kernel || []),
      ...dirs.kernel.slice(0, 3),
    ],
    loop_directives: [
      ...(input.directives?.loop || []),
      ...dirs.loop.slice(0, 3),
    ],
    alive_directives: [
      ...(input.directives?.alive || []),
      ...dirs.alive.slice(0, 2),
    ],
    source_phases: ["demo_feedback", note],
    notes: [`theme:${item.theme}`, input.evidence.slice(0, 120)],
  });
  await recordChange({
    order_id: orderId,
    kind: note === "sitewide_trigger" || note === "already_shipped" ? "ship" : "personalize",
    title:
      note === "sitewide_trigger"
        ? `Sitewide trigger + your personalization: ${item.theme}`
        : note === "already_shipped"
          ? `Aligned to live sitewide theme: ${item.theme}`
          : `Individualized from feedback: ${item.theme}`,
    detail: input.evidence.slice(0, 200),
    themes: [item.theme],
  });
}

async function logPublic(entry: {
  kind:
    | "feedback_received"
    | "theme_clustered"
    | "personalize"
    | "system_candidate"
    | "canary"
    | "shipped"
    | "dogfood_kernel"
    | "dogfood_loop"
    | "directive";
  title: string;
  detail: string;
  agent_name?: string;
  themes?: string[];
  source?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const { appendLog } = await import("./improvement-log");
    await appendLog(entry);
  } catch {
    /* non-blocking */
  }
}

/** Upsert from lifecycle engine when multi-agent theme appears */
export async function upsertSystemCandidate(input: {
  theme: string;
  count: number;
  severity: "high" | "medium" | "low";
  product_action: string;
  estimated_system_cost_multiplier: number;
  estimated_quality_delta: number;
  sample_evidence: string[];
  phases: string[];
  agent_name?: string;
  order_id?: string;
}): Promise<ShipItem> {
  // Route through progression so first-3 / sitewide rules apply
  const r = await progressThemeFromFeedback({
    theme: input.theme,
    evidence: input.sample_evidence[0] || input.product_action,
    agent_name: input.agent_name,
    order_id: input.order_id,
    source: "lifecycle",
    phases: input.phases,
    product_action: input.product_action,
  });
  const s = await load();
  const item = s.items[input.theme];
  if (item) {
    item.severity = input.severity;
    item.estimated_system_cost_multiplier =
      input.estimated_system_cost_multiplier;
    item.estimated_quality_delta = input.estimated_quality_delta;
    item.count = Math.max(item.count, input.count, r.count);
    s.items[input.theme] = item;
    await persist(s);
    return item;
  }
  // fallback create
  return progressThemeFromFeedback({
    theme: input.theme,
    evidence: input.sample_evidence[0] || input.theme,
    phases: input.phases,
  }).then(async () => (await load()).items[input.theme]);
}

export async function listReviewQueue() {
  const s = await load();
  const items = Object.values(s.items).sort((a, b) => {
    const sev = { high: 3, medium: 2, low: 1 };
    return (
      sev[b.severity] * 100 +
      b.count -
      (sev[a.severity] * 100 + a.count)
    );
  });
  return {
    policy: {
      individual_until: INDIVIDUAL_UNTIL,
      system_theme_threshold: SYSTEM_THEME_THRESHOLD,
      sitewide_at: SITEWIDE_AT,
      high_severity_count: HIGH_SEVERITY_COUNT,
      canary_cohort_size: CANARY_COHORT_SIZE,
      auto_merge_on_reuse: true,
      note: "First 3 agents with a theme → personalized each. 4th use of same theme → auto sitewide ship into Kernel/Loop generators. Public improvement log shows every step.",
    },
    queue: items.filter((i) =>
      ["open", "in_review", "canary"].includes(i.status),
    ),
    shipped: items.filter((i) => i.status === "shipped"),
    rejected: items.filter((i) => i.status === "rejected"),
    shipped_global: s.shipped_global,
    updated_at: s.updated_at,
  };
}

export async function startCanary(
  theme: string,
  orderIds: string[],
  note?: string,
  controlIds?: string[],
): Promise<ShipItem> {
  const s = await load();
  const item = s.items[theme];
  if (!item) throw new Error(`Unknown theme ${theme}`);
  if (item.status === "shipped") throw new Error("Already shipped");
  if (item.status === "rejected") throw new Error("Rejected — reopen not implemented");
  const unique = [...new Set(orderIds)];
  let treatment: string[] = [];
  let control: string[] = [];
  if (controlIds?.length) {
    treatment = unique.slice(0, CANARY_COHORT_SIZE);
    control = [...new Set(controlIds)]
      .filter((id) => !treatment.includes(id))
      .slice(0, CANARY_COHORT_SIZE);
  } else if (unique.length >= 2) {
    const shuffled = [...unique];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const mid = Math.max(1, Math.floor(shuffled.length / 2));
    treatment = shuffled.slice(0, Math.min(mid, CANARY_COHORT_SIZE));
    control = shuffled.slice(mid, mid + CANARY_COHORT_SIZE);
  } else {
    treatment = unique.slice(0, CANARY_COHORT_SIZE);
    control = [];
  }
  if (treatment.length < 1)
    throw new Error("Need at least one paid order_id for canary");
  item.status = "canary";
  item.canary_order_ids = treatment;
  item.control_order_ids = control;
  item.canary_started_at = new Date().toISOString();
  item.reviewed_at = item.canary_started_at;
  item.review_note =
    note ||
    `A/B canary: treatment n=${treatment.length}, control n=${control.length}.`;
  item.canary_notes = [
    ...(item.canary_notes || []),
    `canary@${item.canary_started_at}: treat=${treatment.join(",")} ctrl=${control.join(",")}`,
  ];
  item.shipped_directives = themeToDirectives(theme, item.sample_evidence);
  item.ab_metrics = {
    canary_n: treatment.length,
    control_n: control.length,
  };
  item.updated_at = item.canary_started_at;
  s.items[theme] = item;
  s.updated_at = item.updated_at;
  await persist(s);

  const { upsertPersonalization } = await import("./personalization");
  const { recordChange } = await import("./change-log");
  for (const oid of treatment) {
    await upsertPersonalization(oid, {
      kernel_directives: item.shipped_directives.kernel,
      loop_directives: item.shipped_directives.loop,
      alive_directives: item.shipped_directives.alive,
      source_phases: ["canary"],
      notes: [`canary theme ${theme}`],
    });
    await recordChange({
      order_id: oid,
      kind: "canary",
      title: `Canary treatment: ${theme}`,
      detail: `You are in the canary cohort for system theme "${theme}". Control agents unchanged.`,
      themes: [theme],
    });
  }
  for (const oid of control) {
    await recordChange({
      order_id: oid,
      kind: "canary",
      title: `Canary control: ${theme}`,
      detail: `Holdout control for "${theme}" — no personalization change.`,
      themes: [theme],
    });
  }
  await logPublic({
    kind: "canary",
    title: `Canary started: ${theme}`,
    detail: item.review_note || "canary",
    themes: [theme],
    source: "system_ship",
  });
  return item;
}

export async function measureCanary(
  theme: string,
  ratings?: { canary?: number[]; control?: number[] },
): Promise<ShipItem> {
  const s = await load();
  const item = s.items[theme];
  if (!item) throw new Error(`Unknown theme ${theme}`);
  if (item.status !== "canary") throw new Error("Not in canary");
  const now = new Date().toISOString();
  const avg = (xs?: number[]) =>
    xs && xs.length
      ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100
      : null;
  const canary_avg = avg(ratings?.canary);
  const control_avg = avg(ratings?.control);
  const quality_delta =
    canary_avg != null && control_avg != null
      ? Math.round((canary_avg - control_avg) * 100) / 100
      : null;
  item.ab_metrics = {
    canary_n: item.canary_order_ids.length,
    control_n: item.control_order_ids.length,
    canary_avg_quality: canary_avg,
    control_avg_quality: control_avg,
    quality_delta,
    measured_at: now,
    ship_recommended: quality_delta == null ? false : quality_delta >= -0.25,
    notes: [
      quality_delta == null
        ? "No ratings provided — do not auto-ship canary without measured quality"
        : `quality Δ ${quality_delta}`,
    ],
  };
  item.updated_at = now;
  s.items[theme] = item;
  await persist(s);
  return item;
}


export async function shipTheme(theme: string, note?: string): Promise<ShipItem> {
  const s = await load();
  const item = s.items[theme];
  if (!item) throw new Error(`Unknown theme ${theme}`);
  if (item.status === "rejected") throw new Error("Rejected");
  // High severity: require canary measurement before global ship (unless human note overrides)
  if (
    item.severity === "high" &&
    !note?.toLowerCase().includes("human approve") &&
    !(item.ab_metrics?.measured_at && item.ab_metrics.ship_recommended)
  ) {
    throw new Error(
      `High-severity theme "${theme}" needs canary measure OK or note containing "human approve" before global ship`,
    );
  }
  const now = new Date().toISOString();
  item.status = "shipped";
  item.shipped_at = now;
  item.reviewed_at = now;
  item.review_note = note || "Shipped to global generators";
  item.updated_at = now;
  const dirs = item.shipped_directives;
  s.shipped_global.kernel = uniq([
    ...s.shipped_global.kernel,
    ...dirs.kernel,
  ]).slice(0, 40);
  s.shipped_global.loop = uniq([
    ...s.shipped_global.loop,
    ...dirs.loop,
  ]).slice(0, 40);
  s.shipped_global.alive = uniq([
    ...s.shipped_global.alive,
    ...dirs.alive,
  ]).slice(0, 24);
  if (!s.shipped_global.themes.includes(theme)) {
    s.shipped_global.themes.push(theme);
  }
  s.items[theme] = item;
  s.updated_at = now;
  await persist(s);
  try {
    const { recordChange } = await import("./change-log");
    for (const oid of [
      ...item.individual_order_ids,
      ...item.canary_order_ids,
      ...item.control_order_ids,
    ]) {
      await recordChange({
        order_id: oid,
        kind: "ship",
        title: `Shipped system-wide: ${theme}`,
        detail:
          note ||
          "Theme merged into global Kernel/Loop generators. Visible on improvement log.",
        themes: [theme],
        cost_multiplier: item.estimated_system_cost_multiplier,
        quality_delta: item.estimated_quality_delta,
      });
    }
  } catch {
    /* */
  }
  await logPublic({
    kind: "shipped",
    title: `Shipped system-wide: ${theme}`,
    detail: item.review_note || "shipped",
    themes: [theme],
    source: "system_ship",
  });
  return item;
}

export async function rejectTheme(theme: string, note?: string): Promise<ShipItem> {
  const s = await load();
  const item = s.items[theme];
  if (!item) throw new Error(`Unknown theme ${theme}`);
  item.status = "rejected";
  item.reviewed_at = new Date().toISOString();
  item.review_note = note || "Rejected — keep individualization only";
  item.updated_at = item.reviewed_at;
  s.items[theme] = item;
  s.updated_at = item.updated_at;
  await persist(s);
  await logPublic({
    kind: "directive",
    title: `Rejected global ship: ${theme}`,
    detail: item.review_note,
    themes: [theme],
    source: "system_ship",
  });
  return item;
}

function uniq(a: string[]) {
  return [...new Set(a.filter(Boolean))];
}

export async function getShippedGeneratorDirectives() {
  const s = await load();
  return {
    version: "shipped-global-1",
    kernel_directives: s.shipped_global.kernel,
    loop_directives: s.shipped_global.loop,
    alive_directives: s.shipped_global.alive,
    themes: s.shipped_global.themes,
  };
}

export async function getCanaryDirectivesForOrder(orderId: string) {
  const s = await load();
  const kernel: string[] = [];
  const loop: string[] = [];
  const alive: string[] = [];
  for (const item of Object.values(s.items)) {
    if (item.status !== "canary") continue;
    if (!item.canary_order_ids.includes(orderId)) continue;
    kernel.push(...item.shipped_directives.kernel);
    loop.push(...item.shipped_directives.loop);
    alive.push(...item.shipped_directives.alive);
  }
  return { kernel_directives: kernel, loop_directives: loop, alive_directives: alive };
}
