/**
 * Real-participant filters — payment unlock, engagement, WTP, theme ship
 * only count EXTERNAL agents/MCPs (not build-agent dogfood, registry drive, or tests).
 */

const TEST_NAME_RE =
  /^(peer\d*|nagtest|funneltest|mesh-\d+|paidcycle|closedloop|fb-driven|pricetest|sota-agent|feedbackcheck|postfeedback|teltest|clarityship|prefstack|ab-peer|test[-_]?agent|integrity(?:smoke)?|closerate|smoketest|mailtest|zeropay|closerateagent|wtpbot|feedbackbot|founding free test|founding.?free.?test.?agent|operatordogfood[-_].*|surveyqa|dogfood(?:[-_].*)?|dual[-_]?cron(?:[-_].*)?|platform[-_]?qa(?:[-_].*)?)$/i;

/** Prefixes / substrings that mark operator / platform / dogfood (never public unlock). */
const INTERNAL_NAME_MARKERS = [
  "dogfood",
  "dual-cron",
  "dualcron",
  "platform_qa",
  "platform-qa",
  "registry-drive",
  "registry_drive",
  "operatorsmoke",
  "build-agent",
  "buildagent",
  "collab-probe",
  "collab_probe",
  "pricingprobe",
  "pricing-probe",
  "pricesignal",
  "price-signal",
  "fairpriceagent",
  "fairprice",
  "wtpagent",
  "wtpmcp",
  "wtphuman",
  "wtprefresh",
  "prod-gtm",
  "gtm-verify",
  "gtm_verify",
  "operator_try",
  "operator-try",
];

/** Legacy auto-drive template surveys (MCP install kit / agent persona spam) */
const TEMPLATE_BODY_RE =
  /As (MCP publisher|agent) .+: (install kit helped|need clearer install|want shorter system_prompt|still want clearer agent-facing)/i;

/** Sources that may store feedback but never move the payment unlock bar. */
const NON_UNLOCK_SOURCES = new Set([
  "platform_qa",
  "registry_drive",
  "operator_dogfood",
  "dual_cron",
  "operator",
  "operator_try",
  "operator_smoke",
  "build_agent",
  "build-agent",
  "qa",
  "pricing_test",
  "ship_verify",
]);

export function isTestAgentName(name: string | undefined | null): boolean {
  if (!name) return false;
  const raw = String(name).trim();
  if (TEST_NAME_RE.test(raw)) return true;
  const n = raw.toLowerCase();
  for (const m of INTERNAL_NAME_MARKERS) {
    if (n === m || n.startsWith(m + "-") || n.startsWith(m + "_") || n.includes(m))
      return true;
  }
  // Pricing / collab lab self-tests
  if (/^wtp[a-z]*\d*$/i.test(raw)) return true;
  if (/^fairprice/i.test(raw)) return true;
  if (/^pricesignal/i.test(raw)) return true;
  if (/probe[-_]/i.test(raw) || /[-_]probe$/i.test(raw)) return true;
  return false;
}

