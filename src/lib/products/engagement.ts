/**
 * Product engagement metrics.
 * Public demos = REAL only (self_serve | organic) created after metrics-reset epoch.
 * System invited seeds never count. Unlock: 250 agent + 250 MCP real feedback.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRealFeedback, isTestAgentName } from "./authenticity";
import { isPublicCountableDemo, REAL_NUMBERS_POLICY } from "./real-numbers";
import { listFulfilledOrders, reloadOrdersFromDisk } from "./orders";
import { listFeedback } from "./feedback";
import { loadStoreCache } from "@/lib/agents1/store-cache";
import { dataRoot } from "@/lib/data-root";

const METRICS_RESET_PATH = join(
  process.cwd(),
  "data",
  "products",
  "metrics-reset.json",
);

export type ProductEngagement = {
  demo_agents: number;
  feedback_agents: number;
  demo_events: number;
  feedback_events: number;
  feedback_rate_pct: number | null;
  demo_agent_only: number;
  feedback_agent_only: number;
  demo_agent_events: number;
  feedback_agent_events: number;
  feedback_rate_agents_pct: number | null;
  demo_mcps: number;
  feedback_mcps: number;
  demo_mcp_events: number;
  feedback_mcp_events: number;
  feedback_rate_mcps_pct: number | null;
  feedback_without_demo: number;
  show_mcp_split: boolean;
  mcp_approved: number;
  agents_approved: number;
  mcp_target: number;
  agents_target: number;
  discounts_issued: number;
  demo_invited: number;
  demo_self_serve: number;
  demo_metrics_epoch?: string;
  real_numbers_only?: boolean;
  real_numbers_policy?: string;
  updated_at: string;
};

let demoEpochCache: string | null = null;

async function loadDemoMetricsEpoch(): Promise<string> {
  // Always re-read so epoch resets apply without process restart
  try {
    const raw = await readFile(METRICS_RESET_PATH, "utf8");
    const j = JSON.parse(raw) as { demo_metrics_epoch?: string };
    if (j.demo_metrics_epoch) {
      demoEpochCache = j.demo_metrics_epoch;
      return demoEpochCache;
    }
  } catch {
    /* */
  }
  demoEpochCache = new Date().toISOString();
  return demoEpochCache;
}

/** Real public demo — delegates to REAL_NUMBERS_POLICY (external only). */
function isRealDemoOrder(
  o: {
    status?: string;
    demo_origin?: string;
    idempotency_key?: string;
    created_at?: string;
    meta?: Record<string, unknown>;
  },
  epoch: string,
): boolean {
  return isPublicCountableDemo(o, epoch);
}

function participantKey(p: {
  agent_name?: string | null;
  email?: string | null;
  contact?: string | null;
  agent_card_url?: string | null;
  order_id?: string | null;
  id?: string | null;
}): string {
  const n = (p.agent_name || "").trim().toLowerCase();
  if (n) return `n:${n}`;
  const e = (p.email || p.contact || "").trim().toLowerCase();
  if (e) return `e:${e}`;
  const u = (p.agent_card_url || "").trim().toLowerCase();
  if (u) return `u:${u}`;
  return `id:${p.order_id || p.id || "unknown"}`;
}

export function inferAudience(o: {
  audience?: string;
  sku?: string;
  goals?: { agent_name?: string; domain?: string };
}): "agent" | "mcp" {
  if (o.audience === "mcp" || o.audience === "agent") return o.audience;
  if (o.sku === "mcp_mesh") return "mcp";
  const name = (o.goals?.agent_name || "").toLowerCase();
  const domain = (o.goals?.domain || "").toLowerCase();
  if (
    domain.includes("mcp") ||
    name.includes("mcp") ||
    name.endsWith(" server")
  )
    return "mcp";
  return "agent";
}

function inferFeedbackAudience(f: {
  audience?: string;
  sku?: string;
  tags?: string[];
  agent_name?: string;
}): "agent" | "mcp" {
  if (f.audience === "mcp" || f.audience === "agent") return f.audience;
  if (f.sku === "mcp_mesh") return "mcp";
  if ((f.tags || []).includes("mcp")) return "mcp";
  const name = (f.agent_name || "").toLowerCase();
  if (name.includes("mcp") || name.endsWith(" server")) return "mcp";
  return "agent";
}

function isProductTry(o: { status?: string }): boolean {
  return o.status === "demo" || o.status === "paid" || o.status === "fulfilled";
}

function rate(num: number, den: number): number | null {
  if (den <= 0) return num > 0 ? 100 : null;
  return Math.min(100, Math.round((num / den) * 1000) / 10);
}

