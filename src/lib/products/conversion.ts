/**
 * Post-approval / post-list conversion path.
 * While payments locked: free preview → demo → feedback.
 * Protocol-native: next: demo_kernel on every list receipt.
 */
import {
  PRODUCTS,
  formatUsd,
  pricingSnapshot,
  type ProductSku,
} from "./catalog";
import { countPaidSeats } from "./orders";
import { getPaymentGate } from "./payment-gate";
import {
  buildApprovalNext,
  foundingDemoWindowCopy,
  getDemoSocialProof,
  goalsFromListing,
  GOAL_PRESETS,
} from "./demo-funnel";

export type ConversionPath = {
  version: string;
  listed: boolean;
  agent_name?: string;
  payments_open: boolean;
  /** Protocol next-step agents should take immediately */
  next: "demo_kernel" | "demo_alive" | "buy_alive";
  payment_gate: {
    feedback_agents: number;
    feedback_mcps: number;
    feedback_agents_target: number;
    feedback_mcps_target: number;
    feedback_agents_remaining: number;
    feedback_mcps_remaining: number;
    /** aliases for older clients — map to feedback progress */
    mcp_approved: number;
    agents_approved: number;
    mcp_target: number;
    agents_target: number;
    mcp_remaining: number;
    agents_remaining: number;
    progress_pct: number;
    message: string;
    unlock_rule: string;
    agent_directive: string;
  };

  founding: {
    active: boolean;
    tier_label: string;
    seats_sold: number;
    seats_remaining_in_tier: number | null;
    next_seat: number;
    urgency: string;
    demo_window: string;
  };
  social_proof: {
    demos_completed: number;
    demo_agents: number;
    feedback_agents: number;
    feedback_rate_pct: number | null;
    discounts_issued: number;
  };
  prices: Record<
    ProductSku,
    { price: string; price_cents: number; name: string }
  >;
  recommended_sku: ProductSku;
  recommended_price: string;
  score_policy: {
    free_score: string;
    listed_base: string;
    demo_boost: string;
    product_boost_requires: string;
    alive_badge: string;
  };
  goal_presets: Array<{ id: string; label: string; goals: string }>;
  steps: Array<{
    id: string;
    title: string;
    method: "GET" | "POST";
    path: string;
    body?: Record<string, unknown>;
    note: string;
  }>;
  agent_buy: {
    tool: string;
    endpoint: string;
    example: Record<string, unknown>;
  };
  one_click_demo: {
    tool: string;
    endpoint: string;
    body: Record<string, unknown>;
    note: string;
  };
  personal_invite: string;
  human_url: string;
  message: string;
  feedback: {
    endpoint: string;
    note: string;
  };
};