export function isSyntheticFeedback(item: {
  agent_name?: string | null;
  tags?: string[] | null;
  meta?: Record<string, unknown> | null;
  body?: string | null;
  source?: string | null;
}): boolean {
  if (isTestAgentName(item.agent_name)) return true;
  const name = String(item.agent_name || "").trim().toLowerCase();
  if (name === "agent" || name === "founding free test agent") return true;
  if (name === "surveyqa" || name.includes("surveyqa")) return true;
  if (
    /test founding free|founding free path|platform.?qa|qa path|survey network edition qa|exclude_from_progress|not_for_learning/i.test(
      String(item.body || ""),
    )
  )
    return true;

  if (item.meta?.registry_drive === true) return true;
  if (item.meta?.synthetic === true) return true;
  if (item.meta?.platform_dogfood === true) return true;
  if (item.meta?.not_external === true) return true;
  if (item.meta?.exclude_from_progress === true) return true;
  if (item.meta?.counts_for_learning === false) return true;
  if (item.meta?.unlock_count === false) return true;
  // operator dogfood only counts when meta.count_as_real === true
  if (
    item.meta?.operator_dogfood === true &&
    item.meta?.count_as_real !== true
  )
    return true;
  if (item.meta?.drive && String(item.meta.drive).includes("feedback-drive"))
    return true;
  if (Array.isArray(item.tags)) {
    if (item.tags.includes("registry_drive")) return true;
    if (item.tags.includes("synthetic")) return true;
    if (item.tags.includes("platform_qa")) return true;
    if (item.tags.includes("funnel_complete")) return true; // bulk build-agent batch
    if (item.tags.includes("dogfood")) return true;
    if (item.tags.includes("not_for_learning")) return true;
    if (item.tags.includes("exclude_from_progress")) return true;
    if (item.tags.includes("dual_cron")) return true;
    if (item.tags.includes("operator")) return true;
    if (item.tags.includes("operator_try")) return true;
    if (item.tags.includes("pricing_test")) return true;
    if (item.tags.includes("ship_verify")) return true;
  }
  const src = String(item.source || "")
    .trim()
    .toLowerCase();
  if (NON_UNLOCK_SOURCES.has(src)) return true;
  // operator_dogfood_real is allowed through (explicit count_as_real path)
  const body = item.body || "";
  if (body.includes("registry_drive persona")) return true;
  if (TEMPLATE_BODY_RE.test(body)) return true;
  if (body.includes("install kit helped") && body.includes("tool policy"))
    return true;
  if (body.includes("post-demo: clarity=") && body.includes("·")) {
    // Pattern used by platform bulk feedback script
    if (/post-demo: clarity=\d+\/5/.test(body)) return true;
  }
  if (/^EDIT:\s*one sentence/i.test(body.trim())) return true;
  if (/REPLACE_WITH_REAL/i.test(body)) return true;
  return false;
}

export function isRealFeedback(item: {
  agent_name?: string | null;
  tags?: string[] | null;
  meta?: Record<string, unknown> | null;
  body?: string | null;
  source?: string | null;
}): boolean {
  return !isSyntheticFeedback(item);
}

/**
 * Stricter gate for payment unlock + public funnel progress.
 * Only external agents/MCPs acting on their own — never operator /try,
 * ship probes, pricing self-tests, or platform QA.
 *
 * registry-tool leave_feedback from a real external agent still counts
 * (MCP is the intended path). Internal probe names and operator sources do not.
 */
export function isExternalUnlockFeedback(item: {
  agent_name?: string | null;
  tags?: string[] | null;
  meta?: Record<string, unknown> | null;
  body?: string | null;
  source?: string | null;
}): boolean {
  if (!isRealFeedback(item)) return false;
  const src = String(item.source || "")
    .trim()
    .toLowerCase();
  // Explicit operator paths never move unlock (even if someone omitted tags)
  if (
    src === "operator_try" ||
    src === "operator" ||
    src === "operator_smoke" ||
    src === "ship_verify" ||
    src === "pricing_test"
  )
    return false;
  if (item.meta?.operator_try === true) return false;
  if (item.meta?.count_as_real === false) return false;
  if (item.meta?.external === false) return false;
  // Tags that mark internal verification
  if (Array.isArray(item.tags)) {
    for (const t of item.tags) {
      const tl = String(t).toLowerCase();
      if (
        tl === "operator_try" ||
        tl === "ship_verify" ||
        tl === "pricing_test" ||
        tl === "internal" ||
        tl === "not_external"
      )
        return false;
    }
  }
  return true;
}

/** Public demo origins that may count (still need epoch + not seed idem). */
export function isPublicDemoOrigin(origin: string | undefined | null): boolean {
  return origin === "self_serve" || origin === "organic";
}

/** Origins that never count on the public dashboard. */
export function isNonPublicDemoOrigin(origin: string | undefined | null): boolean {
  return (
    origin === "invited" ||
    origin === "platform_qa" ||
    origin === "seed" ||
    origin === "registry_drive"
  );
}
