/**
 * Funnel honesty — invited vs real demos vs real feedback.
 * Public unlock still uses real only; this surface shows the full pipeline.
 */
import { listFulfilledOrders, reloadOrdersFromDisk } from "./orders";
import { listFeedback } from "./feedback";
import { isPublicCountableDemo, REAL_NUMBERS_POLICY } from "./real-numbers";
import { isRealFeedback, isTestAgentName } from "./authenticity";
import { getProductEngagement } from "./engagement";

export type FunnelHonesty = {
  ok: true;
  version: string;
  policy: {
    public_counts: string;
    never_count: string[];
    never_auto_feedback: boolean;
    note: string;
  };
  demos: {
    real_public: number;
    self_serve: number;
    organic: number;
    invited_pending: number;
    platform_qa: number;
    operator_verified: number;
    other: number;
    total_orders: number;
  };
  feedback: {
    real_public: number;
    real_agents: number;
    real_mcps: number;
    total_events: number;
  };
  conversion: {
    backlog_invited_missing_feedback: number;
    backlog_real_missing_feedback: number;
    invited_with_feedback: number;
    real_with_feedback: number;
    conversion_rate_real_pct: number | null;
    /** Demo-path KR: real demos with feedback within 1 hour of demo fulfill */
    same_session_feedback: number;
    same_session_rate_pct: number | null;
    same_session_window_hours: number;
    /** Value-path KR: real feedback after improve_kernel / leave_feedback without requiring demo */
    value_to_feedback: number;
    value_to_feedback_rate_pct: number | null;
    primary_kr: string;
    secondary_note: string;
  };
  strategy: {
    primary_kr: string;
    secondary: string[];
    default_tool: string;
    human_path: string;
    invite_volume: string;
    system: string;
  };
  reachable: {
    http_ok_listings: number;
    note: string;
  };
  founding: {
    claimed: number;
    remaining: number;
    seats: number;
  };
  unlock: {
    feedback_agents: number;
    feedback_mcps: number;
    target_agents: number;
    target_mcps: number;
    payments_open: boolean;
  };
  diagnosis: string[];
  gtm: {
    mode: string;
    primary_surface: string;
    directories: string;
    invite_policy: string;
    win_this_week: string;
  };
  updated_at: string;
};

function rate(n: number, d: number): number | null {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 10;
}