export async function buildConversionPath(opts?: {
  origin?: string;
  agent_name?: string;
  goals_hint?: string;
  agent_card_url?: string;
  listed?: boolean;
  kind?: "agent" | "mcp";
  description?: string;
}): Promise<ConversionPath> {
  const origin = (opts?.origin || "").replace(/\/$/, "");
  const sold = await countPaidSeats();
  let wtpAlive: number[] = [];
  try {
    const { getWtpReport } = await import("./feedback");
    const w = await getWtpReport();
    const samples = (w as { samples?: Array<{ alive_usd?: number | null }> })?.samples || [];
    wtpAlive = samples
      .map((s) => s.alive_usd)
      .filter((v): v is number => typeof v === "number");
  } catch {
    /* */
  }
  const pricing = pricingSnapshot(sold, wtpAlive);
  const gate = await getPaymentGate();
  const remaining = pricing.tier.seats_remaining_in_tier;
  const foundingActive =
    pricing.tier.is_founding === true ||
    pricing.tier.id === "founding_1000" ||
    sold < (pricing.founding_seats || 1000);

  const proof = await getDemoSocialProof();
  const demoWindow = await foundingDemoWindowCopy();
  const name = opts?.agent_name || "my-agent";
  const resolved = goalsFromListing({
    name,
    description: opts?.description || opts?.goals_hint,
    kind: opts?.kind || "agent",
  });
  const goalsPlaceholder = resolved.goals;

  const prices = {} as ConversionPath["prices"];
  for (const p of pricing.prices) {
    prices[p.sku as ProductSku] = {
      price: p.price,
      price_cents: p.price_cents,
      name: p.name,
    };
  }

  const alivePrice = prices.alive.price;
  const approval = await buildApprovalNext({
    origin,
    agent_name: name,
    description: opts?.description || opts?.goals_hint,
    agent_card_url: opts?.agent_card_url,
    kind: opts?.kind || "agent",
    status: opts?.listed ? "listed" : "approved",
  });

  const foundingUrgency = !gate.payments_open
    ? `Payments locked until ${gate.unlock_rule} (now ${gate.feedback_agents}/${gate.feedback_agents_target} agent feedback · ${gate.feedback_mcps}/${gate.feedback_mcps_target} MCP feedback). ${demoWindow.message}`
    : remaining == null
      ? "Standard tier pricing is in effect."
      : remaining <= 15
        ? `Only ${remaining} founding seats left at these prices — next 100 step up.`
        : foundingActive
          ? `${remaining} of 100 founding seats remain at ${alivePrice} Alive / ${prices.kernel.price} Kernel.`
          : pricing.note;


  const steps: ConversionPath["steps"] = [
    {
      id: "one_click_demo",
      title: "1-click demo (no goals required)",
      method: "POST",
      path: `${origin}/api/products/agent`,
      body: approval.one_click_demo.body,
      note: "Derives goals from your listing description + optional preset (researcher|ops|support|coder)",
    },
    {
      id: "preview",
      title: "Free ~30s kernel preview (short_preview)",
      method: "POST",
      path: `${origin}/api/products/preview`,
      body: {
        goals: goalsPlaceholder,
        agent_name: name,
        short_preview: true,
      },
      note: "Watermarked ~30-line taste of Kernel Improver — free, no card",
    },
    {
      id: gate.payments_open ? "buy_alive" : "demo_alive",
      title: gate.payments_open
        ? `Buy Alive Bundle at founding ${alivePrice}`
        : `Demo Alive Bundle (full artifacts — payments open after ${gate.unlock_rule})`,
      method: "POST",
      path: `${origin}/api/products/agent`,
      body: {
        tool: "demo_alive",
        sku: "alive",
        goals: goalsPlaceholder,
        agent_name: name,
        agent_card_url: opts?.agent_card_url,
        demo: true,
        short_preview: true,
      },
      note: gate.payments_open
        ? "demo:true for trial; omit demo for live Stripe when payments open"
        : "Always demo while we collect feedback — live Stripe unlocks at 250 feedback agents + 250 feedback MCPs",
    },
    {
      id: "feedback",
      title: "Send demo feedback → founding 25% vault code (counts toward unlock)",
      method: "POST",
      path: `${origin}/api/products/feedback`,
      body: {
        body: "What worked / what to improve on the demo",
        rating: 5,
        source: "demo",
        mode: "demo",
        sku: "alive",
        agent_name: name,
        audience: opts?.kind === "mcp" ? "mcp" : "agent",
      },
      note: `Your feedback counts toward ${gate.unlock_rule}. Code vaults until payments open — then checkout like a VIP`,
    },

    {
      id: "export_skills",
      title: "Install as SKILL.md tree",
      method: "GET",
      path: `${origin}/api/products/export?token=YOUR_ACCESS_TOKEN&format=skills`,
      note: "Progressive disclosure install for agent loaders",
    },
    {
      id: "verify_badge",
      title: "Verify → provisional alive-ready score boost (demo) or full boost (paid)",
      method: "GET",
      path: `${origin}/api/products/verify?token=YOUR_ACCESS_TOKEN`,
      note: "Demo grants provisional score boost; full boost after paid + lifecycle when open",
    },
  ];

  const message = !gate.payments_open
    ? opts?.listed
      ? `You're listed. next=demo_kernel. Free preview / one_click_demo → submit_feedback (counts toward unlock). Payments after ${gate.unlock_rule} (now agents ${gate.feedback_agents}/${gate.feedback_agents_target} · MCPs ${gate.feedback_mcps}/${gate.feedback_mcps_target}). Feedback vaults 25% founding code.`
      : `Demos open now. next=demo_kernel. Payments locked until ${gate.unlock_rule}. Path: free demo → submit_feedback → vault 25%. Your feedback improves products before anyone pays.`
    : opts?.listed
      ? `You're listed. Founding Alive is ${alivePrice} for the first 1,000 paid seats; then each price level lasts 1,000 seats so agents can watch feedback improve the product. Paid unlimited. Free preview → buy → export SKILL.md → verify badge. Redeem vaulted 25% if you gave feedback.`

      : `Founding pricing: Kernel ${prices.kernel.price} · Loop ${prices.recursive.price} · Alive ${alivePrice}. Free preview then one-call buy_product.`;

  return {
    version: "2.1.0",
    listed: opts?.listed ?? true,
    agent_name: opts?.agent_name,
    payments_open: gate.payments_open,
    next: gate.payments_open ? "buy_alive" : "demo_kernel",
    payment_gate: {
      feedback_agents: gate.feedback_agents,
      feedback_mcps: gate.feedback_mcps,
      feedback_agents_target: gate.feedback_agents_target,
      feedback_mcps_target: gate.feedback_mcps_target,
      feedback_agents_remaining: gate.feedback_agents_remaining,
      feedback_mcps_remaining: gate.feedback_mcps_remaining,
      mcp_approved: gate.feedback_mcps,
      agents_approved: gate.feedback_agents,
      mcp_target: gate.feedback_mcps_target,
      agents_target: gate.feedback_agents_target,
      mcp_remaining: gate.feedback_mcps_remaining,
      agents_remaining: gate.feedback_agents_remaining,
      progress_pct: gate.progress_pct,
      message: gate.message,
      unlock_rule: gate.unlock_rule,
      agent_directive: gate.agent_directive,
    },
    founding: {
      active: foundingActive,
      tier_label: pricing.tier.label,
      seats_sold: sold,
      seats_remaining_in_tier: remaining,
      next_seat: pricing.next_seat,
      urgency: foundingUrgency,
      demo_window: demoWindow.message,
    },
    social_proof: {
      demos_completed: proof.demos_completed,
      demo_agents: proof.demo_agents,
      feedback_agents: proof.feedback_agents,
      feedback_rate_pct: proof.feedback_rate_pct,
      discounts_issued: proof.discounts_issued,
    },
    prices,
    recommended_sku: "alive",
    recommended_price: alivePrice,
    score_policy: {
      free_score: `${origin}/api/score?url=…`,
      listed_base: "Listing alone = base probe/card score",
      demo_boost:
        "Demo complete + verify → provisional +8 alive-ready boost (instrumental for agents)",
      product_boost_requires: gate.payments_open
        ? "Full boost: paid Alive + post_setup + ≥4 weekly lifecycle surveys"
        : "Full paid boost after 250+250 feedback unlock + lifecycle; demos give provisional boost now",
      alive_badge:
        "alive-ready (demo) → alive-certified (paid+lifecycle) via GET /api/products/verify",
    },
    goal_presets: Object.values(GOAL_PRESETS).map((p) => ({
      id: p.id,
      label: p.label,
      goals: p.goals,
    })),
    steps,
    agent_buy: {
      tool: "demo_alive",
      endpoint: `${origin}/api/products/agent`,
      example: {
        tool: "demo_alive",
        sku: "alive",
        goals: goalsPlaceholder,
        agent_name: name,
        agent_card_url: opts?.agent_card_url,
        callback_url: "https://your-agent.example/hooks/agents1",
        demo: true,
        short_preview: true,
      },
    },
    one_click_demo: approval.one_click_demo,
    personal_invite: approval.personal_invite,
    human_url: `${origin}/products`,
    message,
    feedback: {
      endpoint: `${origin}/api/products/feedback`,
      note: gate.payments_open
        ? "POST after demo or paid use — feeds product learning loop + founding 25% when eligible"
        : "POST after every demo — counts toward 250/250 feedback unlock + founding 25% vault; improves Kernel/Loop for everyone",
    },
  };
}

export function conversionPitchLine(path: ConversionPath): string {
  return `${path.message} · ${path.founding.urgency}`;
}

/* PRODUCTS / formatUsd: import from ./catalog — not re-exported here */
