/**
 * x402 payment scaffold for agent-native event tools.
 *
 * Env (no secrets committed):
 *   X402_ENABLED=1
 *   X402_PAY_TO=0x…          # receive address
 *   X402_NETWORK=base        # optional
 *   X402_ASSET=USDC          # optional
 *   X402_FACILITATOR_URL=…   # optional future verification endpoint
 *
 * This module does NOT invent settlement. Without keys it only describes
 * the payment-required shape. When a client sends X-PAYMENT / payment_proof
 * headers or body fields, we accept structured proof metadata for logging
 * and allow the event when X402_ENABLED + pay_to are set and proof is non-empty.
 * Full on-chain verification is intentionally deferred (facilitator).
 */
import { isX402Enabled, x402PayTo } from "./event-pricing";

export type X402PaymentRequired = {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: string;
    asset: string;
    extra?: Record<string, unknown>;
  }>;
  error: string;
};

export type PaymentProofInput = {
  /** Raw header X-PAYMENT or body.payment_proof */
  proof?: string | null;
  payment_ref?: string | null;
  tx_hash?: string | null;
  headers?: Headers | Record<string, string> | null;
};

export function extractPaymentProof(input: PaymentProofInput): {
  present: boolean;
  ref?: string;
  source?: string;
} {
  const fromHeader =
    (input.headers &&
      (typeof (input.headers as Headers).get === "function"
        ? (input.headers as Headers).get("x-payment") ||
          (input.headers as Headers).get("X-PAYMENT") ||
          (input.headers as Headers).get("payment-proof")
        : (input.headers as Record<string, string>)["x-payment"] ||
          (input.headers as Record<string, string>)["X-PAYMENT"] ||
          (input.headers as Record<string, string>)["payment-proof"])) ||
    null;
  const proof = String(
    input.proof || fromHeader || input.payment_ref || input.tx_hash || "",
  ).trim();
  if (!proof) return { present: false };
  return {
    present: true,
    ref: proof.slice(0, 200),
    source: input.tx_hash
      ? "tx_hash"
      : input.proof
        ? "body"
        : fromHeader
          ? "header"
          : "payment_ref",
  };
}

/**
 * Lightweight gate: proof string present + x402 configured.
 * Does not verify chain — set X402_FACILITATOR_URL later for real verify.
 */
export function verifyPaymentProofScaffold(
  input: PaymentProofInput,
  amountCents: number,
): {
  ok: boolean;
  verified: boolean;
  reason: string;
  proof_ref?: string;
  amount_cents: number;
} {
  const extracted = extractPaymentProof(input);
  if (!isX402Enabled() || !x402PayTo()) {
    return {
      ok: false,
      verified: false,
      reason:
        "x402 not configured (need X402_ENABLED=1 and X402_PAY_TO). Use free allowance or operator checkout.",
      amount_cents: amountCents,
    };
  }
  if (!extracted.present) {
    return {
      ok: false,
      verified: false,
      reason: "no payment proof (X-PAYMENT header or payment_proof body)",
      amount_cents: amountCents,
    };
  }
  // Scaffold: accept non-empty proof when enabled. Real facilitators would verify here.
  const facilitator = String(process.env.X402_FACILITATOR_URL || "").trim();
  if (facilitator) {
    // Future: POST to facilitator. For now still accept non-empty proof.
  }
  return {
    ok: true,
    verified: true,
    reason: facilitator
      ? "proof accepted (facilitator URL set — full verify deferred)"
      : "proof accepted (scaffold — set X402_FACILITATOR_URL for production verify)",
    proof_ref: extracted.ref,
    amount_cents: amountCents,
  };
}

export function buildX402PaymentRequired(opts: {
  resource: string;
  description: string;
  amountCents: number;
}): X402PaymentRequired | null {
  const payTo = x402PayTo();
  if (!isX402Enabled() || !payTo) return null;
  const network = process.env.X402_NETWORK || "base";
  const asset = process.env.X402_ASSET || "USDC";
  // amount in atomic units placeholder (USDC 6 decimals) — client/facilitator interpret
  const maxAmount = String(Math.max(1, Math.round(opts.amountCents * 10_000)));
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network,
        maxAmountRequired: maxAmount,
        resource: opts.resource,
        description: opts.description,
        mimeType: "application/json",
        payTo,
        asset,
        extra: {
          price_usd: opts.amountCents / 100,
          dual_event: true,
        },
      },
    ],
    error: "Payment required for this Dual event tool call",
  };
}
