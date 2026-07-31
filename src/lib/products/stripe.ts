/**
 * Stripe Checkout for Agents1 products.
 * Live payments only when payment gate is open (250 feedback agents + 250 feedback MCPs).
 * Demos always available for product taste + feedback.
 */
import Stripe from "stripe";
import { PRODUCTS, type ProductSku } from "./catalog";
import {
  createOrder,
  fulfillOrder,
  markPaid,
  updateOrderPaymentUrl,
  type ProductOrder,
} from "./orders";
import { getPaymentGate } from "./payment-gate";

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.startsWith("sk_"));
}

function client() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key);
}

export async function startCheckout(input: {
  sku: ProductSku | string;
  goals: string;
  agent_name?: string;
  constraints?: string;
  domain?: string;
  success_metrics?: string;
  tools_hint?: string;
  preset?: string;
  email?: string;
  agent_card_url?: string;
  callback_url?: string;
  idempotency_key?: string;
  origin: string;
  demo?: boolean;
  discount_code?: string;
  cost_mode?: string;
  audience?: "agent" | "mcp";
  product_version?: string;
  demo_origin?: "self_serve" | "invited" | "organic" | "platform_qa";
  /** Agent name-your-price USD (clamped server-side) */
  named_price_usd?: number | null;
  named_price_cents?: number | null;
}): Promise<{


  order: ProductOrder;
  checkout_url?: string;
  mode: "stripe" | "demo";
  message: string;
  payment_gate?: Awaited<ReturnType<typeof getPaymentGate>>;
  /** Agent-native next actions after demo (feedback close-rate) */
  next_steps?: {
    feedback_due: boolean;
    feedback_endpoint: string;
    survey_schema_hint: string;
    example_body: Record<string, unknown>;
    founding_discount: string;
    soft_status: number;
    unlock?: unknown;
    messaging?: unknown;
  };
}> {
  const gate = await getPaymentGate();
  const order = await createOrder({
    ...input,
    discount_code: input.discount_code,
    cost_mode: input.cost_mode,
    audience: input.audience,
    product_version: input.product_version,
    demo_origin: input.demo_origin || (input.demo ? "self_serve" : undefined),
    named_price_usd: input.named_price_usd,
    named_price_cents: input.named_price_cents,
  });

  const product = PRODUCTS[order.sku];
  const origin = input.origin.replace(/\/$/, "");

  // 100% founding free (or $0 with code) → full product even when payments locked
  const isFreeFull =
    input.demo !== true &&
    ((order.discount_percent != null && order.discount_percent >= 100) ||
      (order.amount_cents === 0 && Boolean(order.discount_code)));

  if (isFreeFull) {
    let fulfilled = await fulfillOrder(order.id, { demo: false });
    try {
      const { patchOrder, getOrder } = await import("./orders");
      fulfilled =
        (await patchOrder(fulfilled.id, {
          amount_cents: 0,
          note:
            fulfilled.note ||
            "Founding free 100% — full product unlocked after demo + feedback",
          meta: { ...(fulfilled.meta || {}), founding_free: true },
        })) || fulfilled;
      fulfilled = (await getOrder(fulfilled.id)) || fulfilled;
    } catch {
      /* */
    }
    try {
      const { enrollLifecycle } = await import("./feedback-lifecycle");
      await enrollLifecycle(fulfilled);
    } catch {
      /* */
    }
    return {
      order: fulfilled,
      mode: "demo",
      message:
        "Founding free seat — full product unlocked. Follow order.use_now / how_to_use: GET /api/products/access?token=… then paste kernel or export skills.",
      payment_gate: gate,
      next_steps: {
        feedback_due: true,
        feedback_endpoint: "POST /api/products/feedback",
        survey_schema_hint: "lifecycle post-setup via GET /api/products/lifecycle?token=…",
        example_body: {},
        founding_discount: "100% founding free — already applied",
        soft_status: 200,
      },
    };
  }

  // Explicit demo, missing Stripe key, OR payments still locked → demo only
  const forceDemo =
    input.demo === true || !stripeConfigured() || !gate.payments_open;

  if (forceDemo) {
    const fulfilled = await fulfillOrder(order.id, { demo: true });
    let message: string;
    if (input.demo === true) {
      message = gate.payments_open
        ? "Demo fulfillment requested"
        : `Demo fulfillment — live card payments open after ${gate.feedback_agents_target} feedback agents + ${gate.feedback_mcps_target} feedback MCPs (now ${gate.feedback_agents}/${gate.feedback_mcps}). Leave feedback after this demo: first 100 agents/MCPs combined get 100% off the full product immediately.`;
    } else if (!gate.payments_open) {
      message = `${gate.message} Full artifacts unlocked as demo — send feedback via POST /api/products/feedback (or submit_feedback tool).`;
      fulfilled.note = message;
    } else if (!stripeConfigured()) {
      message =
        "STRIPE_SECRET_KEY not set — demo fulfillment so you can test Kernel + Loop now. Set the key and enable card payments in Stripe Dashboard for live checkout.";
      fulfilled.note = message;
    } else {
      message = "Demo fulfillment";
    }
    const aud =
      fulfilled.audience ||
      input.audience ||
      (/mcp/i.test(fulfilled.goals?.agent_name || "") ? "mcp" : "agent");
    const { buildFeedbackDraft, getUnlockMeter, messagingKit } = await import(
      "./quick-demo"
    );
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
    const unlock = await getUnlockMeter();
    const msg = messagingKit(aud === "mcp" ? "mcp" : "agent", unlock);
    const example_body = buildFeedbackDraft({
      audience: aud === "mcp" ? "mcp" : "agent",
      agent_name: fulfilled.goals?.agent_name || (aud === "mcp" ? "Your MCP" : "Your Agent"),
      order_id: fulfilled.id,
      sku: fulfilled.sku,
      access_token: fulfilled.access_token,
      what_changed,
    });
    const next_steps = {
      feedback_due: true,
      feedback_endpoint: "POST /api/products/feedback",
      survey_schema_hint:
        "Network Edition survey — focus: (1) product quality (2) agent/MCP UX. Fill agent_ux, ux_friction, network_clarity, network_wish, product_one_ship, WTP fields, would_buy_at_founding",
      soft_status: 402,
      founding_discount:
        "First 100 agents/MCPs combined: demo + feedback = 100% off full product now. After that: 25% A1FB vault until payments open.",
      unlock,
      messaging: msg,
      example_body,
    };
    return {
      order: fulfilled,
      mode: "demo",
      message:
        message +
        ` ${msg.headline} ${unlock.you_move_the_bar} NEXT: POST next_steps.example_body to /api/products/feedback — your voice ships the next Kernel/Loop pass.`,
      payment_gate: gate,
      next_steps,
    };
  }

  try {
    const stripe = client();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: input.email || undefined,
      client_reference_id: order.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: order.amount_cents,
            product: product.stripe_product_id,
          },
        },
      ],
      success_url: `${origin}/products/success?order_id=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/products?canceled=1&order_id=${order.id}`,
      metadata: {
        order_id: order.id,
        sku: order.sku,
        access_token: order.access_token,
        seat_number: String(order.seat_number || ""),
        price_tier: order.price_tier_id || "",
        amount_cents: String(order.amount_cents),
      },
      payment_intent_data: {
        metadata: {
          order_id: order.id,
          sku: order.sku,
        },
      },
    });
    if (session.url) {
      await updateOrderPaymentUrl(order.id, session.url, session.id);
    }
    const updated = {
      ...order,
      payment_url: session.url || undefined,
      stripe_session_id: session.id,
    };
    return {
      order: updated,
      checkout_url: session.url || undefined,
      mode: "stripe",
      message: "Redirect to Stripe Checkout",
      payment_gate: gate,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const fulfilled = await fulfillOrder(order.id, { demo: true });
    fulfilled.note = `Stripe Checkout failed (${msg}). Demo-fulfilled. Enable payment methods at https://dashboard.stripe.com/settings/payment_methods and set STRIPE_SECRET_KEY.`;
    return {
      order: fulfilled,
      mode: "demo",
      message: fulfilled.note,
      payment_gate: gate,
    };
  }
}

