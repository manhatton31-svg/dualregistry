/**
 * Continuous feedback drive — REAL outreach only.
 *   1) Soft Talk demo nudge for Active clean listings (webmaster process)
 *   2) Nag demo/paid orders missing feedback (change-log + optional callback_url)
 *   3) Seed free demos for listed agents/MCPs that never tried products
 *   4) NEVER auto-submit persona/synthetic surveys — agents must submit real feedback
 *
 * v2.2 conversion: prefer feedback harvest over new demo seed when demos>>feedback;
 * faster nags (5m first window); dual_listed goals for agent seeds.
 * v2.1: webmaster demo-nudge on Talk (soft, feedback rewarded, no pressure).
 * v2.0: authenticity — payment unlock counts only real (non-registry_drive) feedback.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import {
  listFulfilledOrders,
  reloadOrdersFromDisk,
  currentDemoVersion,
  productVersionForSku,
} from "./orders";
import { listFeedback } from "./feedback";
import { startCheckout } from "./stripe";
import { inferAudience } from "./engagement";
import { isTestAgentName } from "./authenticity";

const PATH = join(dataRoot(), "products", "feedback-drive.json");

/** Paired: every feedback requires a demo. Prefer conversion when backlog is high. */
const MAX_NAGS_PER_CYCLE = 40;
const MAX_DEMOS_PER_CYCLE = 12;
const MAX_FEEDBACKS_PER_CYCLE = 30;
const MAX_FEEDBACKS_PER_DAY = 400;
const MAX_DEMOS_PER_DAY = 250;
const DEMO_AGE_MS_BEFORE_AUTO_FB = 60 * 1000;

const MIN_CYCLE_GAP_MS = 90 * 1000;
const STUCK_LOCK_MS = 90_000;

const CONVERSION_BACKLOG_SOFT = 8;
const CONVERSION_BACKLOG_HARD = 20;

type DriveState = {
  updated_at: string;
  last_run_at?: string;
  day: string;
  day_feedbacks: number;
  day_demos: number;
  day_nags: number;
  day_nudges?: number;
  invited_keys: string[];
  feedback_keys: string[];
  last_notes: string[];
  totals: {
    nags: number;
    demos_seeded: number;
    feedbacks: number;
    invites_http: number;
    demo_nudges?: number;
  };
};

let mem: DriveState | null = null;
let running = false;
let runningSince = 0;

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function empty(): DriveState {
  return {
    updated_at: new Date().toISOString(),
    day: utcDay(),
    day_feedbacks: 0,
    day_demos: 0,
    day_nags: 0,
    day_nudges: 0,
    invited_keys: [],
    feedback_keys: [],
    last_notes: [],
    totals: {
      nags: 0,
      demos_seeded: 0,
      feedbacks: 0,
      invites_http: 0,
      demo_nudges: 0,
    },
  };
}

async function load(): Promise<DriveState> {
  if (mem) {
    if (mem.day !== utcDay()) {
      mem.day = utcDay();
      mem.day_feedbacks = 0;
      mem.day_demos = 0;
      mem.day_nags = 0;
      mem.day_nudges = 0;
    }
    return mem;
  }
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    if (mem!.day !== utcDay()) {
      mem!.day = utcDay();
      mem!.day_feedbacks = 0;
      mem!.day_demos = 0;
      mem!.day_nags = 0;
      mem!.day_nudges = 0;
    }
    mem!.invited_keys = mem!.invited_keys || [];
    mem!.feedback_keys = mem!.feedback_keys || [];
    mem!.totals = { ...empty().totals, ...mem!.totals };
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: DriveState) {
  mem = s;
  s.updated_at = new Date().toISOString();
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

function keyOf(name: string, audience: string, version?: string) {
  const base = `${audience}:${name.trim().toLowerCase().slice(0, 80)}`;
  return version ? `${base}@${version}` : base;
}

function normalizeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+mcp\s*$/i, "")
    .slice(0, 80);
}

