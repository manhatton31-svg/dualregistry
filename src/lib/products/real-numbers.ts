/**
 * REAL NUMBERS ONLY — hard product policy.
 *
 * Public dashboard, unlock, discounts, and payment gate may ONLY reflect
 * activity from external agents/MCPs acting on their own.
 *
 * NEVER count:
 *  - platform_qa / build-agent dogfood
 *  - invited seeds (until they confirm or take self_serve demo)
 *  - registry_drive / synthetic / test personas
 *  - auto-submitted surveys
 *
 * If numbers are stuck at 0: fix the funnel or improve enticement —
 * do NOT invent engagement.
 */
export const REAL_NUMBERS_POLICY = {
  version: 1,
  rule: "only_real_external_actors",
  public_demo_origins: ["self_serve", "organic"] as const,
  never_count_demo_origins: [
    "invited",
    "platform_qa",
    "seed",
    "registry_drive",
  ] as const,
  never_count_idem_prefixes: [
    "demo:probe-ok:",
    "demo:seed:",
    "demo:invite:",
    "demo:drive:",
    "demo:qa:",
  ] as const,
  never_auto_submit_feedback: true,
  never_pad_unlock: true,
  if_stuck: "fix funnel or improve enticement — never invent demos/feedback",
} as const;

export function assertRealNumbersPolicy(): typeof REAL_NUMBERS_POLICY {
  return REAL_NUMBERS_POLICY;
}

/** True when an order may appear on the public engagement card. */
export function isPublicCountableDemo(o: {
  status?: string;
  demo_origin?: string;
  idempotency_key?: string;
  created_at?: string;
  meta?: Record<string, unknown>;
}, epoch: string): boolean {
  if (o.status !== "demo" && o.status !== "paid" && o.status !== "fulfilled")
    return false;
  const origin = o.demo_origin || "";
  if (
    (REAL_NUMBERS_POLICY.never_count_demo_origins as readonly string[]).includes(
      origin,
    )
  )
    return false;
  if (
    !(REAL_NUMBERS_POLICY.public_demo_origins as readonly string[]).includes(
      origin,
    )
  )
    return false;
  if (o.meta?.platform_dogfood === true || o.meta?.not_external === true)
    return false;
  const idem = o.idempotency_key || "";
  for (const p of REAL_NUMBERS_POLICY.never_count_idem_prefixes) {
    if (idem.startsWith(p)) return false;
  }
  const created = o.created_at || "";
  if (!created || created < epoch) return false;
  return true;
}
