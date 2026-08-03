/**
 * Live card payments stay closed until we have enough real product feedback:
 *   10 feedback agents + 5 feedback MCPs (signal gate — was 250/250)
 * Network-scale milestone 250/250 remains aspirational, not the payment lock.
 * Demos + feedback stay open. First 100 agents/MCPs (combined) who demo+feedback
 * get 100% off full product immediately. After that, 25% codes vault until unlock.
 */
import { getProductEngagement } from "./engagement";

/** Feedback required before Stripe opens (not registry approved counts). */
export const PAYMENT_UNLOCK_TARGET = {
  feedback_agents: 10,
  feedback_mcps: 5,
} as const;

/** Aspirational network milestone (not the card-payment lock). */
export const NETWORK_SCALE_MILESTONE = {
  feedback_agents: 250,
  feedback_mcps: 250,
} as const;

export type PaymentGate = {
  payments_open: boolean;
  demo_open: true;
  feedback_open: true;
  preview_open: true;
  /** Feedback-agent count toward unlock */
  feedback_agents: number;
  feedback_mcps: number;
  feedback_agents_target: number;
  feedback_mcps_target: number;
  feedback_agents_remaining: number;
  feedback_mcps_remaining: number;
  /**
   * Backward-compat aliases used by older UIs / agents.
   * These map to feedback counts (not registry approved).
   */
  mcp_approved: number;
  agents_approved: number;
  mcp_target: number;
  agents_target: number;
  mcp_remaining: number;
  agents_remaining: number;
  progress_pct: number;
  reason: string;
  message: string;
  policy: string;
  unlock_rule: string;
  /** Short agent directive for cards / tools */
  agent_directive: string;
  founding_discount: {
    percent_off: number;
    free_seats: number;
    free_remaining?: number;
    requires: string;
    redeem_when: string;
  };
  founding_free?: {
    seats: number;
    claimed: number;
    remaining: number;
    percent_off: number;
    open: boolean;
    rule: string;
  };
};

export async function getPaymentGate(): Promise<PaymentGate> {
  const eng = await getProductEngagement().catch(() => null);

  const feedback_agents = Math.max(
    0,
    eng?.feedback_agent_only ?? eng?.feedback_agents ?? 0,
  );
  const feedback_mcps = Math.max(0, eng?.feedback_mcps ?? 0);
  const agentsT = PAYMENT_UNLOCK_TARGET.feedback_agents;
  const mcpT = PAYMENT_UNLOCK_TARGET.feedback_mcps;

  const payments_open =
    feedback_agents >= agentsT && feedback_mcps >= mcpT;
  const feedback_agents_remaining = Math.max(0, agentsT - feedback_agents);
  const feedback_mcps_remaining = Math.max(0, mcpT - feedback_mcps);
  const progress_pct =
    Math.round(
      ((Math.min(feedback_agents, agentsT) / agentsT +
        Math.min(feedback_mcps, mcpT) / mcpT) /
        2) *
        1000,
    ) / 10;

  const unlock_rule = `${agentsT} feedback agents + ${mcpT} feedback MCPs`;

  let founding_free: PaymentGate["founding_free"];
  try {
    const { getFoundingFreePublic } = await import("./founding-free");
    founding_free = await getFoundingFreePublic();
  } catch {
    founding_free = {
      seats: 100,
      claimed: 0,
      remaining: 100,
      percent_off: 100,
      open: true,
      rule: "First 100 demo+feedback → 100% off full product",
    };
  }

  return {
    payments_open,
    demo_open: true,
    feedback_open: true,
    preview_open: true,
    feedback_agents,
    feedback_mcps,
    feedback_agents_target: agentsT,
    feedback_mcps_target: mcpT,
    feedback_agents_remaining,
    feedback_mcps_remaining,
    mcp_approved: feedback_mcps,
    agents_approved: feedback_agents,
    mcp_target: mcpT,
    agents_target: agentsT,
    mcp_remaining: feedback_mcps_remaining,
    agents_remaining: feedback_agents_remaining,
    progress_pct,
    reason: payments_open
      ? "feedback_milestones_met"
      : "waiting_for_10_feedback_agents_and_5_feedback_mcps",
    message: payments_open
      ? `Payments open — ${feedback_agents} feedback agents / ${feedback_mcps} feedback MCPs (target ${agentsT}/${mcpT}). Founding prices for first 1,000 paid seats.`
      : `Card payments locked until ${agentsT} feedback agents + ${mcpT} feedback MCPs (now ${feedback_agents}/${agentsT} · ${feedback_mcps}/${mcpT}). First ${founding_free?.seats ?? 100} agents/MCPs combined who demo + feedback get 100% off full product now (${founding_free?.remaining ?? 100} free seats left). After that, 25% codes vault until unlock.`,
    policy:
      "Demo free → real feedback. First 100 combined agents/MCPs: 100% off full product immediately + lifecycle surveys. Then 25% until 10 agent + 5 MCP feedback opens card payments. No synthetic feedback.",
    unlock_rule,
    agent_directive: payments_open
      ? "payments_open — buy_product with goals; redeem discount_code if you have one"
      : `demo_alive or demo_mcp free → submit_feedback. First 100 combined get 100% full product now (${founding_free?.remaining ?? 100} left). Else 25% vault until ${unlock_rule}.`,
    founding_discount: {
      percent_off: founding_free?.open ? 100 : 25,
      free_seats: founding_free?.seats ?? 100,
      free_remaining: founding_free?.remaining,
      requires: "complete demo then real feedback survey",
      redeem_when: founding_free?.open
        ? "immediately_100_percent_full_product"
        : payments_open
          ? "now_at_checkout_25_percent"
          : "when_payments_open_after_feedback_milestones",
    },
    founding_free,
  };
}

export async function paymentsOpen(): Promise<boolean> {
  return (await getPaymentGate()).payments_open;
}

/** One-line copy for agent cards, discovery, tools, list receipts */
export function paymentGateOneLiner(gate?: PaymentGate | null): string {
  if (gate?.payments_open) {
    return "Payments open. Kernel $14.99 · Loop $19.99 · Alive $29.99. Redeem feedback codes at checkout.";
  }
  const left = gate?.founding_free?.remaining ?? 100;
  return `First 100 agents/MCPs combined: demo + feedback = 100% off full product (${left} free seats left). Card payments later at 10 agent + 5 MCP feedback.`;
}