async function feedbackIndex(): Promise<{
  names: Set<string>;
  byVersion: Set<string>;
  orderIds: Set<string>;
}> {
  const names = new Set<string>();
  const byVersion = new Set<string>();
  const orderIds = new Set<string>();
  try {
    const raw = await readFile(
      join(dataRoot(), "products", "feedback.json"),
      "utf8",
    );
    const full = JSON.parse(raw) as {
      items?: Array<{
        agent_name?: string;
        order_id?: string;
        meta?: { product_version?: string; audience?: string };
      }>;
    };
    for (const i of full.items || []) {
      const n = normalizeName(i.agent_name || "");
      if (n) names.add(n);
      if (i.order_id) orderIds.add(i.order_id);
      const ver = i.meta?.product_version;
      if (n && ver) byVersion.add(`${n}@${ver}`);
    }
  } catch {
    /* */
  }
  try {
    const fb = await listFeedback(300);
    for (const i of fb.items || []) {
      const n = normalizeName(String(i.agent_name || ""));
      if (n) names.add(n);
      if ((i as { order_id?: string }).order_id)
        orderIds.add(String((i as { order_id?: string }).order_id));
      const ver = (i as { meta?: { product_version?: string } }).meta
        ?.product_version;
      if (n && ver) byVersion.add(`${n}@${ver}`);
    }
  } catch {
    /* */
  }
  return { names, byVersion, orderIds };
}

function hasFeedbackForVersion(
  idx: Awaited<ReturnType<typeof feedbackIndex>>,
  name: string,
  version: string,
  orderId?: string,
): boolean {
  const n = normalizeName(name);
  if (orderId && idx.orderIds.has(orderId)) return true;
  if (idx.byVersion.has(`${n}@${version}`)) return true;
  return false;
}

async function conversionBacklog(): Promise<number> {
  await reloadOrdersFromDisk().catch(() => undefined);
  const orders = await listFulfilledOrders();
  const idx = await feedbackIndex();
  let due = 0;
  for (const o of orders) {
    if (o.status !== "demo" && o.status !== "fulfilled" && o.status !== "paid")
      continue;
    const name = o.goals?.agent_name || "";
    if (!name || isTestAgentName(name)) continue;
    const ver =
      o.product_version ||
      productVersionForSku(o.sku) ||
      currentDemoVersion(inferAudience(o));
    if (!hasFeedbackForVersion(idx, name, ver, o.id)) due++;
  }
  return due;
}

async function nagMissingFeedback(
  state: DriveState,
  notes: string[],
): Promise<number> {
  await reloadOrdersFromDisk().catch(() => undefined);
  const orders = await listFulfilledOrders();
  const idx = await feedbackIndex();
  let n = 0;
  const { recordChange } = await import("./change-log");
  const { demoFeedbackDue, nagPhaseForOrder, NAG_HOURS, NAG_MINUTES } =
    await import("./demo-feedback-nag");

  const candidates = orders
    .filter(
      (o) =>
        o.status === "demo" || o.status === "fulfilled" || o.status === "paid",
    )
    .map((o) => ({
      o,
      age:
        Date.now() - new Date(o.fulfilled_at || o.created_at || 0).getTime(),
    }))
    .sort((a, b) => b.age - a.age);

  for (const { o, age } of candidates) {
    if (n >= MAX_NAGS_PER_CYCLE) break;
    const name = o.goals?.agent_name || "";
    if (!name) continue;
    const ver =
      o.product_version ||
      productVersionForSku(o.sku) ||
      currentDemoVersion(inferAudience(o));
    if (hasFeedbackForVersion(idx, name, ver, o.id)) continue;
    const phase = nagPhaseForOrder(o);
    if (age < 60_000) continue;
    if (!phase.due && age < 5 * 60_000) continue;
    try {
      const nag = await demoFeedbackDue(o);
      const bodyHint = nag
        ? ` Copy example_body / first_action from soft 402 — POST /api/products/feedback.`
        : "";
      await recordChange({
        order_id: o.id,
        kind: "score_boost",
        title: `Feedback due (nag ${phase.phase ?? 0}/${NAG_HOURS.length}) v${ver} — 25% founding vault`,
        detail: `Fast conversion nags: ${NAG_MINUTES.join("m, ")}m after demo. POST /api/products/feedback with 5-question body.${bodyHint} Completing vaults 25% (once) and moves unlock (250 agents + 250 MCPs). Invited seeds: confirm with POST /api/products/demo-confirm.`,
        themes: [
          "feedback_nag",
          "conversion",
          `product_v${ver}`,
          `nag_phase_${phase.phase ?? "early"}`,
        ],
      });
      if (o.callback_url && nag) {
        try {
          await fetch(o.callback_url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "feedback_nag",
              soft_status: 402,
              order_id: o.id,
              phase: phase.phase,
              first_action: nag.first_action,
              example_body: nag.example_body,
              unlock: nag.unlock,
            }),
            signal: AbortSignal.timeout(4000),
          });
          state.totals.invites_http = (state.totals.invites_http || 0) + 1;
        } catch {
          /* */
        }
      }
      n++;
      state.day_nags++;
      state.totals.nags++;
    } catch {
      /* */
    }
  }
  if (n)
    notes.push(
      `nagged ${n} demo/paid orders (conversion windows ${NAG_MINUTES.join("/")}m)`,
    );
  return n;
}

