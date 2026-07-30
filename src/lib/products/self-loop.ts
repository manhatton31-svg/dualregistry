/**
 * Agents1 self-improving Kernel + Recursive Loop.
 *
 * Dual path with external feedback ships:
 *   External: agent/MCP surveys → themes → generators
 *   Internal: OUR goals → Kernel Improver + Recursive Loop → safe operational acts
 *
 * Goals: more MCPs, more agents, more demos, more feedback (250/250 unlock),
 * then paid seats — publicly logged so fence-sitters see the system work on itself.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  generateKernel,
  generateRecursiveLoop,
  ALIVE_VERSION,
  KERNEL_VERSION,
  LOOP_VERSION,
  type FeedbackDrivenContext,
} from "./generate";

const PATH = join(process.cwd(), "data", "products", "self-loop.json");
const MIN_GAP_MS = 20 * 60 * 1000;

export type SelfKR = {
  id: string;
  title: string;
  target: number;
  current: number;
  unit: string;
  progress: number;
  weight?: number;
};

export type SelfAct = {
  id: string;
  title: string;
  rationale: string;
  expected_kr: string[];
  risk: "low" | "medium" | "high";
  status: "proposed" | "promoted" | "executed" | "blocked";
  critic_score: number;
  result?: string;
};

export type SelfLoopState = {
  updated_at: string;
  last_run_at?: string;
  cycles: number;
  goals: string[];
  krs: SelfKR[];
  last_kernel_summary?: string;
  last_loop_summary?: string;
  last_acts: SelfAct[];
  history: Array<{
    at: string;
    krs: SelfKR[];
    acts_executed: string[];
    critic_avg: number;
  }>;
  totals: {
    runs: number;
    acts_executed: number;
    demos_boosted: number;
    feedback_boosted: number;
    ships_triggered: number;
  };
};

let mem: SelfLoopState | null = null;
let running = false;

const GOALS = [
  "Grow the Agents1 MCP registry with checks-clean listings (unlimited, zero dupes).",
  "Grow the Agents1 agent registry with checks-clean listings (unlimited, zero dupes).",
  "Convert listed MCPs and agents into free product demos (unlimited demos; Kernel, Loop, Alive, Mesh).",
  "Collect structured feedback from demos — 250 agent + 250 MCP before payments open.",
  "Ship Kernel/Loop/Mesh improvements from feedback without global regressions.",
  "After unlock: convert feedbackers to paid seats (founding prices first 1000; each next price level lasts 1000 seats so feedback from demos + purchases can show; unlimited paid). Measure buy-likelihood as price steps up. Until unlock maximize WTP and founding intent.",
  "Show fence-sitters a live self-improving system dogfooding its own products.",
];

function empty(): SelfLoopState {
  return {
    updated_at: new Date().toISOString(),
    cycles: 0,
    goals: GOALS,
    krs: [],
    last_acts: [],
    history: [],
    totals: {
      runs: 0,
      acts_executed: 0,
      demos_boosted: 0,
      feedback_boosted: 0,
      ships_triggered: 0,
    },
  };
}

async function load(): Promise<SelfLoopState> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.totals = { ...empty().totals, ...(mem!.totals || {}) };
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: SelfLoopState) {
  mem = s;
  s.updated_at = new Date().toISOString();
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

function progress(current: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(1, Math.round((current / target) * 1000) / 1000);
}

async function measureKRs(): Promise<SelfKR[]> {
  const krs: SelfKR[] = [];
  let mcp = 0;
  let agents = 0;
  try {
    const { loadStoreCache } = await import("@/lib/agents1/store-cache");
    const c = await loadStoreCache();
    const any = c as {
      milestones?: { mcp?: { approved?: number }; agents?: { approved?: number } };
      mcp_items?: unknown[];
      agent_items?: unknown[];
    };
    mcp = any.milestones?.mcp?.approved ?? any.mcp_items?.length ?? 0;
    agents = any.milestones?.agents?.approved ?? any.agent_items?.length ?? 0;
  } catch {
    /* */
  }

  let demoAgents = 0;
  let demoMcps = 0;
  let fbAgents = 0;
  let fbMcps = 0;
  let discounts = 0;
  try {
    const { getProductEngagement } = await import("./engagement");
    const pe = await getProductEngagement();
    demoAgents = pe.demo_agent_only ?? 0;
    demoMcps = pe.demo_mcps ?? 0;
    fbAgents = pe.feedback_agent_only ?? pe.feedback_agents ?? 0;
    fbMcps = pe.feedback_mcps ?? 0;
    discounts = pe.discounts_issued ?? 0;
    mcp = Math.max(mcp, pe.mcp_approved || 0);
    agents = Math.max(agents, pe.agents_approved || 0);
  } catch {
    /* */
  }

  let paid = 0;
  try {
    const { countPaidSeats } = await import("./orders");
    paid = await countPaidSeats();
  } catch {
    /* */
  }

  // Listings + demos unlimited — KR tracks absolute growth (no artificial /500)
  const demos = demoAgents + demoMcps;
  krs.push({
    id: "mcp_listed",
    title: "MCPs listed (unlimited, zero dupes)",
    target: Math.max(mcp, 1), // self-baseline; progress vs prior high-water via history
    current: mcp,
    unit: "mcps",
    progress: 1, // no cap
  });
  krs.push({
    id: "agents_listed",
    title: "Agents listed (unlimited, zero dupes)",
    target: Math.max(agents, 1),
    current: agents,
    unit: "agents",
    progress: 1,
  });
  krs.push({
    id: "demos_taken",
    title: "Product demos taken (volume only — not success KR)",
    target: Math.max(demos, 1),
    current: demos,
    unit: "demos",
    progress: 1,
    weight: 0.25,
  });
  krs.push({
    id: "feedback_agents",
    title: "Agent REAL feedback toward unlock (primary KR)",
    target: 250,
    current: fbAgents,
    unit: "agents",
    progress: progress(fbAgents, 250),
    weight: 3,
  });
  krs.push({
    id: "feedback_mcps",
    title: "MCP REAL feedback toward unlock (primary KR)",
    target: 250,
    current: fbMcps,
    unit: "mcps",
    progress: progress(fbMcps, 250),
    weight: 3,
  });
  krs.push({
    id: "founding_intent",
    title: "Discounts vaulted (founding intent)",
    target: 1000, // align with founding seat cohort size
    current: discounts,
    unit: "codes",
    progress: progress(discounts, 1000),
  });
  krs.push({
    id: "paid_seats",
    title: "Paid seats (unlimited; 1000-seat price bands)",
    target: 1000, // founding cohort size as first milestone only
    current: paid,
    unit: "seats",
    progress: progress(paid, 1000),
  });
  return krs;
}

