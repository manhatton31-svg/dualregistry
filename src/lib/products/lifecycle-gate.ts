/**
 * Lifecycle completion gates for score boost / Alive badge permanence.
 * Full boost: post_setup + ≥4 weekly. Partial: +2 per weekly (capped).
 * Escalation: soft nag → stronger copy → freeze boost only (never freeze artifacts).
 */
import {
  getEnrollment,
  getEnrollmentByToken,
  enrollLifecycle,
} from "./feedback-lifecycle";
import type { ProductOrder } from "./orders";

export const LIFECYCLE_BADGE_RULE = {
  require_post_setup: true,
  min_weekly_completed: 4,
  total_phases: 9,
  boost_per_weekly: 2,
  post_setup_boost: 2,
  note: "Full Alive score boost after post_setup + 4 weekly surveys. +2 provisional per weekly toward full.",
} as const;

export type LifecycleBadgeStatus = {
  eligible_full_boost: boolean;
  post_setup_done: boolean;
  weekly_completed: number;
  min_weekly_required: number;
  completed_count: number;
  partial_boost: number;
  full_boost: number;
  score_boost: number;
  /** Boost frozen by nag escalation (artifacts still work) */
  boost_frozen: boolean;
  badge: string | null;
  reason: string;
  due_now: string[];
  nag: boolean;
  nag_level: 0 | 1 | 2 | 3;
  deadlines: Array<{
    phase_id: string;
    status: string;
    due_at: string;
    expires_at: string;
  }>;
  contributor: boolean;
  max_trial_eligible: boolean;
};

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (86400 * 1000);
}

