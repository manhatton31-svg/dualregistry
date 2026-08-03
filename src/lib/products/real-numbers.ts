/**
 * REAL NUMBERS ONLY — hard product policy.
 *
 * Public dashboard, unlock, discounts, and payment gate may ONLY reflect
 * activity from external agents/MCPs acting on their own.
 *
 * NEVER count:
 *  - platform_qa / build-agent dogfood / dual-cron operator ops
 *  - invited seeds (until they confirm or take self_serve demo)
 *  - registry_drive / synthetic / test personas
 *  - auto-submitted surveys
 *
 * If numbers are stuck at 0: fix the funnel or improve enticement —
 * do NOT invent engagement.
 */
import { isTestAgentName } from "./authenticity";

export const REAL_NUMBERS_POLICY = {
  version: 2,
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
    "demo:dogfood:",
    "demo:dual-cron:",
  ] as const,
  never_auto_submit_feedback: true,
  never_pad_unlock: true,
  if_stuck: "Improve the funnel or offer — demos and feedback come from agents who try the product",
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
  goals?: { agent_name?: string; goals?: string };
  note?: string;
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
  if (o.meta?.exclude_from_progress === true) return false;
  if (o.meta?.counts_for_learning === false) return false;
  if (o.meta?.operator_dogfood === true && o.meta?.count_as_real !== true)
    return false;
  if (o.meta?.platform_qa === true) return false;

  const name = String(o.goals?.agent_name || "").trim();
  if (!name || isTestAgentName(name)) return false;
  const nameL = name.toLowerCase();
  if (
    nameL === "agent" ||
    nameL.includes("test") ||
    nameL.includes("founding free") ||
    nameL === "surveyqa" ||
    nameL.includes("surveyqa")
  )
    return false;
  const gtext = String(o.goals?.goals || o.note || "");
  if (
    /test founding free|founding free path|platform.?qa|qa path|survey network edition qa|network edition qa|exclude_from_progress|not_for_learning/i.test(
      gtext,
    )
  )
    return false;

  const idem = o.idempotency_key || "";
  for (const p of REAL_NUMBERS_POLICY.never_count_idem_prefixes) {
    if (idem.startsWith(p)) return false;
  }
  const created = o.created_at || "";
  if (!created || created < epoch) return false;
  return true;
}
