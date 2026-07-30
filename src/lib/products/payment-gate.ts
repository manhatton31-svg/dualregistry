/**
 * Live payments stay closed until we have enough real product feedback:
 *   250 feedback agents + 250 feedback MCPs
 * Demos, free preview, and feedback surveys stay open. Founding 25% codes
 * vault until unlock. Agents/MCPs are told this on every entry surface.
 */
import { getProductEngagement } from "./engagement";

/** Feedback required before Stripe opens (not registry approved counts). */
export const PAYMENT_UNLOCK_TARGET = {
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
    requires: string;
    redeem_when: string;
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
    // aliases → feedback progress (so old fields still drive the gate UI)
    mcp_approved: feedback_mcps,
    agents_approved: feedback_agents,
    mcp_target: mcpT,
    agents_target: agentsT,
    mcp_remaining: feedback_mcps_remaining,
    agents_remaining: feedback_agents_remaining,
    progress_pct,
    reason: payments_open
      ? "feedback_milestones_met"
      : "waiting_for_250_feedback_agents_and_250_feedback_mcps",
    message: payments_open
      ? `Payments open — ${feedback_agents} feedback agents / ${feedback_mcps} feedback MCPs (target ${agentsT}/${mcpT}). Founding prices for first 1,000 paid seats; then each level lasts 1,000 seats. 25% codes redeemable at checkout.`
      : `Payments locked until ${agentsT} feedback agents + ${mcpT} feedback MCPs. Now ${feedback_agents}/${agentsT} agent feedback · ${feedback_mcps}/${mcpT} MCP feedback. Demos unlimited · give feedback → 25% founding code vaulted until unlock. Founding prices for first 1,000 paid seats; next levels last 1,000 seats each.`,
    policy:
      "Only real agent/MCP product surveys count toward unlock (synthetic registry_drive auto-feedback is disabled). Demo first, improve Kernel/Loop from real feedback, then sell founding seats (first 1,000 at launch prices; each later price level lasts 1,000 paid seats).",
    unlock_rule,
    agent_directive: payments_open
      ? "payments_open — buy_product with goals; redeem vaulted 25% discount_code if you gave feedback"
      : `payments_locked — demo_alive or demo_mcp free now → submit_feedback → vault 25% code. Unlock at ${unlock_rule}. Your feedback improves Kernel Improver + Recursive Loop before anyone pays.`,
    founding_discount: {
      percent_off: 25,
      requires: "complete demo feedback survey",
      redeem_when: payments_open
        ? "now_at_checkout"
        : "when_payments_open_after_feedback_milestones",
    },
  };
}

export async function paymentsOpen(): Promise<boolean> {
  return (await getPaymentGate()).payments_open;
}

/** One-line copy for agent cards, discovery, tools, list receipts */
export function paymentGateOneLiner(gate?: PaymentGate | null): string {
  if (gate?.payments_open) {
    return "Payments open. Founding 25% codes redeemable. Kernel $14.99 · Loop $19.99 · Alive $29.99.";
  }
  return "Payments locked until 250 feedback agents + 250 feedback MCPs. Demos free now — feedback unlocks a 25% founding discount.";
}
