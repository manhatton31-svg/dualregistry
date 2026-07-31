/**
 * Real-participant filters — payment unlock, engagement, WTP, theme ship
 * only count EXTERNAL agents/MCPs (not build-agent dogfood, registry drive, or tests).
 */

const TEST_NAME_RE =
  /^(peer\d*|nagtest|funneltest|mesh-\d+|paidcycle|closedloop|fb-driven|pricetest|sota-agent|feedbackcheck|postfeedback|teltest|clarityship|prefstack|ab-peer|test[-_]?agent|integrity(?:smoke)?|closerate|smoketest|mailtest|zeropay|closerateagent|wtpbot|feedbackbot|founding free test|founding.?free.?test.?agent|operatordogfood[-_].*)$/i;

/** Legacy auto-drive template surveys (MCP install kit / agent persona spam) */
const TEMPLATE_BODY_RE =
  /As (MCP publisher|agent) .+: (install kit helped|need clearer install|want shorter system_prompt|still want clearer agent-facing)/i;

export function isTestAgentName(name: string | undefined | null): boolean {
  if (!name) return false;
  return TEST_NAME_RE.test(String(name).trim());
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
  if (/test founding free|founding free path|platform.?qa/i.test(String(item.body || "")))
    return true;
  if (item.meta?.registry_drive === true) return true;
  if (item.meta?.synthetic === true) return true;
  if (item.meta?.platform_dogfood === true) return true;
  if (item.meta?.not_external === true) return true;
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
  }
  if (
    item.source === "platform_qa" ||
    item.source === "registry_drive" ||
    item.source === "operator_dogfood"
  )
    return true;
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