export async function confirmSession(sessionId: string, orderId?: string) {
  const gate = await getPaymentGate();
  if (!stripeConfigured() || !gate.payments_open) {
    if (orderId) return fulfillOrder(orderId, { demo: true });
    throw new Error("Payments not open and no order_id for demo fulfill");
  }
  const stripe = client();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const oid =
    orderId ||
    session.metadata?.order_id ||
    session.client_reference_id ||
    undefined;
  if (!oid) throw new Error("Order id missing on session");
  if (session.payment_status === "paid" || session.status === "complete") {
    return markPaid(oid, {
      stripe_session_id: session.id,
      stripe_payment_intent:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id,
    });
  }
  throw new Error(`Session not paid (${session.payment_status})`);
}

export async function handleWebhook(
  rawBody: string,
  signature: string | null,
): Promise<{ received: boolean; order_id?: string }> {
  if (!stripeConfigured()) return { received: false };
  const gate = await getPaymentGate();
  if (!gate.payments_open) return { received: false };
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = client();
  let event: Stripe.Event;
  if (secret && signature) {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } else {
    event = JSON.parse(rawBody) as Stripe.Event;
  }
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const oid =
      session.metadata?.order_id || session.client_reference_id || undefined;
    if (oid && (session.payment_status === "paid" || session.status === "complete")) {
      await markPaid(oid, {
        stripe_session_id: session.id,
        stripe_payment_intent:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
      });
      return { received: true, order_id: oid };
    }
  }
  return { received: true };
}
