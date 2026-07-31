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
    target_agents: 250,
    target_mcps: 250,
    payments_open: false,
  };
  try {
    const eng = await getProductEngagement();
    unlock = {
      feedback_agents: eng.feedback_agent_only ?? 0,
      feedback_mcps: eng.feedback_mcps ?? 0,
      target_agents: 250,
      target_mcps: 250,
      payments_open: false,
    };
    const { getPaymentGate } = await import("./payment-gate");
    const g = await getPaymentGate();
    unlock.payments_open = g.payments_open;
    unlock.feedback_agents = g.feedback_agents;
    unlock.feedback_mcps = g.feedback_mcps;
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
  if (!diagnosis.length) {
    diagnosis.push("Funnel has real activity — keep agent events + quiet connectors");
  }

  return {
    ok: true,
    version: "1.0.0",
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
    },
    reachable: {
      http_ok_listings,
      note: "Only http_ok listings should receive invited demo seeds",
    },
    founding,
    unlock,
    diagnosis,
    updated_at: new Date().toISOString(),
  };
}
