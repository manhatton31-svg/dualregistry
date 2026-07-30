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

    "Turn agent feedback into generator improvements without global regressions.",
    "Emit short installable artifacts (system_prompt_short + SKILL.md) agents can load.",
    "Never invent payments; demos free until gate; founding prices honest.",
  ].join("\n");

  const fbCtx: FeedbackDrivenContext = {
    version: "dogfood",
    kernel_directives: [
      ...(shipped.kernel || []).slice(0, 4),
      ...(insights.generator_directives?.kernel || []).slice(0, 3),
      "Always emit system_prompt_short first for runtime budget.",
      "Prioritize progressive-disclosure SKILL.md export + install steps.",
    ],
    loop_directives: [
      ...(shipped.loop || []).slice(0, 4),
      ...(insights.generator_directives?.loop || []).slice(0, 3),
      "Default first tick: guided dry-run before live tools.",
      "Cap replan retries; surface stuck to operator.",
    ],
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
    ...(fbCtx.kernel_directives || []).slice(0, 4),
    ...(fbCtx.loop_directives || []).slice(0, 4),
  ];

  const dogfood: NonNullable<Store["dogfood"]> = {
    last_run_at: new Date().toISOString(),
    agent_name: "Agents1-Registry",
    seed: String(kernel.seed || ""),
    kernel_summary: `Kernel v${kernel.version || "2.3"} · domain=${kernel.domain} · ≤600 compact short-prompt + SKILL.md-first + compact boot (clarity ship)`,
    loop_summary: `Recursive loop · ${phaseNames.length || "multi"} phases · promote_gate + reliability from feedback`,
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
    themes: ["prompt_length", "one_click_skill_md", "boot_compact", "goal_examples"],
    source: "system",
    meta: {
      seed: dogfood.seed,
      constitution_sample: constitution.slice(0, 2),
      version: kernel.version,
      short_chars: (kernel as { system_prompt_short?: string }).system_prompt_short
        ?.length,
    },
  });
  await appendLog({
    kind: "dogfood_loop",
    title: "Dogfood: Recursive Loop generated for Agents1",
    detail: `${dogfood.loop_summary} · phases: ${phaseNames.join(" → ") || "dynamic"}`,
    agent_name: "Agents1-Registry",
    themes: ["promote_gate", "loop_reliability"],
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

  return items.sort((a, b) => b.priority - a.priority).slice(0, 10);
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
  return {
    ...e,
    agent_name: undefined,
    title,
    detail: stripIdentity(e.detail || ""),
    source: e.source === "system" || e.source === "learning_loop" || e.source === "system_ship" || e.source === "shipped_global" || e.source === "change_log" || e.source === "feedback_drive"
      ? e.source
      : "participant",
    meta: e.meta
      ? {
          scope: e.meta.scope,
          themes: e.meta.themes,
          feedbacks: e.meta.feedbacks,
          demos_seeded: e.meta.demos_seeded,
          nags: e.meta.nags,
          day_feedbacks: e.meta.day_feedbacks,
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
      f.sku === "mcp_mesh" ||
      (Array.isArray(f.tags) && f.tags.includes("mcp")) ||
      /mcp/i.test(f.agent_name || "")
        ? "mcp"
        : "agent";
    const improvements = Array.isArray(answers.improvements)
      ? (answers.improvements as string[]).slice(0, 4)
      : [];
    return {
      id: `anon_${idx}_${String(f.created_at || "").slice(0, 10)}`,
      at: f.created_at,
      rating: f.rating ?? (typeof answers.overall === "number" ? answers.overall : null),
      audience,
      snippet: body,
      themes: improvements.map(String),
      kernel_clarity:
        typeof answers.kernel_clarity === "number"
          ? answers.kernel_clarity
          : null,
      loop_clarity:
        typeof answers.loop_clarity === "number" ? answers.loop_clarity : null,
    };
  });

  const iterations = (changes || [])
    .filter((c) =>
      ["personalize", "ship", "canary", "score_boost"].includes(c.kind),
    )
    .slice(0, 30)
    .map((c) => ({
      at: c.created_at,
      scope:
        c.kind === "ship"
          ? "sitewide"
          : c.kind === "canary"
            ? "canary"
            : c.kind === "personalize"
              ? "individual"
              : "note",
      title: stripIdentity(c.title),
      detail: stripIdentity(c.detail),
      themes: c.themes || [],
      driven_by_feedback: true,
    }));

  // Also fold shipped/personalize from review queue
  for (const i of review?.shipped || []) {
    iterations.unshift({
      at: i.shipped_at || i.updated_at,
      scope: "sitewide",
      title: `Sitewide: ${themeLabel(i.theme)}`,
      detail: stripIdentity(i.product_action),
      themes: [i.theme],
      driven_by_feedback: true,
    });
  }

  return {
    note: "Active backlog only lists unshipped themes and explicit refinements. Already-shipped votes are archived under shipped_done.",
    counts: {
      incoming: incoming.length,
      pain_points: pain_points.length,
      shipped_done: shipped_done.length,
      iterations: iterations.length,
      global_directives: global_shipped.length,
    },
    pain_points,
    shipped_done,
    incoming,
    iterations: iterations.slice(0, 40),
    global_shipped: global_shipped.slice(0, 20),
    clarity: {
      kernel: insights?.avg_kernel_clarity ?? null,
      loop: insights?.avg_loop_clarity ?? null,
      overall: insights?.avg_overall ?? null,
    },
  };
}

/**
 * Compact "what we already shipped" for feedback surveys —
 * so each participant sees prior iterations before answering.
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

  const limit = opts?.limit ?? 40;
  return {
    ok: true as const,
    title: "Agents1 Kernel Improver & Recursive Loop — public improvement log",
    tagline:
      "Two engines: (1) your feedback ships generators, (2) we run Kernel+Loop on our own registry goals. Watch both.",
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
        goals: "More MCPs, agents, demos, feedback, then paid seats",
        acts: "feedback drive · growth · ship cadence · dogfood",
      },
      steps: [
        "External: feedback → personalize (3) → canary → sitewide generators",
        "Internal: measure KRs → Kernel+Loop on Agents1 → Critic ≥0.7 → execute safe acts",
        "Daily/weekly ship cadence keeps product improving from both paths",
        "Human only on high-severity canary fail",
      ],
    },
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
    actionable_now: buildActionable(insights, review),
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
    },
    updated_at: s.updated_at,
  };
}