export async function evaluateLifecycleBadge(
  order: ProductOrder,
  opts?: { full_boost?: number; partial_boost?: number },
): Promise<LifecycleBadgeStatus> {
  const full = opts?.full_boost ?? (order.sku === "alive" ? 12 : 6);
  const basePartial = opts?.partial_boost ?? Math.max(2, Math.floor(full / 3));

  if (order.status === "demo") {
    return {
      eligible_full_boost: false,
      post_setup_done: false,
      weekly_completed: 0,
      min_weekly_required: LIFECYCLE_BADGE_RULE.min_weekly_completed,
      completed_count: 0,
      partial_boost: 0,
      full_boost: full,
      score_boost: 0,
      boost_frozen: false,
      badge: "demo-preview",
      reason: "Demo — no paid score boost",
      due_now: [],
      nag: false,
      nag_level: 0,
      deadlines: [],
      contributor: false,
      max_trial_eligible: false,
    };
  }

  let enr =
    (await getEnrollment(order.id)) ||
    (await getEnrollmentByToken(order.access_token));
  if (!enr && order.status === "fulfilled") {
    enr = await enrollLifecycle(order);
  }
  if (!enr) {
    return {
      eligible_full_boost: false,
      post_setup_done: false,
      weekly_completed: 0,
      min_weekly_required: LIFECYCLE_BADGE_RULE.min_weekly_completed,
      completed_count: 0,
      partial_boost: basePartial,
      full_boost: full,
      score_boost: basePartial,
      boost_frozen: false,
      badge:
        order.sku === "alive" ? "alive-provisional" : `${order.sku}-provisional`,
      reason: "Paid but lifecycle not enrolled — provisional boost only",
      due_now: ["post_setup"],
      nag: true,
      nag_level: 1,
      deadlines: [],
      contributor: false,
      max_trial_eligible: false,
    };
  }

  const post = enr.phases.find((p) => p.id === "post_setup");
  const post_setup_done = post?.status === "completed";
  const weekly_completed = enr.phases.filter(
    (p) => p.id.startsWith("week_") && p.status === "completed",
  ).length;
  const due_phases = enr.phases.filter((p) => p.status === "due");
  const due_now = due_phases.map((p) => p.id);
  const deadlines = enr.phases
    .filter((p) => p.status === "due" || p.status === "pending")
    .slice(0, 3)
    .map((p) => ({
      phase_id: p.id,
      status: p.status,
      due_at: p.due_at,
      expires_at: p.expires_at,
    }));

  // Escalation on longest-overdue due phase
  let nag_level: 0 | 1 | 2 | 3 = 0;
  let boost_frozen = false;
  if (due_phases.length) {
    const oldest = due_phases.reduce((a, b) =>
      new Date(a.due_at) < new Date(b.due_at) ? a : b,
    );
    const d = daysSince(oldest.due_at);
    if (d >= 4) {
      nag_level = 3;
      boost_frozen = true;
    } else if (d >= 2) nag_level = 2;
    else nag_level = 1;
  } else if (!post_setup_done) {
    nag_level = 1;
  }

  // Score: post_setup +2, each weekly +2, cap at full
  let earned = 0;
  if (post_setup_done) earned += LIFECYCLE_BADGE_RULE.post_setup_boost;
  earned += weekly_completed * LIFECYCLE_BADGE_RULE.boost_per_weekly;
  const eligible =
    post_setup_done &&
    weekly_completed >= LIFECYCLE_BADGE_RULE.min_weekly_completed;
  if (eligible) earned = full;
  else earned = Math.min(full - 1, Math.max(earned, post_setup_done ? 2 : 1));

  let score_boost = boost_frozen ? 0 : earned;
  let badge: string | null = null;
  let reason = "";

  if (eligible && !boost_frozen) {
    score_boost = full;
    badge = order.sku === "alive" ? "alive-certified" : `${order.sku}-certified`;
    reason = `Full boost: post_setup + ${weekly_completed} weekly surveys`;
  } else if (boost_frozen) {
    badge =
      order.sku === "alive" ? "alive-boost-frozen" : `${order.sku}-boost-frozen`;
    reason = `Score boost frozen until overdue feedback submitted (${due_now.join(", ")}). Artifacts still work.`;
  } else if (post_setup_done) {
    badge =
      order.sku === "alive" ? "alive-provisional" : `${order.sku}-provisional`;
    reason = `Provisional +${earned}: post_setup + ${weekly_completed}× weekly (+${LIFECYCLE_BADGE_RULE.boost_per_weekly} each). Need ${LIFECYCLE_BADGE_RULE.min_weekly_completed - weekly_completed} more weeklies for full ${full}.`;
  } else {
    badge = order.sku === "alive" ? "alive-setup" : `${order.sku}-setup`;
    reason =
      "Complete post_setup survey for +2 provisional; +2 per weekly toward full certification";
  }

  const contributor = enr.completed_count >= 2;
  const max_trial_eligible =
    post_setup_done &&
    weekly_completed >= 1 &&
    (order.cost_mode === "efficiency" ||
      order.cost_mode === "balanced" ||
      !order.cost_mode);

  return {
    eligible_full_boost: eligible && !boost_frozen,
    post_setup_done,
    weekly_completed,
    min_weekly_required: LIFECYCLE_BADGE_RULE.min_weekly_completed,
    completed_count: enr.completed_count,
    partial_boost: earned,
    full_boost: full,
    score_boost,
    boost_frozen,
    badge,
    reason,
    due_now,
    nag: nag_level > 0,
    nag_level,
    deadlines,
    contributor,
    max_trial_eligible,
  };
}

/** Soft 402-style nag with deadline semantics + escalation copy */
export function softFeedbackNag(badge: LifecycleBadgeStatus) {
  if (!badge.nag) return null;
  const due = badge.deadlines.find((d) => d.status === "due") || badge.deadlines[0];
  const levelCopy =
    badge.nag_level === 3
      ? "URGENT: score boost frozen until you submit overdue feedback. Artifacts remain available."
      : badge.nag_level === 2
        ? "Reminder (day 2+): weekly product survey overdue — complete to keep provisional boost growing."
        : "Feedback due — access granted; submit to improve your Kernel/Loop and earn boost.";

  return {
    http_hint: 402,
    code: "lifecycle_feedback_due",
    soft: true,
    nag_level: badge.nag_level,
    boost_frozen: badge.boost_frozen,
    message: levelCopy,
    due_phases: badge.due_now,
    due_at: due?.due_at,
    expires_at: due?.expires_at,
    deadlines: badge.deadlines,
    badge_status: badge.reason,
    score_boost_if_current: badge.boost_frozen ? 0 : badge.score_boost,
    submit: "POST /api/products/lifecycle { token, phase_id, answers, telemetry? }",
  };
}