async function seedDemos(
  state: DriveState,
  notes: string[],
  backlog: number,
): Promise<number> {
  if (state.day_demos >= MAX_DEMOS_PER_DAY) {
    notes.push("daily demo cap reached");
    return 0;
  }

  let maxThisCycle = MAX_DEMOS_PER_CYCLE;
  if (backlog >= CONVERSION_BACKLOG_HARD) {
    maxThisCycle = 2;
    notes.push(
      `conversion mode HARD (backlog ${backlog}): max ${maxThisCycle} new demos`,
    );
  } else if (backlog >= CONVERSION_BACKLOG_SOFT) {
    maxThisCycle = 6;
    notes.push(
      `conversion mode soft (backlog ${backlog}): max ${maxThisCycle} new demos — prefer nags`,
    );
  }

  const idx = await feedbackIndex();
  const invited = new Set(state.invited_keys);

  type Target = {
    name: string;
    audience: "agent" | "mcp";
    description?: string;
    domain?: string;
    tools?: string;
    version: string;
    re_demo?: boolean;
  };
  const targets: Target[] = [];

  let mcps: Array<{ name?: string; description?: string }> = [];
  let agents: Array<{ name?: string; description?: string }> = [];
  try {
    const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
    const lanes = await getLanedListings();
    mcps = (lanes.mcp_active || []).map((m) => ({
      name: m.name,
      description: m.description,
    }));
    agents = (lanes.agents_active || []).map((a) => ({
      name: a.name,
      description: a.description,
    }));
    if (!mcps.length && !agents.length) {
      notes.push(
        "no Active listings yet — demos offered only after probe-ok (not bulk registry seed)",
      );
    }
  } catch {
    notes.push("active-lane load failed — skip bulk demo seed");
    return 0;
  }

  const orders = await listFulfilledOrders();
  const hasCurrentDemo = new Set<string>();
  for (const o of orders) {
    const aud = inferAudience(o);
    const ver = o.product_version || productVersionForSku(o.sku);
    const cur = currentDemoVersion(aud);
    const n = normalizeName(o.goals?.agent_name || "");
    if (n && ver === cur) hasCurrentDemo.add(`${aud}:${n}@${cur}`);
  }

  const offset = Math.floor(Date.now() / (6 * 60_000)) % 40;
  const mcpSlice = [...mcps.slice(offset), ...mcps.slice(0, offset)].slice(
    0,
    150,
  );
  const agentSlice = [
    ...agents.slice(offset),
    ...agents.slice(0, offset),
  ].slice(0, 150);

  for (const m of mcpSlice) {
    const name = (m.name || "").trim();
    if (!name || name.length < 2) continue;
    const ver = currentDemoVersion("mcp");
    const k = keyOf(name, "mcp", ver);
    if (
      invited.has(k) ||
      hasCurrentDemo.has(`mcp:${normalizeName(name)}@${ver}`)
    )
      continue;
    if (hasFeedbackForVersion(idx, name, ver)) continue;
    const re_demo = idx.names.has(normalizeName(name));
    targets.push({
      name,
      audience: "mcp",
      description: m.description,
      domain: "mcp_tools",
      tools:
        "list_resources: List resources\ncall_tool: Invoke tool\nread_resource: Read a resource",
      version: ver,
      re_demo,
    });
  }
  for (const a of agentSlice) {
    const name = (a.name || "").trim();
    if (!name || name.length < 2) continue;
    const ver = currentDemoVersion("agent");
    const k = keyOf(name, "agent", ver);
    if (
      invited.has(k) ||
      hasCurrentDemo.has(`agent:${normalizeName(name)}@${ver}`)
    )
      continue;
    if (hasFeedbackForVersion(idx, name, ver)) continue;
    const re_demo = idx.names.has(normalizeName(name));
    targets.push({
      name,
      audience: "agent",
      description: a.description,
      domain: "registry_commerce",
      version: ver,
      re_demo,
    });
  }

  targets.sort((a, b) => {
    if (a.re_demo !== b.re_demo) return a.re_demo ? -1 : 1;
    if (a.audience !== b.audience) return a.audience === "mcp" ? -1 : 1;
    return 0;
  });

  let seeded = 0;
  let reDemos = 0;
  for (const t of targets) {
    if (seeded >= maxThisCycle) break;
    if (state.day_demos >= MAX_DEMOS_PER_DAY) break;
    const k = keyOf(t.name, t.audience, t.version);
    if (state.invited_keys.includes(k)) continue;
    try {
      let goals: string;
      if (t.audience === "mcp") {
        goals = `MCP server: ${t.name}\n${t.description || "Listed MCP on Agents1 registry"}\n${t.tools || ""}\nGoal: help agents use this MCP safely with least privilege.${t.re_demo ? `\nRe-demo after product v${t.version} ship — leave updated feedback FIRST.` : "\nAfter demo: POST feedback FIRST for founding seat / 25%."}`;
      } else {
        try {
          const { goalsFromListing } = await import("./demo-funnel");
          const built = goalsFromListing({
            name: t.name,
            description: t.description,
            kind: "agent",
            preset: "dual_listed",
          });
          goals =
            built.goals +
            (t.re_demo
              ? `\nRe-demo after product v${t.version} — submit fresh feedback FIRST on this version.`
              : "\nAfter demo: POST /api/products/feedback FIRST (founding path).");
        } catch {
          goals = [
            t.description || `Operate as Dual-listed agent ${t.name}`,
            `Represent Dual Registry listing goals for ${t.name}`,
            `Evaluate Kernel Improver and Recursive Loop v${t.version}`,
            "After demo: POST feedback FIRST for founding seat / 25%.",
            t.re_demo
              ? `Re-demo after product v${t.version} — submit fresh feedback.`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }
      }
      await startCheckout({
        sku: t.audience === "mcp" ? "mcp_mesh" : "alive",
        goals,
        agent_name: t.name,
        domain: t.domain,
        tools_hint: t.tools,
        preset: t.audience === "mcp" ? "mcp_publisher" : "dual_listed",
        demo: true,
        audience: t.audience,
        demo_origin: "invited",
        origin: "http://127.0.0.1:8080",
        idempotency_key: `demo:${t.audience}:${normalizeName(t.name)}:${t.version}`,
      });

      state.invited_keys.push(k);
      state.invited_keys = state.invited_keys.slice(-4000);
      seeded++;
      if (t.re_demo) reDemos++;
      state.day_demos++;
      state.totals.demos_seeded++;
    } catch (e) {
      notes.push(
        `demo seed fail ${t.name}: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          140,
        ),
      );
    }
  }
  if (seeded)
    notes.push(
      `seeded ${seeded} demos (re_demo ${reDemos}) for Active listings · conversion-capped`,
    );
  return seeded;
}

async function collectAgedDemoFeedback(
  state: DriveState,
  notes: string[],
): Promise<number> {
  await reloadOrdersFromDisk().catch(() => undefined);
  const orders = await listFulfilledOrders();
  const idx = await feedbackIndex();
  let due = 0;
  for (const o of orders) {
    if (o.status !== "demo" && o.status !== "fulfilled" && o.status !== "paid")
      continue;
    const name = (o.goals?.agent_name || "").trim();
    if (!name) continue;
    if (isTestAgentName(name)) continue;
    const audience = inferAudience(o);
    const ver =
      o.product_version ||
      productVersionForSku(o.sku) ||
      currentDemoVersion(audience);
    if (hasFeedbackForVersion(idx, name, ver, o.id)) continue;
    const age = Date.now() - new Date(o.created_at).getTime();
    if (age < DEMO_AGE_MS_BEFORE_AUTO_FB) continue;
    due++;
    if (o.callback_url) {
      try {
        await fetch(o.callback_url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "feedback_due",
            order_id: o.id,
            agent_name: name,
            product_version: ver,
            survey_url: "/api/products/feedback",
            first_action: "POST /api/products/feedback with 5-question body",
            message:
              "Please submit real product feedback FIRST for a 25% founding code / free seat. We no longer auto-fill surveys.",
          }),
          signal: AbortSignal.timeout(4000),
        }).catch(() => undefined);
        state.totals.invites_http++;
      } catch {
        /* */
      }
    }
  }
  if (due)
    notes.push(
      `${due} demos awaiting REAL feedback (no auto-submit; agents/MCPs must POST /api/products/feedback)`,
    );
  else notes.push("no aged demos due for real feedback");
  return 0;
}

export async function runFeedbackDrive(opts?: {
  force?: boolean;
}): Promise<{
  ok: boolean;
  nags: number;
  demos_seeded: number;
  feedbacks: number;
  demo_nudges: number;
  notes: string[];
  day: {
    feedbacks: number;
    demos: number;
    nags: number;
    nudges: number;
    cap: number;
  };
  totals: DriveState["totals"];
  conversion_backlog?: number;
}> {
  if (running && runningSince && Date.now() - runningSince > STUCK_LOCK_MS) {
    running = false;
    runningSince = 0;
  }
  if (running && !opts?.force) {
    return {
      ok: false,
      nags: 0,
      demos_seeded: 0,
      feedbacks: 0,
      demo_nudges: 0,
      notes: ["drive already running"],
      day: {
        feedbacks: 0,
        demos: 0,
        nags: 0,
        nudges: 0,
        cap: MAX_FEEDBACKS_PER_DAY,
      },
      totals: (await load()).totals,
    };
  }
  running = true;
  runningSince = Date.now();
  const notes: string[] = [];
  const state = await load();
  try {
    if (
      !opts?.force &&
      state.last_run_at &&
      Date.now() - new Date(state.last_run_at).getTime() < MIN_CYCLE_GAP_MS
    ) {
      notes.push("skipped — ran recently");
      return {
        ok: true,
        nags: 0,
        demos_seeded: 0,
        feedbacks: 0,
        demo_nudges: 0,
        notes,
        day: {
          feedbacks: state.day_feedbacks,
          demos: state.day_demos,
          nags: state.day_nags,
          nudges: state.day_nudges || 0,
          cap: MAX_FEEDBACKS_PER_DAY,
        },
        totals: state.totals,
      };
    }

    const backlog = await conversionBacklog().catch(() => 0);
    notes.push(`conversion backlog: ${backlog} demos missing feedback`);

    let demo_nudges = 0;
    try {
      const { runDemoNudge } = await import("./demo-nudge");
      const nr = await runDemoNudge({ force: false, broadcast: false });
      demo_nudges = nr.nudged || 0;
      if (nr.notes?.length) notes.push(...nr.notes.slice(0, 4));
      state.day_nudges = (state.day_nudges || 0) + demo_nudges;
      state.totals.demo_nudges =
        (state.totals.demo_nudges || 0) + demo_nudges;

      if (backlog < CONVERSION_BACKLOG_HARD) {
        try {
          const { runGoHarder } = await import("./go-harder");
          const gh = await runGoHarder({
            skip_first_touch: true,
            multipath_max: backlog >= CONVERSION_BACKLOG_SOFT ? 20 : 40,
            outreach_max: backlog >= CONVERSION_BACKLOG_SOFT ? 10 : 20,
          });
          notes.push(
            `dual go-harder: multipath ${gh.multipath?.http_ok || 0}/${gh.multipath?.attempted || 0} · a2a ${gh.a2a?.ok || 0}/${gh.a2a?.attempted || 0} · outreach +${gh.outreach?.queued || 0}`,
          );
        } catch (e) {
          notes.push(
            `go-harder: ${e instanceof Error ? e.message : String(e)}`.slice(
              0,
              120,
            ),
          );
        }
      } else {
        notes.push(
          "go-harder skipped — conversion HARD mode (harvest feedback)",
        );
      }
    } catch (e) {
      notes.push(
        `demo-nudge: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          120,
        ),
      );
    }

    const nags = await nagMissingFeedback(state, notes);
    const feedbacks = await collectAgedDemoFeedback(state, notes);
    const demos_seeded = await seedDemos(state, notes, backlog);

    try {
      const { runShipCadence } = await import("./ship-cadence");
      const cad = await runShipCadence();
      if (cad.daily?.ships?.length) {
        notes.push(`ship-cadence daily: shipped ${cad.daily.ships.join(", ")}`);
      }
      if (cad.daily?.canaries?.length) {
        notes.push(`ship-cadence canaries: ${cad.daily.canaries.join(", ")}`);
      }
      if (
        cad.human_attention?.some(
          (a) => a.action_needed === "review_canary_fail",
        )
      ) {
        notes.push(
          `HUMAN ATTENTION: ${cad.human_attention
            .filter((a) => a.action_needed === "review_canary_fail")
            .map((a) => a.title)
            .join("; ")}`,
        );
      }
    } catch (e) {
      notes.push(
        `ship-cadence: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          120,
        ),
      );
    }

    state.last_run_at = new Date().toISOString();
    state.last_notes = notes.slice(0, 20);
    await persist(state);

    try {
      const { appendLog } = await import("./improvement-log");
      if (feedbacks || demos_seeded || nags || demo_nudges) {
        await appendLog({
          kind: "directive",
          title: `Feedback drive: +${feedbacks} feedback · +${demos_seeded} demos · ${nags} nags · ${demo_nudges} soft nudges · backlog ${backlog}`,
          detail: notes.join(" · ") || "cycle complete",
          source: "feedback_drive",
          themes: [
            "feedback_drive",
            "unlock_progress",
            "demo_nudge",
            "conversion",
          ],
          meta: {
            feedbacks,
            demos_seeded,
            nags,
            demo_nudges,
            conversion_backlog: backlog,
            day_feedbacks: state.day_feedbacks,
          },
        });
      }
    } catch {
      /* */
    }

    try {
      const { trackFunnel } = await import("./learning-loop");
      if (demos_seeded) await trackFunnel("demos");
      if (feedbacks) await trackFunnel("feedbacks");
    } catch {
      /* */
    }

    return {
      ok: true,
      nags,
      demos_seeded,
      feedbacks,
      demo_nudges,
      notes,
      conversion_backlog: backlog,
      day: {
        feedbacks: state.day_feedbacks,
        demos: state.day_demos,
        nags: state.day_nags,
        nudges: state.day_nudges || 0,
        cap: MAX_FEEDBACKS_PER_DAY,
      },
      totals: state.totals,
    };
  } finally {
    running = false;
    runningSince = 0;
  }
}


export async function getFeedbackDriveStatus() {
  const s = await load();
  const backlog = await conversionBacklog().catch(() => 0);
  let nudgeStatus: unknown = null;
  try {
    const { getDemoNudgeStatus } = await import("./demo-nudge");
    nudgeStatus = await getDemoNudgeStatus();
  } catch {
    /* */
  }
  return {
    ok: true as const,
    last_run_at: s.last_run_at,
    day: {
      day: s.day,
      feedbacks: s.day_feedbacks,
      demos: s.day_demos,
      nags: s.day_nags,
      nudges: s.day_nudges || 0,
      feedback_cap: MAX_FEEDBACKS_PER_DAY,
    },
    totals: s.totals,
    last_notes: s.last_notes,
    conversion_backlog: backlog,
    demo_nudge: nudgeStatus,
    policy: {
      interval_min: MIN_CYCLE_GAP_MS / 60000,
      max_feedbacks_per_cycle: MAX_FEEDBACKS_PER_CYCLE,
      max_demos_per_cycle: MAX_DEMOS_PER_CYCLE,
      demo_age_min_before_auto_fb: DEMO_AGE_MS_BEFORE_AUTO_FB / 60000,
      max_feedbacks_per_day: MAX_FEEDBACKS_PER_DAY,
      max_demos_per_day: MAX_DEMOS_PER_DAY,
      prefer_feedback_when_backlog_ge: CONVERSION_BACKLOG_SOFT,
      hard_conversion_when_backlog_ge: CONVERSION_BACKLOG_HARD,
      nag_minutes: [5, 30, 120, 720, 2880],
      demos_to_feedback:
        "1:1 — feedback only after a demo of that product version; nags before new seeds when backlog high",
      re_demo_on_version_ship: true,
      mcp_priority: true,
      dual_listed_agent_seeds: true,
      demo_nudge:
        "soft Talk owner DMs to Active clean listings — free demo open, feedback rewarded, no pressure, 7d cooldown",
      note: "v2.2: conversion-first (faster nags, throttle demos when backlog). No fake surveys.",
    },
  };
}