export async function recomputeInsights(): Promise<ProductEngagement> {
  await reloadOrdersFromDisk().catch(() => undefined);
  const orders = await listFulfilledOrders();
  const fb = await listFeedback(500);
  const epoch = await loadDemoMetricsEpoch();

  const demoAgentKeys = new Set<string>();
  const demoMcpKeys = new Set<string>();
  let demoAgentEvents = 0;
  let demoMcpEvents = 0;
  const selfServeSet = new Set<string>();
  const orderMeta = new Map<
    string,
    { key: string; audience: "agent" | "mcp" }
  >();

  for (const o of orders) {
    if (!isProductTry(o)) continue;
    if (isTestAgentName(o.goals?.agent_name)) continue;
    const aud = inferAudience(o);
    const key = participantKey({
      agent_name: o.goals?.agent_name,
      email: o.email,
      agent_card_url: o.agent_card_url,
      order_id: o.id,
      id: o.id,
    });
    orderMeta.set(o.id, { key, audience: aud });

    if (!isRealDemoOrder(o, epoch)) continue;

    selfServeSet.add(key);
    if (aud === "mcp") {
      demoMcpEvents++;
      demoMcpKeys.add(key);
    } else {
      demoAgentEvents++;
      demoAgentKeys.add(key);
    }
  }

  const fbAgentKeys = new Set<string>();
  const fbMcpKeys = new Set<string>();
  let fbAgentEvents = 0;
  let fbMcpEvents = 0;
  let feedback_without_demo = 0;
  const discountKeys = new Set<string>();

  const items = (fb.items || []) as Array<{
    id?: string;
    agent_name?: string;
    contact?: string;
    agent_card_url?: string;
    order_id?: string;
    audience?: string;
    sku?: string;
    tags?: string[];
    discount_code?: string;
  }>;

  for (const f of items) {
    if (!isRealFeedback(f)) continue;
    let aud = inferFeedbackAudience(f);
    let key = participantKey({
      agent_name: f.agent_name,
      contact: f.contact,
      agent_card_url: f.agent_card_url,
      order_id: f.order_id,
      id: f.id,
    });
    if (f.order_id && orderMeta.has(f.order_id)) {
      const m = orderMeta.get(f.order_id)!;
      key = m.key;
      aud = m.audience;
    }
    if (aud === "mcp") {
      fbMcpEvents++;
      fbMcpKeys.add(key);
    } else {
      fbAgentEvents++;
      fbAgentKeys.add(key);
    }
    const hasDemo =
      demoAgentKeys.has(key) ||
      demoMcpKeys.has(key) ||
      (f.order_id ? orderMeta.has(f.order_id) : false);
    if (!hasDemo) feedback_without_demo++;
    if (f.discount_code) discountKeys.add(key);
  }

  let summaryDiscounts = 0;
  try {
    const raw = await readFile(
      join(dataRoot(), "products", "feedback.json"),
      "utf8",
    );
    const full = JSON.parse(raw) as {
      discounts?: Array<{ agent_name?: string; feedback_id?: string }>;
      summary?: { discounts_issued?: number };
    };
    for (const d of full.discounts || []) {
      const k = participantKey({
        agent_name: d.agent_name,
        id: d.feedback_id,
      });
      if (!isTestAgentName(d.agent_name)) discountKeys.add(k);
    }
    summaryDiscounts = full.summary?.discounts_issued || 0;
  } catch {
    /* */
  }

  const demo_agent_final = demoAgentKeys.size;
  const demo_mcp_final = demoMcpKeys.size;
  const feedback_agent_only = fbAgentKeys.size;
  const feedback_mcps = fbMcpKeys.size;
  const totalDemoFinal = demo_agent_final + demo_mcp_final;
  const totalFbFinal = feedback_agent_only + feedback_mcps;
  const demo_events = Math.max(demoAgentEvents + demoMcpEvents, totalDemoFinal);
  const feedback_events = Math.max(fbAgentEvents + fbMcpEvents, totalFbFinal);
  const show_mcp_split =
    demo_mcp_final > 0 || feedback_mcps > 0 || demoMcpEvents > 0;

  const discountsFinal = Math.min(
    discountKeys.size || Math.min(summaryDiscounts, totalFbFinal),
    totalFbFinal,
  );

  let cache: Awaited<ReturnType<typeof loadStoreCache>> | null = null;
  try {
    cache = await loadStoreCache();
  } catch {
    /* */
  }

  return {
    demo_agents: totalDemoFinal,
    feedback_agents: totalFbFinal,
    demo_events,
    feedback_events,
    feedback_rate_pct: rate(totalFbFinal, totalDemoFinal),
    demo_agent_only: demo_agent_final,
    feedback_agent_only,
    demo_agent_events: demoAgentEvents,
    feedback_agent_events: fbAgentEvents,
    feedback_rate_agents_pct: rate(feedback_agent_only, demo_agent_final),
    demo_mcps: demo_mcp_final,
    feedback_mcps,
    demo_mcp_events: demoMcpEvents,
    feedback_mcp_events: fbMcpEvents,
    feedback_rate_mcps_pct: rate(feedback_mcps, demo_mcp_final),
    feedback_without_demo,
    show_mcp_split,
    mcp_approved: cache?.milestones?.mcp?.approved ?? cache?.mcp_approved ?? 0,
    agents_approved:
      cache?.milestones?.agents?.approved ?? cache?.agents_approved ?? 0,
    mcp_target: cache?.mcp_target ?? 0,
    agents_target: cache?.agents_target ?? 0,
    discounts_issued: discountsFinal,
    demo_invited: 0,
    demo_self_serve: selfServeSet.size,
    demo_metrics_epoch: epoch,
    real_numbers_only: true,
    real_numbers_policy: REAL_NUMBERS_POLICY.rule,
    updated_at: new Date().toISOString(),
  };
}

export async function getProductEngagement(): Promise<ProductEngagement> {
  return recomputeInsights();
}