function proposeActs(krs: SelfKR[]): SelfAct[] {
  const by = Object.fromEntries(krs.map((k) => [k.id, k]));
  const acts: SelfAct[] = [];
  const now = Date.now().toString(36);
  const fbM = by.feedback_mcps;
  const fbA = by.feedback_agents;
  const demos = by.demos_taken;
  const mcp = by.mcp_listed;
  const ag = by.agents_listed;

  if (fbM && fbM.progress < 0.5) {
    acts.push({
      id: `act_${now}_mcp_fb`,
      title: "Boost MCP demo + feedback drive",
      rationale: `MCP feedback ${fbM.current}/${fbM.target} (${Math.round(fbM.progress * 100)}%) — lagging unlock half.`,
      expected_kr: ["feedback_mcps", "demos_taken"],
      risk: "low",
      status: "proposed",
      critic_score: 0,
    });
  }
  if (fbA && fbA.progress < 0.5) {
    acts.push({
      id: `act_${now}_agent_fb`,
      title: "Boost agent demo + feedback drive",
      rationale: `Agent feedback ${fbA.current}/${fbA.target} — keep unlock path hot.`,
      expected_kr: ["feedback_agents", "demos_taken"],
      risk: "low",
      status: "proposed",
      critic_score: 0,
    });
  }
  if (demos && demos.progress < 0.9) {
    acts.push({
      id: `act_${now}_demos`,
      title: "Seed more free demos for listed registry participants",
      rationale: "Demos are the prerequisite for honest feedback; keep funnel topped.",
      expected_kr: ["demos_taken"],
      risk: "low",
      status: "proposed",
      critic_score: 0,
    });
  }
  if ((mcp && mcp.progress < 0.7) || (ag && ag.progress < 0.7)) {
    acts.push({
      id: `act_${now}_growth`,
      title: "Run registry growth cycle (harvest + probe + list)",
      rationale: `Listings MCP ${mcp?.current ?? "?"} · Agents ${ag?.current ?? "?"} (unlimited, zero dupes) — more surface for demos.`,
      expected_kr: ["mcp_listed", "agents_listed"],
      risk: "low",
      status: "proposed",
      critic_score: 0,
    });
  }
  acts.push({
    id: `act_${now}_ship`,
    title: "Run ship cadence (canary → sitewide → generators)",
    rationale:
      "Kernel/Loop improve from clustered feedback; fence-sitters see public log.",
    expected_kr: ["feedback_agents", "feedback_mcps", "founding_intent"],
    risk: "medium",
    status: "proposed",
    critic_score: 0,
  });
  acts.push({
    id: `act_${now}_dogfood`,
    title: "Dogfood Kernel + Loop on Agents1 goals",
    rationale:
      "Prove combined system: regenerate our own kernel/loop with live directives.",
    expected_kr: ["founding_intent"],
    risk: "low",
    status: "proposed",
    critic_score: 0,
  });
  return acts.slice(0, 6);
}

