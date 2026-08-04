/**
 * Agents1 self-improving Kernel + Recursive Loop.
 *
 * Dual path with external feedback ships:
 *   External: agent/MCP surveys → themes → generators
 *   Internal: OUR goals → Kernel Improver + Recursive Loop → safe operational acts
 *
 * Goals: more MCPs, more agents, more demos, more feedback (10/5 payment unlock),
 * density physics (C/O/F), founding claims, outbound conversion, then paid seats —
 * publicly logged so fence-sitters see the system work on itself.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import {
  generateKernel,
  generateRecursiveLoop,
  ALIVE_VERSION,
  KERNEL_VERSION,
  LOOP_VERSION,
  type FeedbackDrivenContext,
} from "./generate";
import {
  FLYWHEEL_VERSION,
  PLATFORM_KERNEL_DIRECTIVES,
  PLATFORM_LOOP_DIRECTIVES,
} from "./flywheel";

const PATH = join(dataRoot(), "products", "self-loop.json");
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
    federation_ops?: number;
    compositions_seeded?: number;
    outbound_sends?: number;
  };
};

let mem: SelfLoopState | null = null;
let running = false;

const GOALS = [
  "Grow the Agents1 MCP registry with checks-clean listings (unlimited, zero dupes).",
  "Grow the Agents1 agent registry with checks-clean listings (unlimited, zero dupes).",
  "Convert listed MCPs and agents into free product demos (unlimited demos; Kernel, Loop, Alive, Mesh).",
  "Collect structured feedback from demos — 10 agent + 5 MCP before payments open.",
  "Claim founding free seats via demo→real feedback (first 100 combined) — prove conversion, not just listings.",
  "Raise composition density C ≥ 0.08 with real used_with edges (not residue spam).",
  "Open federation density F ≥ 2 via real peer pull/push ops (HF catalog + MCP registry + future peers).",
  "Use hyper day budget: same-session demo→feedback rate improves; invite volume hard-capped secondary when room remains (conversion pressure).",
  "Ship Kernel/Loop/Mesh improvements from feedback without global regressions; dogfood Dual physics directives.",
  "After unlock: convert feedbackers to paid seats (founding prices first 1000; each next price level lasts 1000 seats). Measure buy-likelihood as price steps up. Until unlock maximize WTP and founding intent.",
  "Show fence-sitters a live self-improving system dogfooding its own products + public improvement log.",
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
      federation_ops: 0,
      compositions_seeded: 0,
      outbound_sends: 0,
    },
  };
}

async function load(): Promise<SelfLoopState> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.totals = { ...empty().totals, ...(mem!.totals || {}) };
    mem!.goals = GOALS;
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

  // --- Platform density physics KRs (flywheel v2.9+) ---
  let densityC = 0;
  let densityO = 0;
  let densityF = 0;
  let densityN = 0;
  try {
    const { sampleExonomics } = await import("./exonomics");
    const snap = await sampleExonomics();
    densityC = Number(snap.density?.C || 0);
    densityO = Number(snap.density?.O || 0);
    densityF = Number(snap.density?.F || 0);
    densityN = Number(snap.density?.N || 0);
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

  let outboundSent = 0;
  let outboundCap = 24;
  try {
    const { getConversionPressureStatus } = await import(
      "./conversion-pressure"
    );
    const cp = await getConversionPressureStatus();
    outboundSent = Number(cp.day_sent || 0);
    outboundCap = Math.max(1, Number(cp.day_cap || cp.base_cap || 24));
  } catch {
    /* */
  }

  const demos = demoAgents + demoMcps;
  krs.push({
    id: "mcp_listed",
    title: "MCPs listed (unlimited, zero dupes)",
    target: Math.max(mcp, 1),
    current: mcp,
    unit: "mcps",
    progress: 1,
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
    id: "active_clean",
    title: "Active clean listings (N)",
    target: Math.max(30, densityN || 1),
    current: densityN,
    unit: "listings",
    progress: progress(densityN, 30),
    weight: 1,
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
    target: 10,
    current: fbAgents,
    unit: "agents",
    progress: progress(fbAgents, 10),
    weight: 3,
  });
  krs.push({
    id: "feedback_mcps",
    title: "MCP REAL feedback toward unlock (primary KR)",
    target: 5,
    current: fbMcps,
    unit: "mcps",
    progress: progress(fbMcps, 5),
    weight: 3,
  });
  krs.push({
    id: "founding_claims",
    title: "Founding free seats claimed (demo→feedback)",
    target: 100,
    current: foundingClaimed,
    unit: "seats",
    progress: progress(foundingClaimed, 100),
    weight: 4,
  });
  // Primary conversion KR — same-session feedback rate from funnel honesty
  let sameSessionRate = 0;
  let sameSessionN = 0;
  try {
    const { getFunnelHonesty } = await import("./funnel-honesty");
    const fh = await getFunnelHonesty();
    sameSessionRate = Number(fh.conversion?.value_to_feedback_rate_pct ?? fh.conversion?.same_session_rate_pct ?? 0) || 0;
    sameSessionN = Number(fh.conversion?.value_to_feedback ?? fh.conversion?.same_session_feedback ?? 0) || 0;
  } catch {
    /* */
  }
  krs.push({
    id: "value_to_feedback_rate",
    title: `PRIMARY KR: same-session demo→feedback rate (1h; n=${sameSessionN})`,
    target: 50,
    current: sameSessionRate,
    unit: "pct",
    progress: progress(sameSessionRate, 50),
    weight: 5,
  });
  krs.push({
    id: "composition_density",
    title: "Composition density C (real used_with / N)",
    target: 0.08,
    current: Math.round(densityC * 10000) / 10000,
    unit: "ratio",
    progress: progress(densityC, 0.08),
    weight: 2.5,
  });
  krs.push({
    id: "outcome_coverage",
    title: "Outcome coverage O (evidence / N)",
    target: 0.05,
    current: Math.round(densityO * 10000) / 10000,
    unit: "ratio",
    progress: progress(densityO, 0.05),
    weight: 1.5,
  });
  krs.push({
    id: "federation_peers",
    title: "Federation peer ops F (pull+push counted)",
    target: 2,
    current: densityF,
    unit: "ops",
    progress: progress(densityF, 2),
    weight: 3,
  });
  krs.push({
    id: "outbound_sends",
    title: "Outbound first-touch sends today",
    target: Math.min(outboundCap, Math.max(8, Math.floor(outboundCap * 0.25))),
    current: outboundSent,
    unit: "sends",
    progress: progress(
      outboundSent,
      Math.min(outboundCap, Math.max(8, Math.floor(outboundCap * 0.25))),
    ),
    weight: 2,
  });
  krs.push({
    id: "founding_intent",
    title: "Discounts vaulted (founding intent)",
    target: 1000,
    current: discounts,
    unit: "codes",
    progress: progress(discounts, 1000),
  });
  krs.push({
    id: "paid_seats",
    title: "Paid seats (unlimited; 1000-seat price bands)",
    target: 1000,
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
  const founding = by.founding_claims;
  const comp = by.composition_density;
  const fed = by.federation_peers;
  const outbound = by.outbound_sends;

  if (fed && fed.progress < 1) {
    acts.push({
      id: `act_${now}_federation`,
      title: "Run federation pull/push cycle",
      rationale: `F=${fed.current}/${fed.target} peer ops — last hyper gate; pull HF + MCP registry, push Dual signal.`,
      expected_kr: ["federation_peers"],
      risk: "low",
      status: "proposed",
      critic_score: 0,
    });
  }
  if (comp && comp.progress < 1) {
    acts.push({
      id: `act_${now}_seed_c`,
      title: "Seed real composition edges from Active clean",
      rationale: `C=${comp.current} (floor 0.08) — near-zero used_with seed from tag/category clusters.`,
      expected_kr: ["composition_density"],
      risk: "low",
      status: "proposed",
      critic_score: 0,
    });
  }
  if (founding && founding.current < 1) {
    acts.push({
      id: `act_${now}_founding`,
      title: "Boost founding conversion (demo + feedback drive)",
      rationale:
        "0 founding seats claimed — prove demo→feedback path before more harvest.",
      expected_kr: ["founding_claims", "feedback_agents", "feedback_mcps"],
      risk: "low",
      status: "proposed",
      critic_score: 0,
    });
  }
  if (outbound && outbound.progress < 0.5) {
    acts.push({
      id: `act_${now}_outbound`,
      title: "Run outbound conversion pressure (first-touch under day cap)",
      rationale: `Outbound ${outbound.current}/${outbound.target} today — hyper room unused is wasted density.`,
      expected_kr: ["outbound_sends", "demos_taken"],
      risk: "medium",
      status: "proposed",
      critic_score: 0,
    });
  }

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
  if (demos && demos.current < 1) {
    acts.push({
      id: `act_${now}_demos`,
      title: "Seed more free demos for listed registry participants",
      rationale:
        "Demos are the prerequisite for honest feedback; keep funnel topped.",
      expected_kr: ["demos_taken"],
      risk: "low",
      status: "proposed",
      critic_score: 0,
    });
  }
  if ((mcp && mcp.current < 10) || (ag && ag.current < 10)) {
    acts.push({
      id: `act_${now}_growth`,
      title: "Run registry growth cycle (harvest + probe + list)",
      rationale: `Listings MCP ${mcp?.current ?? "?"} · Agents ${ag?.current ?? "?"} — more surface for demos.`,
      expected_kr: ["mcp_listed", "agents_listed", "active_clean"],
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
      "Prove combined system: regenerate our own kernel/loop with Dual physics directives.",
    expected_kr: ["founding_claims", "composition_density", "federation_peers"],
    risk: "low",
    status: "proposed",
    critic_score: 0,
  });
  return acts.slice(0, 8);
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
  if (
    /growth|demo|feedback|dogfood|federation|composition|founding|outbound/i.test(
      act.title,
    )
  )
    s += 0.05;
  if (
    /federation|composition|founding conversion|outbound conversion/i.test(
      act.title,
    )
  )
    s += 0.08;
  return Math.min(0.98, Math.max(0.1, Math.round(s * 100) / 100));
}

async function executeAct(act: SelfAct, state: SelfLoopState): Promise<SelfAct> {
  const out: SelfAct = { ...act, status: "executed" };
  try {
    if (/federation pull/i.test(act.title)) {
      const { pullFederationPeer, pushFederationSignals } = await import(
        "./interop"
      );
      const pulled = await pullFederationPeer();
      const pushed = await pushFederationSignals({
        origin: "https://dualregistry.dev",
      });
      const nPeers = (pulled.peers || []).length;
      const nPush = Number(pushed.pushed || 0);
      out.result = `pull peers=${nPeers} · push=${nPush} · ${(pulled.notes || []).slice(0, 2).join("; ")}`;
      state.totals.federation_ops =
        (state.totals.federation_ops || 0) + nPeers + Math.max(1, nPush);
    } else if (/Seed real composition|composition edges/i.test(act.title)) {
      const { seedCompositionsFromActive } = await import("./flywheel");
      const r = await seedCompositionsFromActive({ max_pairs: 24, force: true });
      out.result = `seeded ${r.seeded} pairs · ${r.note}`;
      state.totals.compositions_seeded =
        (state.totals.compositions_seeded || 0) + r.seeded;
    } else if (
      /founding conversion|feedback drive|demo \+ feedback|Seed more free demos/i.test(
        act.title,
      )
    ) {
      const { runFeedbackDrive } = await import("./feedback-drive");
      const r = await runFeedbackDrive({ force: true });
      out.result = `+${r.demos_seeded} demos · +${r.feedbacks} feedbacks · ${r.nags} nags`;
      state.totals.demos_boosted += r.demos_seeded || 0;
      state.totals.feedback_boosted += r.feedbacks || 0;
    } else if (/outbound conversion pressure/i.test(act.title)) {
      const { runConversionPressure } = await import("./conversion-pressure");
      const r = await runConversionPressure({
        origin: "https://dualregistry.dev",
        max: 8,
      });
      out.result = `attempted=${r.attempted} http_ok=${r.http_ok} skipped=${r.skipped}`;
      state.totals.outbound_sends =
        (state.totals.outbound_sends || 0) + (r.http_ok || 0);
    } else if (/growth cycle/i.test(act.title)) {
      try {
        const { runGrowthCycle } = await import("@/lib/agents1/growth/engine");
        await runGrowthCycle();
        out.result = "growth cycle completed";
      } catch (e) {
        out.result = `growth: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          120,
        );
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
        ...PLATFORM_KERNEL_DIRECTIVES.slice(0, 6),
        "Operate Agents1 registry: list fairly, convert to demos, collect feedback, ship generators carefully.",
        "system_prompt_short ≤600; SKILL.md first; never invent payments before unlock.",
      ].slice(0, 8),
      loop_directives: [
        ...PLATFORM_LOOP_DIRECTIVES.slice(0, 6),
        "Each tick: measure KRs → propose low-risk acts → critic ≥0.7 → execute → log publicly.",
        "Prefer reversible growth/feedback/ship acts over code rewrites.",
      ].slice(0, 8),
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
          ...PLATFORM_KERNEL_DIRECTIVES.slice(0, 4),
          ...(rev.shipped_global?.kernel || []).slice(0, 2),
          ...(insights.generator_directives?.kernel || []).slice(0, 2),
          ...(fbCtx.kernel_directives || []),
        ].slice(0, 10),
        loop_directives: [
          ...PLATFORM_LOOP_DIRECTIVES.slice(0, 4),
          ...(rev.shipped_global?.loop || []).slice(0, 2),
          ...(insights.generator_directives?.loop || []).slice(0, 2),
          ...(fbCtx.loop_directives || []),
        ].slice(0, 10),
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
          "Free-tier/paid CF budgets; no invented payments; demos free until 10+5 feedback; prefer near-zero Dual ops.",
        success_metrics:
          "MCP+agent growth, C≥0.08, F≥2, founding claims, demo→feedback, outbound under cap, post-unlock paid seats.",
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
    const kernel_summary = `Self-loop Kernel v${(kernel as { version?: string }).version || KERNEL_VERSION} · flywheel ${FLYWHEEL_VERSION} · short ${short.length}ch · density KRs measured`;
    const phases =
      (loop as { phases?: Array<{ name?: string; id?: string }> }).phases || [];
    const loop_summary = `Self-loop Recursive v${(loop as { version?: string }).version || LOOP_VERSION} · phases ${phases
      .slice(0, 5)
      .map((p) => p.name || p.id)
      .join("→") || "tick"} · promote≥0.7 · physics acts first`;

    const acts = proposeActs(krs).map((a) => {
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
          .filter((k) =>
            [
              "founding_claims",
              "composition_density",
              "federation_peers",
              "outbound_sends",
              "feedback_agents",
            ].includes(k.id),
          )
          .map((k) => `${k.id} ${Math.round(k.progress * 100)}%`)
          .join(" · ")}`,
        agent_name: "Agents1-Registry",
        themes: ["self_loop", "registry_goals", "platform_physics"],
        source: "self_loop",
        meta: { krs, version: KERNEL_VERSION, flywheel: FLYWHEEL_VERSION },
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
        themes: ["self_loop", "recursive_acts", "platform_physics"],
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
      "We run Kernel+Loop on our own goals — listings, demos, feedback, density (C/O/F), founding claims, outbound, then paid seats.",
    goals: GOALS,
    krs,
    platform_physics: {
      flywheel_version: FLYWHEEL_VERSION,
      kernel_directives: PLATFORM_KERNEL_DIRECTIVES,
      loop_directives: PLATFORM_LOOP_DIRECTIVES,
      density_krs: [
        "composition_density",
        "outcome_coverage",
        "federation_peers",
        "founding_claims",
        "outbound_sends",
        "active_clean",
      ],
    },
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
      flywheel: FLYWHEEL_VERSION,
    },
    how_it_works: [
      "Measure live KRs: listings, demos, feedback unlock, C/O/F density, founding claims, outbound sends, paid.",
      "Kernel Improver builds Agents1-Registry constitution with Dual platform physics directives.",
      "Recursive Loop proposes acts → Critic scores → execute if ≥0.7.",
      "Physics-first acts: federation pull/push, composition seed, founding conversion, outbound under cap.",
      "Also: feedback drive, growth cycle, ship cadence, dogfood regenerate.",
      "Customer feedback still ships generators (parallel path); self-loop steers ops toward goals + density.",
      "Public improvement log shows every tick — proof for agents on the fence.",
    ],
    dual_paths: {
      external_feedback:
        "Agent/MCP surveys → themes → personalize → canary → sitewide generators",
      self_loop:
        "Our KRs (incl. C/F/founding/outbound) → Kernel+Loop on Agents1 → promote operational acts → density + demos/feedback/ships",
    },
    pricing: await (async () => {
      try {
        const { countPaidSeats } = await import("./orders");
        const { pricingSnapshot } = await import("./catalog");
        const { getWtpReport } = await import("./feedback");
        const sold = await countPaidSeats();
        const w = await getWtpReport().catch(() => null);
        const samples =
          (w as { samples?: Array<{ alive_usd?: number | null }> } | null)
            ?.samples || [];
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