export async function getFunnelHonesty(): Promise<FunnelHonesty> {
  await reloadOrdersFromDisk().catch(() => undefined);
  const orders = await listFulfilledOrders();
  let epoch = "";
  try {
    const { readFile } = await import("node:fs/promises");
    const { dataPath } = await import("@/lib/data-root");
    const raw = await readFile(dataPath("products/metrics-reset.json"), "utf8");
    epoch =
      (JSON.parse(raw) as { demo_metrics_epoch?: string }).demo_metrics_epoch ||
      "";
  } catch {
    /* */
  }

  const demos = {
    real_public: 0,
    self_serve: 0,
    organic: 0,
    invited_pending: 0,
    platform_qa: 0,
    operator_verified: 0,
    other: 0,
    total_orders: 0,
  };

  const demoOrders = orders.filter(
    (o) =>
      o.status === "demo" || o.status === "fulfilled" || o.status === "paid",
  );
  demos.total_orders = demoOrders.length;

  const realOrderIds = new Set<string>();
  const invitedOrderIds = new Set<string>();
  const realNames = new Set<string>();
  const invitedNames = new Set<string>();

  for (const o of demoOrders) {
    const origin = o.demo_origin || "other";
    const meta = (o.meta || {}) as Record<string, unknown>;
    if (meta.operator_verified === true) demos.operator_verified++;
    if (origin === "self_serve") demos.self_serve++;
    else if (origin === "organic") demos.organic++;
    else if (origin === "invited") demos.invited_pending++;
    else if (origin === "platform_qa") demos.platform_qa++;
    else demos.other++;

    if (isPublicCountableDemo(o, epoch)) {
      demos.real_public++;
      realOrderIds.add(o.id);
      const n = (o.goals?.agent_name || "").toLowerCase().trim();
      if (n) realNames.add(n);
    } else if (origin === "invited") {
      invitedOrderIds.add(o.id);
      const n = (o.goals?.agent_name || "").toLowerCase().trim();
      if (n) invitedNames.add(n);
    }
  }

  const fb = await listFeedback(800);
  let real_public = 0;
  let real_agents = 0;
  let real_mcps = 0;
  let total_events = 0;
  const fbOrderIds = new Set<string>();
  const fbNames = new Set<string>();

  for (const f of fb.items || []) {
    total_events++;
    if (isTestAgentName(f.agent_name)) continue;
    if (!isRealFeedback(f as Parameters<typeof isRealFeedback>[0])) continue;
    real_public++;
    const aud =
      (f as { meta?: { audience?: string } }).meta?.audience === "mcp" ||
      String((f as { sku?: string }).sku || "").includes("mcp")
        ? "mcp"
        : "agent";
    if (aud === "mcp") real_mcps++;
    else real_agents++;
    const oid = (f as { order_id?: string }).order_id;
    if (oid) fbOrderIds.add(oid);
    const n = String(f.agent_name || "")
      .toLowerCase()
      .trim();
    if (n) fbNames.add(n);
  }

  let backlog_invited = 0;
  let backlog_real = 0;
  let invited_with_fb = 0;
  let real_with_fb = 0;

  for (const id of invitedOrderIds) {
    if (fbOrderIds.has(id)) invited_with_fb++;
    else backlog_invited++;
  }
  for (const id of realOrderIds) {
    if (fbOrderIds.has(id)) real_with_fb++;
    else backlog_real++;
  }
  // also count by name when order_id missing
  for (const n of invitedNames) {
    if (fbNames.has(n) && !invited_with_fb) {
      /* name-level already partial */
    }
  }

  // Primary KR: same-session = feedback within 1h of demo fulfill (real public demos only)
  const SAME_SESSION_MS = 3600_000;
  let same_session_feedback = 0;
  const fbByOrder = new Map<string, number>();
  for (const f of fb.items || []) {
    if (isTestAgentName(f.agent_name)) continue;
    if (!isRealFeedback(f as Parameters<typeof isRealFeedback>[0])) continue;
    const oid = (f as { order_id?: string }).order_id;
    const at = Date.parse(
      String((f as { created_at?: string }).created_at || ""),
    );
    if (oid && Number.isFinite(at)) {
      const prev = fbByOrder.get(oid);
      if (prev == null || at < prev) fbByOrder.set(oid, at);
    }
  }
  for (const o of demoOrders) {
    if (!realOrderIds.has(o.id)) continue;
    const demoAt = Date.parse(String(o.fulfilled_at || o.created_at || ""));
    const fbAt = fbByOrder.get(o.id);
    if (
      Number.isFinite(demoAt) &&
      fbAt != null &&
      fbAt >= demoAt &&
      fbAt - demoAt <= SAME_SESSION_MS
    ) {
      same_session_feedback++;
    }
  }

  // Value-path KR: real feedback tagged improve_kernel / value / registry-tool
  // (no demo order required) counts as conversion when within last window
  // or anytime for unlock honesty — count all such feedbacks as value_session.
  let value_to_feedback = 0;
  for (const f of fb.items || []) {
    if (isTestAgentName(f.agent_name)) continue;
    if (!isRealFeedback(f as Parameters<typeof isRealFeedback>[0])) continue;
    const tags = ((f as { tags?: string[] }).tags || []).map(String);
    const src = String((f as { source?: string }).source || "");
    const meta = ((f as { meta?: Record<string, unknown> }).meta || {}) as Record<string, unknown>;
    const via = String(meta.via || meta.source || "");
    const valuePath =
      tags.some((x) =>
        /improve_kernel|value_optional|optional_feedback|registry-tool|ultra_minimal/.test(x),
      ) ||
      /improve_kernel|value_optional|registry-tool|dual-as-tool/.test(src + " " + via) ||
      !(f as { order_id?: string }).order_id;
    if (valuePath) value_to_feedback++;
  }

  let http_ok_listings = 0;
  try {
    const { listHttpOkListingIds } = await import("./demo-nudge");
    http_ok_listings = (await listHttpOkListingIds()).size;
  } catch {
    /* */
  }

  let founding = { claimed: 0, remaining: 100, seats: 100 };
  try {
    const { getFoundingFreePublic } = await import("./founding-free");
    const ff = await getFoundingFreePublic();
    founding = {
      claimed: ff.claimed,
      remaining: ff.remaining,
      seats: 100,
    };
  } catch {
    /* */
  }

  let unlock = {
    feedback_agents: 0,
    feedback_mcps: 0,
    target_agents: 10,
    target_mcps: 5,
    payments_open: false,
  };
  try {
    const { getPaymentGate, PAYMENT_UNLOCK_TARGET } = await import("./payment-gate");
    const g = await getPaymentGate();
    unlock = {
      feedback_agents: g.feedback_agents,
      feedback_mcps: g.feedback_mcps,
      target_agents: g.feedback_agents_target ?? PAYMENT_UNLOCK_TARGET.feedback_agents,
      target_mcps: g.feedback_mcps_target ?? PAYMENT_UNLOCK_TARGET.feedback_mcps,
      payments_open: g.payments_open,
    };
  } catch {
    /* */
  }

  const diagnosis: string[] = [];
  try {
    const { getEventUsagePublic } = await import("./event-pricing");
    const eu = await getEventUsagePublic();
    diagnosis.push(
      `Agent events today: ${eu.totals.total_events} free=${eu.totals.free_events} paid=${eu.totals.paid_events} payment_required=${eu.totals.payment_required} identities=${eu.totals.unique_identities}`,
    );
  } catch {
    /* */
  }
  if (demos.real_public === 0 && demos.invited_pending > 0) {
    diagnosis.push(
      `${demos.invited_pending} invited demos exist but 0 public-countable — prefer one-call improve_kernel over invited seeds`,
    );
  }
  if (real_public === 0) {
    diagnosis.push(
      "0 real feedback POSTs — optional after value tools; never invent buyers",
    );
  }
  if (http_ok_listings === 0) {
    diagnosis.push(
      "0 multipath http_ok listings — quiet mode keeps cold outbound off",
    );
  }
  if (demos.invited_pending > 0 && backlog_invited > demos.real_public) {
    diagnosis.push(
      "Conversion backlog is mostly invited ghosts — agent path uses free events without orders",
    );
  }
  if (demos.real_public === 0 && real_public === 0) {
    diagnosis.push(
      "Push one-call value (improve_kernel) via MCP; keep quiet connectors for operator intros",
    );
  }
  if (value_to_feedback === 0 && same_session_feedback === 0) {
    diagnosis.push(
      "PRIMARY KR: 0 value→feedback conversions — push improve_kernel + optional leave_feedback same turn",
    );
  } else if (demos.real_public > 0 && same_session_feedback === 0) {
    diagnosis.push(
      "Demo-path same-session still 0 — optional; value path is primary",
    );
  }
  if (demos.invited_pending > 0 && invited_with_fb === 0) {
    diagnosis.push(
      `Invited ghosts (${demos.invited_pending}) are NOT a growth KR — collaborators arrive via value tools + optional feedback, not invite volume`,
    );
  }
  if (real_public < 5) {
    diagnosis.push(
      "Collaborative system: ship full improve_kernel value, collect real feedback, close gaps on the improvement log. Automated agent/MCP inbound is the default collaborator path.",
    );
  }
  if (!diagnosis.length) {
    diagnosis.push("Funnel has real activity — keep agent events + quiet connectors");
  }

  return {
    ok: true,
    version: "1.4.0",
    policy: {
      public_counts: REAL_NUMBERS_POLICY.rule,
      never_count: [...REAL_NUMBERS_POLICY.never_count_demo_origins],
      never_auto_feedback: REAL_NUMBERS_POLICY.never_auto_submit_feedback,
      note: REAL_NUMBERS_POLICY.if_stuck,
    },
    demos,
    feedback: {
      real_public,
      real_agents,
      real_mcps,
      total_events,
    },
    conversion: {
      backlog_invited_missing_feedback: backlog_invited,
      backlog_real_missing_feedback: backlog_real,
      invited_with_feedback: invited_with_fb,
      real_with_feedback: real_with_fb,
      conversion_rate_real_pct: rate(real_with_fb, demos.real_public),
      same_session_feedback,
      same_session_rate_pct: rate(same_session_feedback, demos.real_public),
      same_session_window_hours: 1,
      value_to_feedback,
      value_to_feedback_rate_pct: rate(value_to_feedback, Math.max(real_public, 1)),
      primary_kr: "value_to_feedback_same_session_rate",
      secondary_note:
        "Primary: improve_kernel → optional leave_feedback. Demo same-session is secondary. Invited ghosts do not move unlock.",
    },
    strategy: {
      primary_kr: "value_to_feedback_same_session_rate (real feedback after one-call value tools)",
      secondary: [
        "improve_kernel as default first tool (full artifact)",
        "optional leave_feedback same turn for founding free",
        "complete_founding_path only when listing_id known",
        "human_handoff URL when agent cannot HTTP",
        "hard-capped invite volume (not the growth KR)",
      ],
      default_tool: "improve_kernel",
      human_path: "/try · /for-agents · demo.human_handoff.url (optional when agent cannot HTTP)",
      invite_volume: "do not optimize — invited ghosts are noise; collaborators self-serve value→feedback",
      system: "collaborative_design_system — feedback core, improve/loop muscle",
    },
    reachable: {
      http_ok_listings,
      note: "Only http_ok listings should receive invited demo seeds; prefer same-session close over more seeds",
    },
    founding,
    unlock,
    diagnosis,
    gtm: {
      mode: "collaborative_design_system",
      primary_surface:
        "POST /api/mcp improve_kernel → optional feedback (agents/MCPs); /try when human-operated",
      directories:
        "Official MCP Registry (listed) + Smithery/Glama/PulseMCP/mcp.so — discovery for automated collaborators",
      invite_policy:
        "Quiet mode default — invited_pending is noise, not progress",
      win_this_week:
        "10 real collaborator feedbacks (value→feedback) that train Kernel/Loop; unlock 10 agents + 5 MCPs",
    },
    updated_at: new Date().toISOString(),
  };
}