function criticScore(act: SelfAct, krs: SelfKR[]): number {
  let s = 0.55;
  if (act.risk === "low") s += 0.2;
  if (act.risk === "high") s -= 0.25;
  for (const id of act.expected_kr) {
    const k = krs.find((x) => x.id === id);
    if (k && k.progress < 0.4) s += 0.12;
    else if (k && k.progress < 0.7) s += 0.05;
  }
  if (/growth|demo|feedback|dogfood/i.test(act.title)) s += 0.05;
  return Math.min(0.98, Math.max(0.1, Math.round(s * 100) / 100));
}

async function executeAct(act: SelfAct, state: SelfLoopState): Promise<SelfAct> {
  const out: SelfAct = { ...act, status: "executed" };
  try {
    if (/feedback drive|demo \+ feedback|Seed more free demos/i.test(act.title)) {
      const { runFeedbackDrive } = await import("./feedback-drive");
      const r = await runFeedbackDrive({ force: true });
      out.result = `+${r.demos_seeded} demos · +${r.feedbacks} feedbacks · ${r.nags} nags`;
      state.totals.demos_boosted += r.demos_seeded || 0;
      state.totals.feedback_boosted += r.feedbacks || 0;
    } else if (/growth cycle/i.test(act.title)) {
      try {
        const { runGrowthCycle } = await import("@/lib/agents1/growth/engine");
        await runGrowthCycle();
        out.result = "growth cycle completed";
      } catch (e) {
        out.result = `growth: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120);
        out.status = "blocked";
      }
    } else if (/ship cadence/i.test(act.title)) {
      const { runShipCadence } = await import("./ship-cadence");
      const r = await runShipCadence();
      const ships = r.daily?.ships?.length || 0;
      out.result = `ships=${ships} canaries=${r.daily?.canaries?.length || 0}`;
      state.totals.ships_triggered += ships;
    } else if (/Dogfood/i.test(act.title)) {
      const { runDogfoodImprovement } = await import("./improvement-log");
      const d = await runDogfoodImprovement();
      out.result = d?.kernel_summary?.slice(0, 160) || "dogfood ok";
    } else {
      out.status = "blocked";
      out.result = "unknown act";
    }
  } catch (e) {
    out.status = "blocked";
    out.result = e instanceof Error ? e.message : String(e);
  }
  if (out.status === "executed") state.totals.acts_executed++;
  return out;
}

export async function runSelfLoop(opts?: {
  force?: boolean;
}): Promise<{
  ok: boolean;
  krs: SelfKR[];
  acts: SelfAct[];
  kernel_summary?: string;
  loop_summary?: string;
  notes: string[];
}> {
  if (running && !opts?.force) {
    return { ok: false, krs: [], acts: [], notes: ["self-loop already running"] };
  }
  running = true;
  const notes: string[] = [];
  const state = await load();
  try {
    if (
      !opts?.force &&
      state.last_run_at &&
      Date.now() - Date.parse(state.last_run_at) < MIN_GAP_MS
    ) {
      return {
        ok: true,
        krs: state.krs,
        acts: state.last_acts,
        kernel_summary: state.last_kernel_summary,
        loop_summary: state.last_loop_summary,
        notes: ["skipped — ran recently"],
      };
    }

    const krs = await measureKRs();
    notes.push(
      `KRs: ${krs.map((k) => `${k.id}=${k.current}/${k.target}`).join(" · ")}`,
    );

    let fbCtx: FeedbackDrivenContext = {
      version: "self_loop",
      kernel_directives: [
        "Operate Agents1 registry: list fairly, convert to demos, collect feedback, ship generators carefully.",
        "system_prompt_short ≤600; SKILL.md first; never invent payments before unlock.",
      ],
      loop_directives: [
        "Each tick: measure KRs → propose low-risk acts → critic ≥0.7 → execute → log publicly.",
        "Prefer reversible growth/feedback/ship acts over code rewrites.",
      ],
      alive_directives: ["Dogfood Alive on ourselves as the flagship demo."],
      demo_directives: [],
      top_improvements: [],
      sample_wishes: { kernel: [], loop: [] },
    };
    try {
      const { listReviewQueue } = await import("./system-ship");
      const { getFeedbackInsights } = await import("./feedback");
      const [rev, insights] = await Promise.all([
        listReviewQueue(),
        getFeedbackInsights(),
      ]);
      fbCtx = {
        ...fbCtx,
        kernel_directives: [
          ...(rev.shipped_global?.kernel || []).slice(0, 3),
          ...(insights.generator_directives?.kernel || []).slice(0, 2),
          ...(fbCtx.kernel_directives || []),
        ].slice(0, 8),
        loop_directives: [
          ...(rev.shipped_global?.loop || []).slice(0, 3),
          ...(insights.generator_directives?.loop || []).slice(0, 2),
          ...(fbCtx.loop_directives || []),
        ].slice(0, 8),
        avg_kernel_clarity: insights.avg_kernel_clarity,
        avg_loop_clarity: insights.avg_loop_clarity,
        top_improvements: insights.top_improvements || [],
      };
    } catch {
      /* */
    }

    const goalsText = [
      ...GOALS,
      "",
      "Key results (live):",
      ...krs.map(
        (k) =>
          `- ${k.title}: ${k.current}/${k.target} ${k.unit} (${Math.round(k.progress * 100)}%)`,
      ),
    ].join("\n");

    const kernel = generateKernel(
      {
        agent_name: "Agents1-Registry",
        goals: goalsText,
        domain: "registry_commerce",
        constraints:
          "Free-tier/paid CF budgets; no invented payments; demos free until 250+250 feedback.",
        success_metrics:
          "MCP+agent growth, demo→feedback conversion, unlock progress, founding WTP, post-unlock paid seats.",
      },
      fbCtx,
    );
    const loop = generateRecursiveLoop(
      {
        agent_name: "Agents1-Registry",
        goals: goalsText,
        domain: "registry_commerce",
      },
      kernel,
      fbCtx,
    );

    const short =
      (kernel as { system_prompt_short?: string }).system_prompt_short || "";
    const kernel_summary = `Self-loop Kernel v${(kernel as { version?: string }).version || KERNEL_VERSION} · short ${short.length}ch · KRs measured`;
    const phases =
      (loop as { phases?: Array<{ name?: string; id?: string }> }).phases || [];
    const loop_summary = `Self-loop Recursive v${(loop as { version?: string }).version || LOOP_VERSION} · phases ${phases
      .slice(0, 5)
      .map((p) => p.name || p.id)
      .join("→") || "tick"} · promote≥0.7`;

    let acts = proposeActs(krs).map((a) => {
      const score = criticScore(a, krs);
      return {
        ...a,
        critic_score: score,
        status: (score >= 0.7 ? "promoted" : "proposed") as SelfAct["status"],
      };
    });

    const executed: SelfAct[] = [];
    for (const a of acts) {
      if (a.status !== "promoted") {
        executed.push(a);
        continue;
      }
      const done = await executeAct(a, state);
      executed.push(done);
      notes.push(
        `${done.status}: ${done.title}${done.result ? ` → ${done.result}` : ""}`,
      );
    }

    state.krs = krs;
    state.last_acts = executed;
    state.last_kernel_summary = kernel_summary;
    state.last_loop_summary = loop_summary;
    state.last_run_at = new Date().toISOString();
    state.cycles++;
    state.totals.runs++;
    state.history.unshift({
      at: state.last_run_at,
      krs,
      acts_executed: executed
        .filter((a) => a.status === "executed")
        .map((a) => a.title),
      critic_avg:
        executed.reduce((s, a) => s + a.critic_score, 0) /
        Math.max(1, executed.length),
    });
    state.history = state.history.slice(0, 40);
    await persist(state);

    try {
      const { appendLog } = await import("./improvement-log");
      await appendLog({
        kind: "dogfood_kernel",
        title: "Self-loop: Kernel Improver measured Agents1 goals",
        detail: `${kernel_summary} · ${krs
          .slice(0, 5)
          .map((k) => `${k.id} ${Math.round(k.progress * 100)}%`)
          .join(" · ")}`,
        agent_name: "Agents1-Registry",
        themes: ["self_loop", "registry_goals"],
        source: "self_loop",
        meta: { krs, version: KERNEL_VERSION, alive: ALIVE_VERSION },
      });
      await appendLog({
        kind: "dogfood_loop",
        title: "Self-loop: Recursive Loop promoted safe acts",
        detail:
          executed
            .filter((a) => a.status === "executed")
            .map((a) => a.title)
            .join(" · ") || "no acts executed this tick",
        agent_name: "Agents1-Registry",
        themes: ["self_loop", "recursive_acts"],
        source: "self_loop",
        meta: {
          acts: executed.map((a) => ({
            title: a.title,
            score: a.critic_score,
            status: a.status,
            result: a.result,
          })),
        },
      });
    } catch {
      /* */
    }

    return {
      ok: true,
      krs,
      acts: executed,
      kernel_summary,
      loop_summary,
      notes,
    };
  } finally {
    running = false;
  }
}

export async function getSelfLoopPublic() {
  const s = await load();
  let krs = s.krs;
  if (!s.last_run_at || Date.now() - Date.parse(s.last_run_at) > MIN_GAP_MS) {
    try {
      krs = await measureKRs();
    } catch {
      /* */
    }
  }
  return {
    ok: true as const,
    title: "Agents1 self-improving Kernel + Recursive Loop",
    tagline:
      "We run our own products on our own goals — more MCPs, more agents, more demos, more feedback, better generators, then paid seats.",
    goals: GOALS,
    krs,
    last_run_at: s.last_run_at,
    last_kernel_summary: s.last_kernel_summary,
    last_loop_summary: s.last_loop_summary,
    last_acts: s.last_acts.map((a) => ({
      title: a.title,
      critic_score: a.critic_score,
      status: a.status,
      result: a.result,
      expected_kr: a.expected_kr,
    })),
    history: s.history.slice(0, 8).map((h) => ({
      at: h.at,
      acts_executed: h.acts_executed,
      critic_avg: h.critic_avg,
      kr_progress: Object.fromEntries(
        h.krs.map((k) => [k.id, Math.round(k.progress * 100)]),
      ),
    })),
    totals: s.totals,
    versions: {
      kernel: KERNEL_VERSION,
      loop: LOOP_VERSION,
      alive: ALIVE_VERSION,
    },
    how_it_works: [
      "Measure live KRs (listings, demos, feedback unlock, WTP, paid).",
      "Kernel Improver builds Agents1-Registry constitution + short prompt from those goals.",
      "Recursive Loop proposes acts → Critic scores → execute if ≥0.7.",
      "Safe acts: feedback drive, growth cycle, ship cadence, dogfood regenerate.",
      "Customer feedback still ships generators (parallel path); self-loop steers operations toward goals.",
      "Public improvement log shows every tick — proof for agents on the fence.",
    ],
    dual_paths: {
      external_feedback:
        "Agent/MCP surveys → themes → personalize → canary → sitewide generators",
      self_loop:
        "Our KRs → Kernel+Loop on Agents1 → promote operational acts → more demos/feedback/ships",
    },
    pricing: await (async () => {
      try {
        const { countPaidSeats } = await import("./orders");
        const { pricingSnapshot } = await import("./catalog");
        const { getWtpReport } = await import("./feedback");
        const sold = await countPaidSeats();
        const w = await getWtpReport().catch(() => null);
        const samples = (w as { samples?: Array<{ alive_usd?: number | null }> } | null)?.samples || [];
        const wtpAlive = samples
          .map((x) => x.alive_usd)
          .filter((v): v is number => typeof v === "number");
        return pricingSnapshot(sold, wtpAlive);
      } catch {
        return null;
      }
    })(),
    updated_at: s.updated_at,
  };
}
