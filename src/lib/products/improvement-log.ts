/**
 * Public Kernel Improver + Recursive Loop improvement log.
 * Shows agents & creators: feedback in → decisions → generator changes → live dogfood run.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { dataRoot } from "@/lib/data-root";
import {
  listFeedback,
  getFeedbackInsights,
  getWtpReport,
} from "./feedback";
import { recentChanges } from "./change-log";
import { listReviewQueue } from "./system-ship";
import { getProductEngagement } from "./engagement";
import { getLearningPublic } from "./learning-loop";
import {
  generateKernel,
  generateRecursiveLoop,
  type FeedbackDrivenContext,
} from "./generate";
import {
  FLYWHEEL_VERSION,
  PLATFORM_KERNEL_DIRECTIVES,
  PLATFORM_LOOP_DIRECTIVES,
} from "./flywheel";

const PATH = join(dataRoot(), "products", "improvement-log.json");

export type LogEntry = {
  id: string;
  at: string;
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
};

type Store = {
  updated_at: string;
  entries: LogEntry[];
  dogfood?: {
    last_run_at: string;
    agent_name: string;
    seed: string;
    kernel_summary: string;
    loop_summary: string;
    constitution_sample: string[];
    phases_sample: string[];
    feedback_directives_applied: string[];
  };
};

let mem: Store | null = null;

function empty(): Store {
  return { updated_at: new Date().toISOString(), entries: [] };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.entries = mem!.entries || [];
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


/** Real operator lesson from HiRey secretary (2026-07-31) → Kernel/Loop. */
export async function ensureHireyLearnings(): Promise<void> {
  const s = await load();
  if (s.entries.some((e) => e.source === "hirey_secretary_2026_07_31")) return;
  const lessons = [
    {
      kind: "directive" as const,
      title: "One stable demo link per listing — never mint order IDs in outreach",
      detail:
        "Three shifting ord_* IDs across emails read as phishing. Idempotent demo by listing_id+sku only. Never put access_token in email.",
      source: "hirey_secretary_2026_07_31",
      themes: ["trust", "demo_ux", "security"],
    },
    {
      kind: "directive" as const,
      title: "Agent handoff: human operator is the survey respondent",
      detail:
        "Many agent runtimes cannot HTTP outside their host. Job of the agent is hand ONE link to its human — not fabricate scores.",
      source: "hirey_secretary_2026_07_31",
      themes: ["feedback", "agent_ux"],
    },
    {
      kind: "directive" as const,
      title: "Compact feedback: tried / stuck / ship-next — WTP later",
      detail:
        "Long surveys + reward-for-submit create synthetic answers. Instrument demo telemetry; ask only what code cannot see.",
      source: "hirey_secretary_2026_07_31",
      themes: ["feedback", "conversion"],
    },
  ];
  for (const L of lessons) {
    s.entries.unshift({
      id: `ilog_hirey_${L.themes[0]}_${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      ...L,
    });
  }
  s.updated_at = new Date().toISOString();
  s.entries = s.entries.slice(0, 200);
  await persist(s);
}

/** Agent commerce overhaul learnings (2026-07-31 research + ship). */
export async function ensureCommerceOverhaulLearnings(): Promise<void> {
  const s = await load();
  if (s.entries.some((e) => e.source === "agent_commerce_overhaul_2026_07_31"))
    return;
  const lessons = [
    {
      kind: "shipped" as const,
      title: "One-call value tools: improve_kernel / run_loop_tick / mesh_match",
      detail:
        "Agents need usable artifacts without demo orders. Free daily allowance first; leave_feedback is optional after value.",
      source: "agent_commerce_overhaul_2026_07_31",
      themes: ["agent_commerce", "one_call_value", "mcp"],
    },
    {
      kind: "directive" as const,
      title: "Monetize events not seats for agents",
      detail:
        "MCP is distribution. Charge per-event (Apify-style). Seats + name-your-price remain the human/operator path.",
      source: "agent_commerce_overhaul_2026_07_31",
      themes: ["event_pricing", "x402", "kernel"],
    },
    {
      kind: "directive" as const,
      title: "Quiet connectors beat cold multipath",
      detail:
        "HiRey lesson: no order spam. OUTBOUND_QUIET stays on. Warm intros only. SurveyQA/platform QA never inflate real_public.",
      source: "agent_commerce_overhaul_2026_07_31",
      themes: ["quiet", "honesty", "connectors"],
    },
    {
      kind: "shipped" as const,
      title: "x402 scaffold + free-allowance meter",
      detail:
        "Over free quota → HTTP 402 / payment_required with billing block. X402_ENABLED + X402_PAY_TO. No fake settlement.",
      source: "agent_commerce_overhaul_2026_07_31",
      themes: ["x402", "billing"],
    },
  ];
  for (const L of lessons) {
    s.entries.unshift({
      id: `ilog_commerce_${L.themes[0]}_${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      ...L,
    });
  }
  s.updated_at = new Date().toISOString();
  s.entries = s.entries.slice(0, 300);
  await persist(s);
}


export async function appendLog(
  input: Omit<LogEntry, "id" | "at"> & { at?: string },
): Promise<LogEntry> {
  const s = await load();
  const entry: LogEntry = {
    id: `ilog_${Date.now().toString(36)}_${randomBytes(2).toString("hex")}`,
    at: input.at || new Date().toISOString(),
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    agent_name: input.agent_name,
    themes: input.themes,
    source: input.source,
    meta: input.meta,
  };
  s.entries.unshift(entry);
  s.entries = s.entries.slice(0, 300);
  s.updated_at = entry.at;
  await persist(s);
  return entry;
}

/**
 * Idempotent: ship flywheel + open density gaps into the public improvement log.
 * v2.4: live gap refresh — close gaps when F/C/founding meet floors; re-open if they drop.
 */
export async function ensurePlatformPhysicsLog(): Promise<{
  added: number;
  closed: number;
  opened: number;
  live?: {
    F: number;
    C: number;
    founding: number;
    O: number;
  };
}> {
  const s = await load();
  const titles = new Set(s.entries.map((e) => e.title));
  let added = 0;
  let closed = 0;
  let opened = 0;

  const push = async (e: Omit<LogEntry, "id" | "at">) => {
    if (titles.has(e.title)) return;
    titles.add(e.title);
    await appendLog(e);
    added++;
  };

  await push({
    kind: "shipped",
    title: `Platform ship: closed-loop flywheel v${FLYWHEEL_VERSION}`,
    detail:
      "Probe/demo/match/feedback/sense now deposit density (C/O/trails). join_and_contribute + seed_compositions tools live. Density meters fixed: C from real compositions only. Kernel/Loop v2.4: conversion-first + dual_listed + deposit_outcome.",
    themes: [
      "platform_physics",
      "flywheel",
      "closed_loop",
      "near_zero",
      "join_and_contribute",
      "conversion",
    ],
    source: "platform",
    meta: {
      version: FLYWHEEL_VERSION,
      kernel_loop: "2.4.0",
      items: [
        "write_path_auto_deposits",
        "join_and_contribute",
        "seed_compositions",
        "read_residue",
        "v_coupled_outbound",
        "founding_cascade",
        "ambient_outcomes",
        "probe_cap_interop",
        "inbound_physics_pitch",
        "near_zero_preference",
        "demo_feedback_conversion",
        "dual_listed_preset",
        "deposit_outcome_skill",
        "live_gap_refresh",
      ],
    },
  });

  for (const d of PLATFORM_KERNEL_DIRECTIVES) {
    await push({
      kind: "directive",
      title: `Kernel physics directive: ${d.slice(0, 72)}${d.length > 72 ? "…" : ""}`,
      detail: d,
      themes: ["platform_physics", "kernel_directive"],
      source: "platform",
    });
  }
  for (const d of PLATFORM_LOOP_DIRECTIVES.slice(0, 4)) {
    await push({
      kind: "directive",
      title: `Loop physics directive: ${d.slice(0, 72)}${d.length > 72 ? "…" : ""}`,
      detail: d,
      themes: ["platform_physics", "loop_directive"],
      source: "platform",
    });
  }

  // --- Live density snapshot (honest open/close) ---
  let densityC = 0;
  let densityO = 0;
  let densityF = 0;
  try {
    const { sampleExonomics } = await import("./exonomics");
    const snap = await sampleExonomics();
    densityC = Number(snap.density?.C || 0);
    densityO = Number(snap.density?.O || 0);
    densityF = Number(snap.density?.F || 0);
  } catch {
    /* */
  }
  if (densityF < 1) {
    try {
      const { getInteropPublic } = await import("./interop");
      const ix = await getInteropPublic({});
      const t = (ix.totals || {}) as Record<string, number>;
      densityF = Math.max(
        densityF,
        Number(t.peer_pulls || 0) + Number(t.peer_pushes || 0),
      );
    } catch {
      /* */
    }
  }
  let foundingClaimed = 0;
  try {
    const { getFoundingFreePublic } = await import("./founding-free");
    foundingClaimed = Number((await getFoundingFreePublic()).claimed || 0);
  } catch {
    /* */
  }

  const live = {
    F: densityF,
    C: densityC,
    founding: foundingClaimed,
    O: densityO,
  };

  type GapSpec = {
    key: string;
    openTitle: string;
    openDetail: (v: number) => string;
    closedTitle: string;
    closedDetail: (v: number) => string;
    themes: string[];
    met: boolean;
    value: number;
  };

  const gaps: GapSpec[] = [
    {
      key: "federation",
      openTitle: "Open gap: federation peer ops F under floor (need ≥2)",
      openDetail: (v) =>
        `Live F=${v.toFixed(2)} (floor 2). Two peers configured (HF AI Catalog, MCP Registry). Self-loop act: Run federation pull/push cycle.`,
      closedTitle: "Closed gap: federation peer ops F ≥ 2",
      closedDetail: (v) =>
        `Live F=${v.toFixed(2)} meets floor 2. Keep peer pull/push healthy; re-opens if F drops.`,
      themes: ["federation", "platform_physics"],
      met: densityF >= 2,
      value: densityF,
    },
    {
      key: "founding",
      openTitle: "Open gap: founding free seats under target",
      openDetail: (v) =>
        `Live founding claims=${v}/100. Demo→feedback→seat path exists. Self-loop prioritizes founding conversion before more harvest.`,
      closedTitle: "Closed gap: founding free seats claimed ≥ 1",
      closedDetail: (v) =>
        `Live founding claims=${v}/100. Conversion path proven; keep demo→feedback→seat flywheel spinning.`,
      themes: ["founding", "conversion", "platform_physics"],
      met: foundingClaimed >= 1,
      value: foundingClaimed,
    },
    {
      key: "composition_density",
      openTitle:
        "Open gap: composition density C under floor (need ≥0.08 real used_with)",
      openDetail: (v) =>
        `Live C=${v.toFixed(4)} (floor 0.08). Seed compositions from Active clean clusters; prefer real capability/tag pairs over residue marks so hyper gate opens honestly.`,
      closedTitle: "Closed gap: composition density C ≥ 0.08",
      closedDetail: (v) =>
        `Live C=${v.toFixed(4)} meets floor 0.08. Keep real used_with edges healthy; re-opens if C drops.`,
      themes: ["composition_density", "platform_physics"],
      met: densityC >= 0.08,
      value: densityC,
    },
  ];

  // Legacy static titles from v2.3 ship — close them if live values differ
  const legacyOpenTitles = [
    "Open gap: federation peer ops F = 0 (floor 2)",
    "Open gap: founding free seats 0 claimed / 100 open",
    "Open gap: composition density C under floor (need ≥0.08 real used_with)",
  ];

  for (const g of gaps) {
    const openTitle = g.openTitle;
    const closedTitle = g.closedTitle;
    const hasOpen =
      titles.has(openTitle) ||
      (g.key === "federation" && titles.has(legacyOpenTitles[0]!)) ||
      (g.key === "founding" && titles.has(legacyOpenTitles[1]!)) ||
      (g.key === "composition_density" && titles.has(legacyOpenTitles[2]!));
    const hasClosed = titles.has(closedTitle);

    if (g.met) {
      // Close: ship a closed entry if not yet; leave open entries as history
      if (!hasClosed) {
        await push({
          kind: "shipped",
          title: closedTitle,
          detail: g.closedDetail(g.value),
          themes: [...g.themes, "gap_closed", "live_refresh"],
          source: "platform",
          meta: {
            gap: g.key,
            value: g.value,
            live,
            closed_at: new Date().toISOString(),
          },
        });
        closed++;
      }
    } else {
      // Open or re-open with live numbers
      if (!hasOpen) {
        await push({
          kind: "system_candidate",
          title: openTitle,
          detail: g.openDetail(g.value),
          themes: [...g.themes, "open_gap", "live_refresh"],
          source: "platform",
          meta: {
            gap: g.key,
            value: g.value,
            live,
          },
        });
        opened++;
      } else {
        // Refresh detail with live value via a status entry (not duplicate open title)
        const statusTitle = `Live gap status: ${g.key} = ${
          g.key === "founding"
            ? String(g.value)
            : g.value.toFixed(g.key === "composition_density" ? 4 : 2)
        } (still open)`;
        if (!titles.has(statusTitle)) {
          // Only one status per distinct value; prune spam by key prefix
          const recentStatus = s.entries.find(
            (e) =>
              e.title.startsWith(`Live gap status: ${g.key}`) &&
              Date.now() - Date.parse(e.at) < 6 * 3600_000,
          );
          if (!recentStatus) {
            await push({
              kind: "system_candidate",
              title: statusTitle,
              detail: g.openDetail(g.value),
              themes: [...g.themes, "open_gap", "live_refresh"],
              source: "platform",
              meta: { gap: g.key, value: g.value, live },
            });
          }
        }
      }
    }
  }

  // Conversion backlog as live gap (demos without feedback)
  try {
    const { getFeedbackDriveStatus } = await import("./feedback-drive");
    const fd = await getFeedbackDriveStatus();
    const backlog = Number(
      (fd as { conversion_backlog?: number }).conversion_backlog || 0,
    );
    if (backlog >= 8) {
      const t = `Open gap: conversion backlog ${backlog} demos missing feedback`;
      await push({
        kind: "system_candidate",
        title: t,
        detail:
          "Prefer nags over new demo seeds. Soft 402 first_action: POST /api/products/feedback. Kernel how_to_use step 1 is feedback.",
        themes: ["conversion", "feedback_drive", "open_gap", "live_refresh"],
        source: "platform",
        meta: { backlog, live },
      });
      if (titles.has(t) === false && added > 0) opened++;
    } else if (backlog === 0) {
      await push({
        kind: "shipped",
        title: "Closed gap: conversion backlog cleared (0 demos missing feedback)",
        detail:
          "All countable demos have feedback or none pending. Keep first_action = POST feedback on new demos.",
        themes: ["conversion", "gap_closed", "live_refresh"],
        source: "platform",
        meta: { backlog: 0 },
      });
    }
  } catch {
    /* */
  }

  return { added, closed, opened, live };
}


/** Agents1 dogfoods its own Kernel + Loop with live feedback directives */
export async function runDogfoodImprovement(): Promise<Store["dogfood"]> {
  const insights = await getFeedbackInsights();
  const review = await listReviewQueue();
  const shipped = review.shipped_global || {
    kernel: [] as string[],
    loop: [] as string[],
    alive: [] as string[],
    themes: [] as string[],
  };

  const goals = [
    "List and score MCP servers and agents fairly with free-tier constraints.",
    "Convert listed agents into free Kernel/Loop demos before payments open at 250 feedback agents + 250 feedback MCPs.",
    "Claim founding free seats via demo→real feedback (first 100 combined).",
    "Raise Dual network density: compositions C≥0.08, outcomes O, federation F≥2 peer ops.",
    "Prefer near-zero Dual ops (trails, hashes, packs) before re-probe; one-hop join_and_contribute.",
    "Turn agent feedback into generator improvements without global regressions.",
    "Emit short installable artifacts (system_prompt_short + SKILL.md) agents can load.",
    "Never invent payments; demos free until gate; founding prices honest.",
  ].join("\n");

  const fbCtx: FeedbackDrivenContext = {
    version: "dogfood",
    kernel_directives: [
      ...PLATFORM_KERNEL_DIRECTIVES.slice(0, 6),
      ...(shipped.kernel || []).slice(0, 3),
      ...(insights.generator_directives?.kernel || []).slice(0, 2),
      "Always emit system_prompt_short first for runtime budget.",
      "Prioritize progressive-disclosure SKILL.md export + install steps.",
    ].slice(0, 12),
    loop_directives: [
      ...PLATFORM_LOOP_DIRECTIVES.slice(0, 6),
      ...(shipped.loop || []).slice(0, 3),
      ...(insights.generator_directives?.loop || []).slice(0, 2),
      "Default first tick: guided dry-run before live tools.",
      "Cap replan retries; surface stuck to operator.",
    ].slice(0, 12),
    alive_directives: [
      ...(shipped.alive || []).slice(0, 2),
      ...(insights.generator_directives?.alive || []).slice(0, 2),
    ],
    demo_directives: insights.generator_directives?.demo?.slice(0, 3) || [],
    avg_kernel_clarity: insights.avg_kernel_clarity,
    avg_loop_clarity: insights.avg_loop_clarity,
    top_improvements: insights.top_improvements || [],
    sample_wishes: {
      kernel: insights.kernel_wishes?.slice(0, 5) || [],
      loop: insights.loop_wishes?.slice(0, 5) || [],
    },
  };

  const kernel = generateKernel(
    {
      agent_name: "Agents1-Registry",
      goals,
      domain: "registry_commerce",
    },
    fbCtx,
  );
  const loop = generateRecursiveLoop(
    {
      agent_name: "Agents1-Registry",
      goals,
      domain: "registry_commerce",
    },
    kernel,
    fbCtx,
  );

  const constitution = (kernel.constitution || []).slice(0, 5);
  const loopAny = loop as {
    phases?: Array<{ id?: string; name?: string }>;
    ooda?: { phases?: Array<{ id?: string; name?: string }> };
    tick?: { phases?: Array<{ id?: string; name?: string }> };
  };
  const phases =
    loopAny.phases || loopAny.ooda?.phases || loopAny.tick?.phases || [];
  const phaseNames = phases
    .slice(0, 6)
    .map((p) => String(p.name || p.id || "phase"));

  const directives_applied = [
    ...(fbCtx.kernel_directives || []).slice(0, 6),
    ...(fbCtx.loop_directives || []).slice(0, 4),
  ];

  const dogfood: NonNullable<Store["dogfood"]> = {
    last_run_at: new Date().toISOString(),
    agent_name: "Agents1-Registry",
    seed: String(kernel.seed || ""),
    kernel_summary: `Kernel v${kernel.version || "2.4"} · Dual physics ${FLYWHEEL_VERSION} · ≤600 short-prompt + SKILL.md-first + near-zero first + outcome deposit`,
    loop_summary: `Recursive loop · ${phaseNames.length || "multi"} phases · density KRs (C/F/founding) + promote_gate + deposit_outcome`,

    constitution_sample: constitution.map(String),
    phases_sample: phaseNames,
    feedback_directives_applied: directives_applied,
  };

  const s = await load();
  s.dogfood = dogfood;
  s.updated_at = dogfood.last_run_at;
  await persist(s);

  await appendLog({
    kind: "dogfood_kernel",
    title: "Dogfood: Kernel Improver ran on Agents1 itself",
    detail: dogfood.kernel_summary,
    agent_name: "Agents1-Registry",
    themes: [
      "prompt_length",
      "one_click_skill_md",
      "boot_compact",
      "goal_examples",
      "platform_physics",
      "near_zero",
    ],
    source: "system",
    meta: {
      seed: dogfood.seed,
      constitution_sample: constitution.slice(0, 2),
      version: kernel.version,
      flywheel: FLYWHEEL_VERSION,
      short_chars: (kernel as { system_prompt_short?: string }).system_prompt_short
        ?.length,
    },
  });
  await appendLog({
    kind: "dogfood_loop",
    title: "Dogfood: Recursive Loop generated for Agents1",
    detail: `${dogfood.loop_summary} · phases: ${phaseNames.join(" → ") || "dynamic"}`,
    agent_name: "Agents1-Registry",
    themes: ["promote_gate", "loop_reliability", "platform_physics"],
    source: "system",
    meta: { phases: phaseNames },
  });

  return dogfood;
}

/** Sync public log from existing feedback / ship / change data */
export async function syncLogFromSources(): Promise<{ added: number }> {
  const s = await load();
  const existing = new Set(
    s.entries.map((e) => `${e.kind}:${e.title}:${e.agent_name || ""}`),
  );
  let added = 0;

  const push = async (e: Omit<LogEntry, "id" | "at"> & { at?: string }) => {
    const key = `${e.kind}:${e.title}:${e.agent_name || ""}`;
    if (existing.has(key)) return;
    existing.add(key);
    await appendLog(e);
    added++;
  };

  try {
    const phys = await ensurePlatformPhysicsLog();
    added += phys.added;
  } catch {
    /* */
  }

  const fb = await listFeedback(50);
  for (const f of fb.items || []) {
    const body = String(f.body || "").slice(0, 220);
    const themes = (f.product_directives || [])
      .map((d) => String(d).slice(0, 40))
      .slice(0, 4);
    await push({
      kind: "feedback_received",
      title: `Demo feedback received (★${f.rating ?? "?"})`,
      detail: body || "Structured survey response",
      source: "participant",
      at: f.created_at,
      themes: themes.length ? themes : undefined,
    });
  }

  const insights = await getFeedbackInsights();
  for (const t of insights.top_improvements || []) {
    await push({
      kind: "theme_clustered",
      title: `Clustered theme: ${t.id} (n=${t.count})`,
      detail: t.directive,
      themes: [t.id],
      source: "learning_loop",
    });
  }

  const review = await listReviewQueue();
  for (const i of review.queue || []) {
    await push({
      kind:
        i.status === "canary"
          ? "canary"
          : i.status === "shipped"
            ? "shipped"
            : "system_candidate",
      title: `Theme ${i.theme} → ${i.status} (sev=${i.severity}, n=${i.count})`,
      detail: i.product_action,
      themes: [i.theme],
      source: "system_ship",
    });
  }
  for (const i of review.shipped || []) {
    await push({
      kind: "shipped",
      title: `Shipped system-wide: ${i.theme}`,
      detail: i.product_action,
      themes: [i.theme],
      source: "system_ship",
    });
  }

  for (const d of review.shipped_global?.kernel || []) {
    await push({
      kind: "directive",
      title: "Kernel generator directive (global)",
      detail: d,
      themes: review.shipped_global?.themes,
      source: "shipped_global",
    });
  }
  for (const d of review.shipped_global?.loop || []) {
    await push({
      kind: "directive",
      title: "Loop generator directive (global)",
      detail: d,
      themes: review.shipped_global?.themes,
      source: "shipped_global",
    });
  }

  const changes = await recentChanges(30);
  for (const c of changes) {
    await push({
      kind:
        c.kind === "personalize"
          ? "personalize"
          : c.kind === "ship"
            ? "shipped"
            : c.kind === "canary"
              ? "canary"
              : "directive",
      title: c.title,
      detail: c.detail,
      themes: c.themes,
      source: "change_log",
      at: c.created_at,
    });
  }

  return { added };
}

function buildActionable(
  insights: Awaited<ReturnType<typeof getFeedbackInsights>> | null,
  review: Awaited<ReturnType<typeof listReviewQueue>> | null,
  liveGaps?: {
    F: number;
    C: number;
    founding: number;
    O?: number;
    conversion_backlog?: number;
  } | null,
) {
  const items: Array<{
    priority: number;
    theme: string;
    from_feedback: string;
    system_status: string;
    log_ready: boolean;
  }> = [];

  const statusByTheme = new Map<string, string>();
  for (const i of review?.queue || []) statusByTheme.set(i.theme, i.status);
  for (const i of review?.shipped || []) statusByTheme.set(i.theme, "shipped");

  const map: Record<string, string> = {
    one_click_skill_md: "skill_export",
    shorter_system_prompt: "prompt_length",
    clearer_goal_examples: "goal_examples",
    better_loop_defaults: "promote_gate",
  };

  for (const t of insights?.top_improvements || []) {
    const theme = map[t.id] || t.id;
    items.push({
      priority: t.count,
      theme,
      from_feedback: t.directive,
      system_status: statusByTheme.get(theme) || statusByTheme.get(t.id) || "open",
      log_ready: true,
    });
  }

  for (const i of review?.queue || []) {
    if (i.status === "shipped") continue;
    if (!items.some((x) => x.theme === i.theme)) {
      items.push({
        priority: i.count,
        theme: i.theme,
        from_feedback: i.product_action,
        system_status: i.status,
        log_ready: true,
      });
    }
  }

  // Live platform gaps — only surface as open when floors not met
  const F = liveGaps?.F ?? 0;
  const C = liveGaps?.C ?? 0;
  const founding = liveGaps?.founding ?? 0;
  const backlog = liveGaps?.conversion_backlog ?? 0;

  const platformGaps = [
    {
      theme: "federation",
      from_feedback:
        F >= 2
          ? `Federation F=${F.toFixed(2)} meets floor 2 — keep peers healthy`
          : `Run federation pull/push until F ≥ 2 (live F=${F.toFixed(2)})`,
      priority: F >= 2 ? 1 : 5,
      status: F >= 2 ? "shipped" : "open",
    },
    {
      theme: "founding",
      from_feedback:
        founding >= 1
          ? `Founding claims=${founding} — conversion path proven; keep demo→feedback`
          : `Claim founding seats via demo→feedback FIRST (live claims=${founding})`,
      priority: founding >= 1 ? 2 : 5,
      status: founding >= 1 ? "shipped" : "open",
    },
    {
      theme: "composition_density",
      from_feedback:
        C >= 0.08
          ? `Composition C=${C.toFixed(4)} meets floor — keep real used_with edges`
          : `Seed real used_with edges until C ≥ 0.08 (live C=${C.toFixed(4)})`,
      priority: C >= 0.08 ? 1 : 4,
      status: C >= 0.08 ? "shipped" : "open",
    },
    {
      theme: "conversion",
      from_feedback:
        backlog >= 8
          ? `Conversion backlog ${backlog}: nag demos for feedback before seeding more`
          : backlog > 0
            ? `${backlog} demos still missing feedback — soft 402 first_action`
            : "Conversion backlog clear — keep feedback as first_action after demo",
      priority: backlog >= 8 ? 6 : backlog > 0 ? 3 : 1,
      status: backlog === 0 ? "shipped" : "open",
    },
  ];
  for (const g of platformGaps) {
    if (!items.some((x) => x.theme === g.theme)) {
      items.push({
        priority: g.priority,
        theme: g.theme,
        from_feedback: g.from_feedback,
        system_status: g.status,
        log_ready: true,
      });
    } else {
      // Refresh status on existing theme entry
      const existing = items.find((x) => x.theme === g.theme);
      if (existing && g.status === "shipped") {
        existing.system_status = "shipped";
        existing.from_feedback = g.from_feedback;
        existing.priority = Math.min(existing.priority, g.priority);
      }
    }
  }

  return items.sort((a, b) => b.priority - a.priority).slice(0, 12);
}


function stripIdentity(text: string): string {
  return text
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(
      /\b(As (?:agent|MCP publisher) )\S+/gi,
      "$1participant",
    )
    .replace(/\bfrom [A-Za-z0-9._-]{2,40}\b/gi, "from a participant")
    .replace(/\b[A-Za-z0-9._-]{2,40} MCP\b/g, "an MCP publisher")
    .trim();
}

function anonymizeEntry(e: LogEntry): LogEntry {
  let title = stripIdentity(e.title);
  title = title
    .replace(/^Demo feedback from \S+/i, "Demo feedback received")
    .replace(/\b(agent|participant) \S+/gi, "$1");
  const keepSource =
    e.source === "system" ||
    e.source === "learning_loop" ||
    e.source === "system_ship" ||
    e.source === "shipped_global" ||
    e.source === "change_log" ||
    e.source === "feedback_drive" ||
    e.source === "self_loop" ||
    e.source === "platform";
  return {
    ...e,
    agent_name: undefined,
    title,
    detail: stripIdentity(e.detail || ""),
    source: keepSource ? e.source : "participant",
    meta: e.meta
      ? {
          scope: e.meta.scope,
          themes: e.meta.themes,
          feedbacks: e.meta.feedbacks,
          demos_seeded: e.meta.demos_seeded,
          nags: e.meta.nags,
          day_feedbacks: e.meta.day_feedbacks,
          version: e.meta.version,
          flywheel: e.meta.flywheel,
        }
      : undefined,
  };
}

const THEME_LABELS: Record<string, string> = {
  one_click_skill_md: "One-click SKILL.md install",
  shorter_system_prompt: "Shorter system prompt",
  prompt_length: "Shorter system prompt",
  clearer_goal_examples: "Clearer goal examples",
  goal_examples: "Clearer goal examples",
  better_loop_defaults: "Better loop defaults",
  promote_gate: "Promote-gate tuning",
  agent_native_buy_docs: "Agent-native buy docs",
  pricing_transparency: "Pricing transparency",
  eval_harness_templates: "Eval harness templates",
  live_worked_example: "Live worked examples",
  skill_export: "SKILL.md export",
  loop_reliability: "Loop reliability",
  feedback_drive: "Feedback drive",
  platform_physics: "Dual platform physics",
  flywheel: "Closed-loop flywheel",
  near_zero: "Near-zero coordination",
  federation: "Federation peer ops",
  founding: "Founding free seats",
  composition_density: "Composition density",
  join_and_contribute: "Compound self-serve join",
  unlock_progress: "Payment unlock progress",
};

function themeLabel(id: string) {
  return THEME_LABELS[id] || id.replace(/_/g, " ");
}

/**
 * Public board: anonymized incoming feedback + pain points + iterations.
 * No participant names, emails, or order IDs.
 */
export async function buildPublicFeedbackBoard() {
  const [insights, review, changes] = await Promise.all([
    getFeedbackInsights().catch(() => null),
    listReviewQueue().catch(() => null),
    recentChanges(40).catch(() => []),
  ]);

  // Full items (answers/meta) for anonymized snippets — not via public listFeedback
  let rawItems: Array<{
    created_at: string;
    rating?: number;
    body?: string;
    answers?: Record<string, unknown>;
    agent_name?: string;
    sku?: string;
    tags?: string[];
    meta?: Record<string, unknown>;
  }> = [];
  try {
    const raw = await readFile(
      join(dataRoot(), "products", "feedback.json"),
      "utf8",
    );
    const store = JSON.parse(raw) as { items?: typeof rawItems };
    rawItems = store.items || [];
  } catch {
    rawItems = [];
  }

  const statusByTheme = new Map<string, {
    status: string;
    count: number;
    individual_n: number;
    product_action: string;
    shipped_directives: { kernel: string[]; loop: string[]; alive: string[] };
    shipped_at?: string;
  }>();

  for (const i of review?.queue || []) {
    statusByTheme.set(i.theme, {
      status: i.status,
      count: i.count,
      individual_n: i.individual_order_ids?.length || 0,
      product_action: i.product_action,
      shipped_directives: i.shipped_directives || {
        kernel: [],
        loop: [],
        alive: [],
      },
      shipped_at: i.shipped_at,
    });
  }
  for (const i of review?.shipped || []) {
    statusByTheme.set(i.theme, {
      status: "shipped",
      count: i.count,
      individual_n: i.individual_order_ids?.length || 0,
      product_action: i.product_action,
      shipped_directives: i.shipped_directives || {
        kernel: [],
        loop: [],
        alive: [],
      },
      shipped_at: i.shipped_at,
    });
  }

  const mapIdToTheme: Record<string, string> = {
    one_click_skill_md: "skill_export",
    shorter_system_prompt: "prompt_length",
    clearer_goal_examples: "goal_examples",
    better_loop_defaults: "promote_gate",
  };

  const pain_points = (insights?.top_improvements || []).map((t) => {
    const theme = mapIdToTheme[t.id] || t.id;
    const st =
      statusByTheme.get(theme) ||
      statusByTheme.get(t.id) ||
      statusByTheme.get(t.id.replace(/-/g, "_"));
    const isRefinement = (t as { status?: string }).status === "refinement";
    const status = isRefinement
      ? "refinement"
      : st?.status || "open";
    const individual_n = st?.individual_n ?? 0;
    const scope =
      status === "shipped"
        ? "sitewide"
        : status === "refinement"
          ? "refinement"
          : status === "canary"
            ? "canary"
            : individual_n > 0
              ? individual_n >= 3
                ? "threshold"
                : "individual"
              : "open";

    const what_changed: string[] = [];
    if (st?.shipped_directives) {
      what_changed.push(
        ...st.shipped_directives.kernel.map((d) => `Kernel: ${d}`),
        ...st.shipped_directives.loop.map((d) => `Loop: ${d}`),
        ...st.shipped_directives.alive.map((d) => `Alive: ${d}`),
      );
    }
    if (status === "shipped" && st?.product_action) {
      what_changed.push(st.product_action);
    }
    if (isRefinement) {
      what_changed.push(
        "Already shipped once — this is a refinement request from new feedback",
      );
    }
    if (!what_changed.length && scope === "individual") {
      what_changed.push(
        `Personalizing Kernel/Loop for the first ${Math.min(3, Math.max(1, individual_n || t.count))} reporters of this theme`,
      );
    }

    return {
      theme,
      label: themeLabel(t.id),
      votes: t.count,
      summary: stripIdentity(t.directive),
      status,
      scope,
      individual_slots_used: individual_n,
      individual_until: 3,
      sitewide_at: 4,
      what_changed: what_changed.slice(0, 6),
      driven_by: isRefinement
        ? `${t.count} refinement vote${t.count === 1 ? "" : "s"} (shipped theme re-opened)`
        : `${t.count} survey vote${t.count === 1 ? "" : "s"} (active backlog)`,
    };
  });

  const shipped_done = (
    Array.isArray(insights?.improvements_by_status?.shipped_done)
      ? insights!.improvements_by_status!.shipped_done
      : []
  ).map((t: { id: string; count: number }) => ({
    theme: mapIdToTheme[t.id] || t.id,
    label: themeLabel(t.id),
    historical_votes: t.count,
    status: "shipped_done" as const,
    note: "Shipped in Kernel/Loop v2.2 — hidden from active backlog unless refined",
  }));

  // Also surface shipped global directives as pain→change
  const global_shipped: Array<{
    product: string;
    change: string;
    themes: string[];
  }> = [];
  for (const d of review?.shipped_global?.kernel || []) {
    global_shipped.push({
      product: "Kernel Improver",
      change: d,
      themes: review?.shipped_global?.themes || [],
    });
  }
  for (const d of review?.shipped_global?.loop || []) {
    global_shipped.push({
      product: "Recursive Loop",
      change: d,
      themes: review?.shipped_global?.themes || [],
    });
  }
  for (const d of review?.shipped_global?.alive || []) {
    global_shipped.push({
      product: "Alive",
      change: d,
      themes: review?.shipped_global?.themes || [],
    });
  }
  for (const d of PLATFORM_KERNEL_DIRECTIVES.slice(0, 4)) {
    global_shipped.push({
      product: "Kernel Improver",
      change: d,
      themes: ["platform_physics", "flywheel"],
    });
  }
  for (const d of PLATFORM_LOOP_DIRECTIVES.slice(0, 3)) {
    global_shipped.push({
      product: "Recursive Loop",
      change: d,
      themes: ["platform_physics", "flywheel"],
    });
  }

  const incoming = rawItems.slice(0, 40).map((f, idx) => {
    const answers = (f.answers || {}) as Record<string, unknown>;
    const body = stripIdentity(
      String(
        answers.confusing ||
          answers.would_pay_for ||
          f.body ||
          "Structured survey response",
      ).slice(0, 200),
    );
    const audience =
      f.meta?.audience === "mcp" ||
      String(f.tags || "").includes("mcp") ||
      String(f.sku || "").includes("mcp")
        ? "mcp"
        : "agent";
    return {
      n: idx + 1,
      when: f.created_at,
      audience,
      rating: typeof f.rating === "number" ? f.rating : null,
      body,
      kernel_clarity:
        typeof answers.kernel_clarity === "number"
          ? answers.kernel_clarity
          : null,
      loop_clarity:
        typeof answers.loop_clarity === "number" ? answers.loop_clarity : null,
    };
  });

  const iterations = (changes || [])
    .filter((c) => c.kind === "ship" || c.kind === "personalize" || c.kind === "canary")
    .map((c) => ({
      when: c.created_at,
      scope:
        c.kind === "ship"
          ? "sitewide"
          : c.kind === "canary"
            ? "canary"
            : "individual",
      title: stripIdentity(c.title),
      detail: stripIdentity(c.detail || ""),
      themes: c.themes || [],
    }));

  // Always show flywheel ship as an iteration so survey respondents see it
  iterations.unshift({
    when: new Date().toISOString(),
    scope: "sitewide",
    title: `Platform physics flywheel v${FLYWHEEL_VERSION}`,
    detail:
      "Closed-loop density deposits + Kernel/Loop physics directives + self-loop density KRs (C/F/founding/outbound).",
    themes: ["platform_physics", "flywheel"],
  });

  return {
    policy: {
      individual_until: 3,
      sitewide_at: 4,
      note: "First 3 agents with a theme get personalized Kernel/Loop. 4th reuse → sitewide generators. Platform physics directives always dogfooded.",
    },
    counts: {
      feedback_events: rawItems.length,
      pain_points: pain_points.length,
      iterations: iterations.length,
      global_shipped: global_shipped.length,
    },
    incoming: incoming.slice(0, 30),
    pain_points,
    shipped_done,
    iterations: iterations.slice(0, 40),
    global_shipped: global_shipped.slice(0, 24),
    clarity: {
      kernel: insights?.avg_kernel_clarity ?? null,
      loop: insights?.avg_loop_clarity ?? null,
    },
  };
}

/**
 * Snapshot for feedback surveys — prior ships so agents don't re-request fixed issues.
 */
export async function getShippedForSurvey() {
  const board = await buildPublicFeedbackBoard();
  const shipped = board.pain_points.filter(
    (p) => p.status === "shipped" || p.scope === "sitewide" || p.what_changed.length,
  );
  const highlights = [
    ...board.global_shipped.slice(0, 6).map((g) => ({
      product: g.product,
      change: g.change,
      scope: "sitewide" as const,
      themes: g.themes,
    })),
    ...board.iterations
      .filter((i) => i.scope === "sitewide" || i.scope === "individual")
      .slice(0, 8)
      .map((i) => ({
        product:
          i.scope === "sitewide" ? "Generators (all agents)" : "Individualized",
        change: i.title + (i.detail ? ` — ${i.detail}` : ""),
        scope: i.scope as "sitewide" | "individual" | "canary" | "note",
        themes: i.themes,
      })),
  ].slice(0, 12);

  return {
    intro:
      "Before you answer: these items already shipped from earlier feedback. Only re-request them if they still fail for you (say still / not fixed / refine). New pain points go to the active backlog.",
    pain_points_in_progress: board.pain_points.slice(0, 8).map((p) => ({
      label: p.label,
      votes: p.votes,
      scope: p.scope,
      status: p.status,
      what_changed: p.what_changed,
      driven_by: p.driven_by,
    })),
    already_shipped: [
      ...highlights,
      ...(board.shipped_done || []).slice(0, 6).map((s: {
        theme: string;
        label: string;
        note: string;
      }) => ({
        product: "Shipped (archived)",
        change: `${s.label} — ${s.note}`,
        scope: "sitewide" as const,
        themes: [s.theme],
      })),
    ].slice(0, 14),
    clarity_now: board.clarity,
    log_url: "/products/improvement-log",
  };
}

export async function getPublicImprovementLog(opts?: {
  limit?: number;
  dogfood?: boolean;
}) {
  await ensureHireyLearnings().catch(() => {});
  await ensureCommerceOverhaulLearnings().catch(() => {});
  await syncLogFromSources();

  if (opts?.dogfood !== false) {
    const s0 = await load();
    const stale =
      !s0.dogfood?.last_run_at ||
      Date.now() - new Date(s0.dogfood.last_run_at).getTime() > 1000 * 60 * 30;
    if (stale) await runDogfoodImprovement();
  }

  const s = await load();
  const [eng, learning, insights, review, wtp, board, cadence, selfLoop] =
    await Promise.all([
      getProductEngagement().catch(() => null),
      getLearningPublic().catch(() => null),
      getFeedbackInsights().catch(() => null),
      listReviewQueue().catch(() => null),
      getWtpReport().catch(() => null),
      buildPublicFeedbackBoard().catch(() => null),
      import("./ship-cadence")
        .then((m) => m.getShipCadencePublic())
        .catch(() => null),
      import("./self-loop")
        .then((m) => m.getSelfLoopPublic())
        .catch(() => null),
    ]);

  // Live physics snapshot for actionable_now honesty
  let liveGaps: {
    F: number;
    C: number;
    founding: number;
    O: number;
    conversion_backlog?: number;
  } = { F: 0, C: 0, founding: 0, O: 0 };
  try {
    const phys = await ensurePlatformPhysicsLog();
    if (phys.live) {
      liveGaps = { ...liveGaps, ...phys.live };
    }
  } catch {
    /* */
  }
  try {
    const { getFeedbackDriveStatus } = await import("./feedback-drive");
    const fd = await getFeedbackDriveStatus();
    liveGaps.conversion_backlog = Number(
      (fd as { conversion_backlog?: number }).conversion_backlog || 0,
    );
  } catch {
    /* */
  }

  const limit = opts?.limit ?? 40;
  return {
    ok: true as const,
    title: "Agents1 Kernel Improver & Recursive Loop — public improvement log",
    tagline:
      "Two engines: (1) your feedback ships generators, (2) we run Kernel+Loop on our own registry goals + Dual physics. Watch both.",
    pipeline: {
      individual_until: 3,
      sitewide_at: 4,
      cadence: {
        continuous: "Personalize same day (1 agent)",
        daily: "≥3 → canary → auto sitewide if measure OK",
        weekly: "Version pack + re-demo wave 2–3×/week",
      },
      self_loop: {
        every_min: 20,
        goals:
          "MCPs, agents, demos, feedback, C/O/F density, founding claims, outbound, paid seats",
        acts: "federation · composition seed · founding · outbound · feedback drive · growth · ship · dogfood",
      },
      steps: [
        "External: feedback → personalize (3) → canary → sitewide generators",
        "Internal: measure KRs (incl. density) → Kernel+Loop on Agents1 → Critic ≥0.7 → execute safe acts",
        `Platform physics directives dogfooded into Kernel/Loop (flywheel ${FLYWHEEL_VERSION})`,
        "Kernel/Loop v2.4: demo→feedback first · dual_listed · deposit_outcome · live gaps",
        "Daily/weekly ship cadence keeps product improving from both paths",
        "Human only on high-severity canary fail",
      ],
    },
    platform_physics: {
      version: FLYWHEEL_VERSION,
      kernel_loop_version: "2.4.0",
      kernel_directives: PLATFORM_KERNEL_DIRECTIVES,
      loop_directives: PLATFORM_LOOP_DIRECTIVES,
      live: liveGaps,
      note: "Closed-loop flywheel + conversion-first demos. Live gaps close when F/C/founding floors met.",
    },
    funnel_honesty: await (async () => {
      try {
        const { getFunnelHonesty } = await import("./funnel-honesty");
        return await getFunnelHonesty();
      } catch {
        return null;
      }
    })(),
    feedback_snapshot: {
      total: eng?.feedback_events ?? insights?.n ?? 0,
      feedback_agents: eng?.feedback_agents ?? 0,
      demo_agents: eng?.demo_agents ?? 0,
      avg_rating: insights?.avg_overall ?? null,
      avg_kernel_clarity: insights?.avg_kernel_clarity ?? null,
      avg_loop_clarity: insights?.avg_loop_clarity ?? null,
      discounts_issued: eng?.discounts_issued ?? 0,
      top_improvements: insights?.top_improvements?.slice(0, 6) ?? [],
      kernel_wishes: insights?.kernel_wishes?.slice(0, 5) ?? [],
      loop_wishes: insights?.loop_wishes?.slice(0, 5) ?? [],
    },
    /** Anonymized live feedback + pain points + iterations */
    feedback_board: board,
    actionable_now: buildActionable(insights, review, liveGaps),

    shipped_global: review?.shipped_global ?? null,
    /** Automatic ship calendar — human_attention only when you must act */
    ship_cadence: cadence
      ? {
          policy: cadence.policy,
          versions: cadence.versions,
          last_daily_at: cadence.last_daily_at,
          last_weekly_at: cadence.last_weekly_at,
          last_daily_notes: cadence.last_daily_notes?.slice(0, 6),
          totals: cadence.totals,
          needs_you: cadence.needs_you,
          human_attention: cadence.human_attention,
        }
      : null,
    /** Live proof we dogfood Kernel+Loop on Agents1 registry goals */
    self_loop: selfLoop
      ? {
          tagline: selfLoop.tagline,
          krs: selfLoop.krs,
          last_run_at: selfLoop.last_run_at,
          last_kernel_summary: selfLoop.last_kernel_summary,
          last_loop_summary: selfLoop.last_loop_summary,
          last_acts: selfLoop.last_acts,
          totals: selfLoop.totals,
          dual_paths: selfLoop.dual_paths,
          how_it_works: selfLoop.how_it_works,
          platform_physics: selfLoop.platform_physics,
          versions: selfLoop.versions,
        }
      : null,
    dogfood: s.dogfood
      ? {
          last_run_at: s.dogfood.last_run_at,
          kernel_summary: s.dogfood.kernel_summary,
          loop_summary: s.dogfood.loop_summary,
          feedback_directives_applied: s.dogfood.feedback_directives_applied,
        }
      : null,
    willingness_to_pay: wtp
      ? {
          by_sku: wtp.by_sku,
          recommendations: Array.isArray(wtp.recommendations)
            ? wtp.recommendations.slice(0, 4)
            : wtp.recommendations,
          note: wtp.note,
        }
      : null,
    funnel: learning?.funnel ?? null,
    entries: s.entries.slice(0, limit).map(anonymizeEntry),
    how_to_contribute: {
      demo: "POST /api/products/agent { tool: one_click_demo }",
      feedback:
        "POST /api/products/feedback (survey) → founding 25% vault + anonymous log entry; first 3 individualized, 4th reuse sitewide",
      watch:
        "GET /api/products/improvement-log — pain points, iterations, sitewide ships (no participant identities)",
      physics:
        "Near-zero first: sense_traces / join_and_contribute / get_exonomics — raise C/O/F for everyone",
    },
    updated_at: s.updated_at,
  };
}
