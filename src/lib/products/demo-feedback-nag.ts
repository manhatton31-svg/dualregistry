/**
 * Soft 402-style feedback nag for DEMO orders (not lifecycle paid surveys).
 * Never blocks artifacts — only surfaces next action for close-rate.
 * Includes prefilled 5-question body + unlock meter + already-shipped.
 */
import type { ProductOrder } from "./orders";
import { listFeedback } from "./feedback";
import { buildFeedbackDraft, getUnlockMeter, messagingKit } from "./quick-demo";

export type DemoFeedbackNag = {
  soft_status: 402;
  code: "feedback_due" | "confirm_or_feedback_due";
  message: string;
  order_id: string;
  access_token: string;
  audience: "agent" | "mcp";
  feedback_endpoint: string;
  product_version?: string;
  founding_discount: string;
  example_body: Record<string, unknown>;
  unlock?: Awaited<ReturnType<typeof getUnlockMeter>>;
  messaging?: ReturnType<typeof messagingKit>;
  nag_schedule?: { t_plus_hours: number[]; next_at?: string };
  funnel_stage?: string;
  funnel_next?: string;
  buy_when_open?: Record<string, unknown>;
  confirm_if_invited?: Record<string, unknown>;
  [key: string]: unknown;
};

function inferAudience(o: ProductOrder): "agent" | "mcp" {
  if (o.audience === "mcp" || o.audience === "agent") return o.audience;
  if (o.sku === "mcp_mesh") return "mcp";
  if (/mcp/i.test(o.goals?.agent_name || "")) return "mcp";
  return "agent";
}

function normalize(s?: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Timeboxed nag windows: 1h, 24h, 72h after demo fulfill */
export const NAG_HOURS = [1, 24, 72] as const;

export function nagPhaseForOrder(order: ProductOrder, now = Date.now()): {
  due: boolean;
  phase: number | null;
  next_at?: string;
} {
  const start = Date.parse(order.fulfilled_at || order.created_at || "");
  if (!Number.isFinite(start)) return { due: true, phase: 0 };
  const ageH = (now - start) / 3600_000;
  let phase: number | null = null;
  for (let i = 0; i < NAG_HOURS.length; i++) {
    if (ageH >= NAG_HOURS[i]!) phase = i;
  }
  if (phase === null && ageH < 1) {
    return {
      due: false,
      phase: null,
      next_at: new Date(start + 3600_000).toISOString(),
    };
  }
  const nextIdx = (phase ?? -1) + 1;
  const next_at =
    nextIdx < NAG_HOURS.length
      ? new Date(start + NAG_HOURS[nextIdx]! * 3600_000).toISOString()
      : undefined;
  return { due: phase !== null || ageH >= 0.05, phase, next_at };
}

export async function demoFeedbackDue(
  order: ProductOrder,
): Promise<DemoFeedbackNag | null> {
  if (order.status !== "demo") return null;
  try {
    const fb = await listFeedback(400);
    const has = (fb.items || []).some(
      (i) =>
        (i as { order_id?: string }).order_id === order.id ||
        (normalize(i.agent_name) === normalize(order.goals?.agent_name) &&
          (i as { meta?: { product_version?: string } }).meta
            ?.product_version === order.product_version),
    );
    if (has) return null;
  } catch {
    /* assume due */
  }

  const aud = inferAudience(order);
  const name =
    order.goals?.agent_name || (aud === "mcp" ? "Your MCP" : "Your Agent");
  const unlock = await getUnlockMeter().catch(() => undefined);
  const messaging = messagingKit(aud, unlock);
  let what_changed: string[] = [];
  try {
    const { getShippedForSurvey } = await import("./improvement-log");
    const shipped = await getShippedForSurvey();
    what_changed = (shipped.already_shipped || [])
      .map((h: unknown) =>
        typeof h === "string"
          ? h
          : (h as { change?: string; label?: string }).change ||
            (h as { label?: string }).label ||
            "",
      )
      .filter(Boolean)
      .slice(0, 6);
  } catch {
    /* */
  }

  const phase = nagPhaseForOrder(order);
  const invited = order.demo_origin === "invited";
  return {
    soft_status: 402,
    code: invited ? "confirm_or_feedback_due" : "feedback_due",
    message: invited
      ? `Soft reminder: finish your free demo. Confirm (POST /api/products/demo-confirm) or re-take POST /api/products/demo, then leave feedback for 25% / founding seat.`
      : aud === "mcp"
        ? `Soft reminder: MCP feedback due. ${messaging.headline} Completing vaults 25% and ${unlock?.you_move_the_bar || "moves unlock"}. Then buy full Mesh with your code when payments open.`
        : `Soft 402: agent feedback due. ${messaging.headline} Completing vaults 25% and ${unlock?.you_move_the_bar || "moves unlock"}. Then buy Alive with your code when payments open.`,
    order_id: order.id,
    access_token: order.access_token,
    audience: aud,
    funnel_stage: invited ? "demo" : "feedback",
    funnel_next: invited
      ? "confirm_or_take_demo → feedback → discount → buy"
      : "feedback → discount → buy",
    feedback_endpoint: "POST /api/products/feedback",
    product_version: order.product_version,
    founding_discount: "25% A1FB vault after real survey (redeems at checkout when payments open)",
    buy_when_open: {
      method: "POST",
      url: "/api/products/checkout",
      body: {
        sku: order.sku,
        discount_code: "A1FB_FROM_FEEDBACK",
        goals: order.goals?.goals || "…",
        agent_name: name,
      },
      note: "Payments locked until 250 agent + 250 MCP real feedback",
    },
    example_body: buildFeedbackDraft({
      audience: aud,
      agent_name: name,
      order_id: order.id,
      sku: order.sku,
      access_token: order.access_token,
      what_changed,
    }),
    unlock,
    messaging,
    nag_schedule: {
      t_plus_hours: [...NAG_HOURS],
      next_at: phase.next_at,
    },
    confirm_if_invited: invited
      ? {
          method: "POST",
          url: "/api/products/demo-confirm",
          body: { order_id: order.id, access_token: order.access_token },
        }
      : undefined,
  };
}
