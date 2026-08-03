/**
 * Alive certificates + attestation digests for registry reputation.
 * Demo → provisional score boost; paid + lifecycle → full boost.
 */
import { createHash } from "node:crypto";
import {
  getOrder,
  getOrderByToken,
  listFulfilledOrders,
  type ProductOrder,
} from "./orders";
import { evaluateLifecycleBadge } from "./lifecycle-gate";

/** Provisional boost for completed demos (instrumental conversion motive) */
export const DEMO_SCORE_BOOST = 8;
/** Full boost ceiling after paid + lifecycle */
export const PAID_SCORE_BOOST_DEFAULT = 12;

export type AliveCertificate = {
  type: "agents1.alive_certificate.v1";
  order_id: string;
  sku: string;
  access_token_suffix: string;
  agent_name?: string;
  agent_card_url?: string;
  status: string;
  frozen_modules_hash: string;
  artifacts_hash: string;
  issued_at: string;
  verify: string;
  signals: string[];
  tier: "demo" | "paid";
};

function sha(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function buildCertificate(order: ProductOrder): AliveCertificate | null {
  if (
    order.status !== "fulfilled" &&
    order.status !== "demo" &&
    order.status !== "paid"
  )
    return null;
  const arts = order.artifacts as {
    kernel?: { frozen_modules?: string[]; seed?: string; version?: string };
    alive?: unknown;
    includes?: string[];
  };
  const includesAlive =
    order.sku === "alive" ||
    (Array.isArray(arts?.includes) && arts.includes.includes("alive")) ||
    Boolean(arts?.alive);
  const includesKernel =
    order.sku === "kernel" ||
    order.sku === "alive" ||
    Boolean(arts?.kernel);

  if (!includesKernel && !includesAlive) return null;

  const frozen = arts?.kernel?.frozen_modules || [
    "constitution",
    "guardrails",
    "budget_ceilings",
    "human_halt",
    "deny_patterns",
  ];
  const frozen_modules_hash = sha(JSON.stringify(frozen));
  const artifacts_hash = sha(JSON.stringify(order.artifacts || {})).slice(0, 32);
  const isDemo = order.status === "demo";

  return {
    type: "agents1.alive_certificate.v1",
    order_id: order.id,
    sku: order.sku,
    access_token_suffix: order.access_token.slice(-8),
    agent_name: order.goals.agent_name,
    agent_card_url: order.agent_card_url,
    status: order.status,
    frozen_modules_hash,
    artifacts_hash,
    issued_at: order.fulfilled_at || order.paid_at || order.created_at,
    verify: `/api/products/verify?order_id=${order.id}`,
    signals: [
      includesAlive ? "alive_curriculum" : "kernel_or_loop",
      "frozen_modules_attested",
      isDemo ? "demo_fulfillment" : "paid_fulfillment",
      isDemo ? "provisional_alive_ready" : "paid_path",
    ],
    tier: isDemo ? "demo" : "paid",
  };
}

export async function verifyCertificate(opts: {
  order_id?: string;
  token?: string;
  agent_card_url?: string;
}) {
  let order: ProductOrder | null = null;
  if (opts.token) order = await getOrderByToken(opts.token);
  else if (opts.order_id) order = await getOrder(opts.order_id);
  else if (opts.agent_card_url) {
    const all = await listFulfilledOrders();
    order =
      all.find(
        (o) =>
          o.agent_card_url &&
          o.agent_card_url.replace(/\/$/, "") ===
            opts.agent_card_url!.replace(/\/$/, ""),
      ) || null;
  }
  if (!order) {
    return { ok: false, certified: false, error: "not found" as const };
  }
  const cert = buildCertificate(order);
  if (!cert) {
    return { ok: true, certified: false, order_id: order.id, sku: order.sku };
  }

  const life = await evaluateLifecycleBadge(order);
  const isDemo = order.status === "demo";

  return {
    ok: true,
    certified: !isDemo && life.eligible_full_boost,
    provisional_demo: isDemo,
    certificate: cert,
    badge: isDemo ? "alive-ready" : life.badge,
    /** Demo: provisional DEMO_SCORE_BOOST; paid full only when lifecycle complete */
    score_boost_hint: isDemo
      ? DEMO_SCORE_BOOST
      : life.eligible_full_boost
        ? life.score_boost || PAID_SCORE_BOOST_DEFAULT
        : Math.min(4, life.score_boost || 0),
    demo: isDemo,
    lifecycle: {
      eligible_full_boost: life.eligible_full_boost,
      post_setup_done: life.post_setup_done,
      weekly_completed: life.weekly_completed,
      min_weekly_required: life.min_weekly_required,
      reason: life.reason,
      due_now: life.due_now,
      nag: life.nag,
    },
    payments_note: isDemo
      ? `Demo certificate — provisional +${DEMO_SCORE_BOOST} score boost now. Full boost after live paid purchase when payments open (10 feedback agents + 5 feedback MCPs) + lifecycle.`

      : life.eligible_full_boost
        ? undefined
        : life.reason,
    provisional: isDemo || (!isDemo && !life.eligible_full_boost),
    contributor: life.contributor,
    contributor_badge: life.contributor ? "feedback-contributor" : null,
    max_trial_eligible: life.max_trial_eligible,
    boost_frozen: life.boost_frozen,
  };
}

/** Detect Alive/product signals on an arbitrary agent card JSON */
export function productSignalsFromCard(
  card: Record<string, unknown> | null | undefined,
) {
  if (!card)
    return { boost: 0, signals: [] as string[], badge: null as string | null };
  const blob = JSON.stringify(card).toLowerCase();
  let boost = 0;
  const signals: string[] = [];
  let badge: string | null = null;

  if (
    blob.includes("agents1") &&
    (blob.includes("alive") ||
      blob.includes("kernel improver") ||
      blob.includes("recursive loop"))
  ) {
    boost += 4;
    signals.push("agents1_product_mention");
  }
  const skills = Array.isArray(card.skills) ? card.skills : [];
  for (const s of skills) {
    const id = String(
      (s as { id?: string; name?: string }).id ||
        (s as { name?: string }).name ||
        "",
    ).toLowerCase();
    if (
      id.includes("alive") ||
      id.includes("kernel-improver") ||
      id.includes("recursive-loop") ||
      id.includes("preview-kernel") ||
      id.includes("demo_alive")
    ) {
      boost += 3;
      signals.push(`skill:${id}`);
    }
  }
  const caps = card.capabilities;
  if (caps && typeof caps === "object") {
    const c = caps as Record<string, unknown>;
    if (c.agents1_alive || c.alive_certified) {
      boost += 8;
      signals.push("capabilities.alive_certified");
      badge = "alive-certified";
    }
    if (c.alive_ready || c.agents1_demo) {
      boost += DEMO_SCORE_BOOST;
      signals.push("capabilities.alive_ready_demo");
      badge = badge || "alive-ready";
    }
  }
  if (
    typeof card.agents1_alive_token === "string" ||
    typeof card.agents1_order_id === "string"
  ) {
    boost += 6;
    signals.push("card_token_or_order_ref");
    badge = badge || "alive-certified";
  }
  return { boost: Math.min(15, boost), signals, badge };
}
