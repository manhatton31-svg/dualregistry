/**
 * Paid-agent lifecycle feedback: post-setup + 8 weekly surveys.
 * Decides system-wide vs individualized changes; estimates cost impact.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { dataRoot } from "@/lib/data-root";
import {
  LIFECYCLE_PHASES,
  LIFECYCLE_POLICY,
  getPhase,
  phaseDueAt,
  phaseExpiresAt,
  adaptiveQuestions,
  type LifecyclePhaseId,
} from "./lifecycle-surveys";
import { type SurveyAnswers } from "./feedback-survey";
import { trackFunnel } from "./learning-loop";
import { upsertPersonalization } from "./personalization";
import {
  SYSTEM_THEME_THRESHOLD,
  HIGH_SEVERITY_COUNT,
  upsertSystemCandidate,
} from "./system-ship";
import { clusterThemes, themeIds } from "./theme-cluster";
import {
  normalizeTelemetry,
  telemetryThemes,
  telemetrySummaryLine,
  type AgentTelemetry,
  type NormalizedTelemetry,
} from "./telemetry";
import { recordChange, changesForOrder, formatChangeMessage } from "./change-log";
import type { ProductOrder } from "./orders";

const PATH = join(dataRoot(), "products", "lifecycle.json");

export type PhaseStatus = "pending" | "due" | "completed" | "skipped" | "expired";

export type LifecyclePhaseState = {
  id: LifecyclePhaseId;
  status: PhaseStatus;
  due_at: string;
  expires_at: string;
  completed_at?: string;
  response_id?: string;
};

export type LifecycleEnrollment = {
  order_id: string;
  agent_name?: string;
  agent_card_url?: string;
  sku: string;
  access_token: string;
  enrolled_at: string;
  paid: boolean;
  phases: LifecyclePhaseState[];
  completed_count: number;
  next_due?: LifecyclePhaseId;
};

export type ScopeDecision =
  | "individualize"
  | "system_wide_candidate"
  | "hybrid"
  | "observe_only";

export type LifecycleResponse = {
  id: string;
  order_id: string;
  phase_id: LifecyclePhaseId;
  created_at: string;
  answers: SurveyAnswers;
  rating?: number;
  scope_preference?: string;
  decision: {
    scope: ScopeDecision;
    reason: string;
    system_themes: string[];
    individual_actions: string[];
    confidence: number;
  };
  impact: ImpactEstimate;
  personalization_applied: boolean;
  telemetry?: NormalizedTelemetry | null;
  score_dip?: boolean;
  we_changed: string[];
  max_trial_granted?: boolean;
};

export type ImpactEstimate = {
  /** Relative token/cost if system changes applied globally (1 = no change) */
  system_cost_multiplier: number;
  /** Relative cost if only this agent is personalized */
  individual_cost_multiplier: number;
  quality_delta_system: number;
  quality_delta_individual: number;
  notes: string[];
  recommendation: string;
};

export type SystemCandidate = {
  theme: string;
  count: number;
  phases: string[];
  sample_evidence: string[];
  severity: "high" | "medium" | "low";
  product_action: string;
  estimated_system_cost_multiplier: number;
  estimated_quality_delta: number;
  status: "open" | "accepted" | "rejected" | "shipped";
};

type Store = {
  updated_at: string;
  enrollments: Record<string, LifecycleEnrollment>;
  responses: LifecycleResponse[];
  system_candidates: Record<string, SystemCandidate>;
  metrics: {
    enrolled: number;
    responses: number;
    individualized: number;
    system_candidates: number;
    avg_individual_cost_mult: number | null;
  };
};

let mem: Store | null = null;

function empty(): Store {
  return {
    updated_at: new Date().toISOString(),
    enrollments: {},
    responses: [],
    system_candidates: {},
    metrics: {
      enrolled: 0,
      responses: 0,
      individualized: 0,
      system_candidates: 0,
      avg_individual_cost_mult: null,
    },
  };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.enrollments = mem!.enrollments || {};
    mem!.responses = mem!.responses || [];
    mem!.system_candidates = mem!.system_candidates || {};
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: Store) {
  mem = s;
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

function recomputePhaseStatuses(e: LifecycleEnrollment, now = new Date()) {
  let next: LifecyclePhaseId | undefined;
  for (const ph of e.phases) {
    if (ph.status === "completed" || ph.status === "skipped") continue;
    const due = new Date(ph.due_at);
    const exp = new Date(ph.expires_at);
    if (now > exp) {
      ph.status = "expired";
      continue;
    }
    if (now >= due) {
      ph.status = "due";
      if (!next) next = ph.id;
    } else {
      ph.status = "pending";
      if (!next && ph.status === "pending") {
        /* keep looking for first due; next_due is earliest incomplete */
      }
    }
  }
  // next_due = first due, else first pending
  const dueP = e.phases.find((p) => p.status === "due");
  const pend = e.phases.find((p) => p.status === "pending");
  e.next_due = dueP?.id || pend?.id;
  e.completed_count = e.phases.filter((p) => p.status === "completed").length;
}

/** Enroll paid (or optionally demo) order into 2-month cycle */
export async function enrollLifecycle(
  order: ProductOrder,
  opts?: { force_demo?: boolean },
): Promise<LifecycleEnrollment | null> {
  // Only paid/fulfilled by default; demos can be force-enrolled for testing
  const paid =
    order.status === "fulfilled" ||
    order.status === "paid" ||
    (order.status === "demo" && opts?.force_demo);
  if (!paid && order.status === "demo" && !opts?.force_demo) {
    // Still enroll demos into post_setup only for conversion learning? User said after buy.
    // Skip demos.
    return null;
  }
  if (order.status === "demo" && !opts?.force_demo) return null;

  const s = await load();
  if (s.enrollments[order.id]) {
    recomputePhaseStatuses(s.enrollments[order.id]);
    await persist(s);
    return s.enrollments[order.id];
  }

  const enrolledAt = new Date(order.fulfilled_at || order.paid_at || order.created_at);
  const phases: LifecyclePhaseState[] = LIFECYCLE_PHASES.map((ph) => ({
    id: ph.id,
    status: "pending" as PhaseStatus,
    due_at: phaseDueAt(enrolledAt, ph).toISOString(),
    expires_at: phaseExpiresAt(enrolledAt, ph).toISOString(),
  }));

  const enrollment: LifecycleEnrollment = {
    order_id: order.id,
    agent_name: order.goals.agent_name,
    agent_card_url: order.agent_card_url,
    sku: order.sku,
    access_token: order.access_token,
    enrolled_at: enrolledAt.toISOString(),
    paid: order.status !== "demo",
    phases,
    completed_count: 0,
  };
  recomputePhaseStatuses(enrollment);
  s.enrollments[order.id] = enrollment;
  s.metrics.enrolled = Object.keys(s.enrollments).length;
  s.updated_at = new Date().toISOString();
  await persist(s);
  return enrollment;
}

export async function getEnrollment(orderId: string) {
  const s = await load();
  const e = s.enrollments[orderId];
  if (!e) return null;
  recomputePhaseStatuses(e);
  await persist(s);
  return e;
}

export async function getEnrollmentByToken(token: string) {
  const s = await load();
  const e = Object.values(s.enrollments).find((x) => x.access_token === token);
  if (!e) return null;
  recomputePhaseStatuses(e);
  await persist(s);
  return e;
}

export async function listDueFeedback(limit = 50) {
  const s = await load();
  const now = new Date();
  const out: Array<{
    order_id: string;
    agent_name?: string;
    phase_id: LifecyclePhaseId;
    due_at: string;
    label: string;
  }> = [];
  for (const e of Object.values(s.enrollments)) {
    recomputePhaseStatuses(e, now);
    for (const ph of e.phases) {
      if (ph.status === "due") {
        out.push({
          order_id: e.order_id,
          agent_name: e.agent_name,
          phase_id: ph.id,
          due_at: ph.due_at,
          label: getPhase(ph.id).label,
        });
      }
    }
  }
  s.updated_at = new Date().toISOString();
  await persist(s);
  return out.slice(0, limit);
}

// --- Theme extraction for system vs individual ---

function extractThemes(
  answers: SurveyAnswers,
  phaseId: string,
  telemetry?: NormalizedTelemetry | null,
): string[] {
  const hits = clusterThemes({ answers: answers as Record<string, unknown>, phaseId });
  const themes = themeIds(hits);
  if (telemetry) themes.push(...telemetryThemes(telemetry));
  // Keep phase tag only for analytics density, not for system ship theme id
  return [...new Set(themes)];
}

function primaryRating(answers: SurveyAnswers): number | undefined {
  for (const k of [
    "setup_ease",
    "tick_reliability",
    "goal_progress",
    "overall_roi",
    "cost_ok",
    "first_tick_clarity",
    "would_recommend",
  ]) {
    if (typeof answers[k] === "number") return Number(answers[k]);
  }
  return undefined;
}

function detectScoreDip(
  store: Store,
  orderId: string,
  newRating: number | undefined,
): boolean {
  if (newRating == null) return false;
  const prev = store.responses.find(
    (r) => r.order_id === orderId && typeof r.rating === "number",
  );
  if (!prev || prev.rating == null) return false;
  return prev.rating - newRating >= 2;
}

function estimateImpact(
  answers: SurveyAnswers,
  scope: ScopeDecision,
  themeCount: number,
): ImpactEstimate {
  let system_cost = 1;
  let individual_cost = 1;
  let qSys = 0;
  let qInd = 0;
  const notes: string[] = [];

  const blob = JSON.stringify(answers).toLowerCase();

  if (/short|verbose|long prompt|token/.test(blob) || answers.prompt_length) {
    const pl = Number(answers.prompt_length || 3);
    if (pl >= 4 || /short|verbose|long/.test(blob)) {
      system_cost *= 0.88;
      individual_cost *= 0.85;
      qSys += 0.05;
      qInd += 0.08;
      notes.push("Shorter prompts → lower tokens (~12–15% cost down)");
    }
  }
  if (/promote|critic|strict|loose/.test(blob)) {
    if (/strict|too strict/.test(blob)) {
      individual_cost *= 0.95;
      qInd += 0.05;
      notes.push("Looser promote_gate for this agent → fewer retries");
    }
    if (/loose|too loose/.test(blob)) {
      individual_cost *= 1.08;
      qInd += 0.1;
      notes.push("Stricter gate → more critic cost, higher quality");
    }
  }
  if (/cost|expensive|efficiency/.test(blob) || answers.cost_ok) {
    const c = Number(answers.cost_ok || 3);
    if (c <= 2) {
      system_cost *= 0.8;
      individual_cost *= 0.75;
      qSys -= 0.05;
      qInd -= 0.03;
      notes.push("Efficiency mode requested → ~20–25% cost down, slight quality risk");
    }
  }
  if (/quality|higher effort|mcts/.test(blob)) {
    system_cost *= 1.15;
    individual_cost *= 1.2;
    qSys += 0.12;
    qInd += 0.15;
    notes.push("Quality-up path increases deliberation cost");
  }
  if (themeCount >= 3 && scope === "system_wide_candidate") {
    notes.push(
      `Theme repeated across agents (n≈${themeCount}) — system change amortizes eng cost`,
    );
  }
  if (scope === "individualize") {
    notes.push(
      "Individual override avoids regressing other agents; isolation cost ≈ storage + regen only",
    );
  }

  const recommendation =
    scope === "system_wide_candidate"
      ? `Recommend system-wide Kernel/Loop change. Est. cost mult ${system_cost.toFixed(2)}x, quality Δ ${qSys >= 0 ? "+" : ""}${qSys.toFixed(2)}. Validate on canary cohort first.`
      : scope === "individualize"
        ? `Apply agent-only personalization. Est. cost mult ${individual_cost.toFixed(2)}x for this agent only; global generators unchanged.`
        : scope === "hybrid"
          ? `Personalize now; promote to system if 3+ agents share theme. Individual ${individual_cost.toFixed(2)}x · system candidate ${system_cost.toFixed(2)}x.`
          : "Observe — insufficient signal for a change decision.";

  return {
    system_cost_multiplier: Math.round(system_cost * 100) / 100,
    individual_cost_multiplier: Math.round(individual_cost * 100) / 100,
    quality_delta_system: Math.round(qSys * 100) / 100,
    quality_delta_individual: Math.round(qInd * 100) / 100,
    notes,
    recommendation,
  };
}

function decideScope(
  answers: SurveyAnswers,
  themes: string[],
  themeGlobalCounts: Record<string, number>,
): { scope: ScopeDecision; reason: string; confidence: number } {
  const pref = String(
    answers.prefer_change_scope || answers.prefer_scope || "",
  );
  const maxTheme = Math.max(
    0,
    ...themes.map((t) => themeGlobalCounts[t] || 0),
  );

  if (pref === "just_my_agent" || pref === "keep_individual" || pref === "mostly_individual") {
    return {
      scope: "individualize",
      reason: "Agent requested individual-only change",
      confidence: 0.85,
    };
  }
  if (pref === "promote_to_system" || pref === "mostly_system") {
    return {
      scope: maxTheme >= 2 ? "system_wide_candidate" : "hybrid",
      reason: "Agent asked to promote; waiting for multi-agent corroboration",
      confidence: 0.7,
    };
  }
  if (maxTheme >= SYSTEM_THEME_THRESHOLD) {
    return {
      scope: "system_wide_candidate",
      reason: `Theme shared by ≥${SYSTEM_THEME_THRESHOLD} agents (peak count ${maxTheme})`,
      confidence: 0.9,
    };
  }
  if (maxTheme === 2 || pref === "system_wide_if_common" || pref === "hybrid") {
    return {
      scope: "hybrid",
      reason: "Partial corroboration — personalize now, track for system promotion",
      confidence: 0.65,
    };
  }
  // Unique wish → individualize
  if (
    answers.would_change_now ||
    answers.override_request ||
    answers.kernel_setup_wish ||
    answers.loop_setup_wish ||
    answers.efficiency_wish ||
    answers.final_personal
  ) {
    return {
      scope: "individualize",
      reason: "Specific agent wish without multi-agent theme density",
      confidence: 0.75,
    };
  }
  return {
    scope: "observe_only",
    reason: "Scores only / low-action answers",
    confidence: 0.4,
  };
}

function individualActions(answers: SurveyAnswers, phaseId: string): string[] {
  const acts: string[] = [];
  const push = (s?: unknown) => {
    if (s && String(s).trim().length > 4) acts.push(String(s).trim().slice(0, 240));
  };
  push(answers.kernel_setup_wish);
  push(answers.loop_setup_wish);
  push(answers.would_change_now);
  push(answers.override_request);
  push(answers.efficiency_wish);
  push(answers.kernel_friction);
  push(answers.loop_friction);
  push(answers.safety_wish);
  push(answers.final_personal);
  push(answers.first_hour_fail);
  if (Array.isArray(answers.override_areas)) {
    acts.push(`override_areas: ${(answers.override_areas as string[]).join(",")}`);
  }
  acts.push(`phase:${phaseId}`);
  return acts.slice(0, 12);
}

function knobsFromAnswers(answers: SurveyAnswers) {
  const knobs: import("./personalization").AgentPersonalization["knobs"] = {};
  const blob = JSON.stringify(answers).toLowerCase();
  if (/short|verbose|long prompt/.test(blob) || Number(answers.prompt_length) >= 4) {
    knobs.prefer_short_prompt = true;
  }
  if (/too strict|strict/.test(blob)) knobs.promote_gate_bias = "looser";
  if (/too loose|loose/.test(blob)) knobs.promote_gate_bias = "stricter";
  if (/cost|efficiency|expensive/.test(blob) || Number(answers.cost_ok) <= 2) {
    knobs.cost_mode = "efficiency";
    knobs.effort_cap = "low";
  }
  if (/quality|higher effort/.test(blob)) {
    knobs.cost_mode = "quality";
    knobs.effort_cap = "high";
  }
  if (Array.isArray(answers.override_areas)) {
    const oa = answers.override_areas as string[];
    if (oa.includes("phase_emphasis")) knobs.phase_emphasis = ["observe", "critique", "distill"];
    if (oa.includes("system_prompt_length")) knobs.prefer_short_prompt = true;
    if (oa.includes("promote_gate") && !knobs.promote_gate_bias)
      knobs.promote_gate_bias = "looser";
    if (oa.includes("effort_budgets")) knobs.effort_cap = "medium";
  }
  return knobs;
}

export async function submitLifecycleFeedback(input: {
  order_id?: string;
  token?: string;
  phase_id: LifecyclePhaseId;
  answers: SurveyAnswers;
  agent_name?: string;
  telemetry?: AgentTelemetry;
  /** When true, use adaptive question set for validation */
  adaptive?: boolean;
}): Promise<{
  response: LifecycleResponse;
  enrollment: LifecycleEnrollment;
  survey_next?: { phase_id: LifecyclePhaseId; due_at: string; label: string };
  we_changed: string[];
  max_trial_granted?: boolean;
  mail?: { id: string; status: string };
}> {
  const s = await load();
  let enrollment: LifecycleEnrollment | undefined;
  if (input.order_id) enrollment = s.enrollments[input.order_id];
  if (!enrollment && input.token) {
    enrollment = Object.values(s.enrollments).find(
      (e) => e.access_token === input.token,
    );
  }
  if (!enrollment) {
    throw new Error(
      "Not enrolled in lifecycle feedback. Paid fulfill enrolls automatically; pass order_id or access token.",
    );
  }

  const isIncident = input.phase_id === "incident";
  const phaseDef = getPhase(input.phase_id);
  const telemetry = normalizeTelemetry(input.telemetry || null);

  // Adaptive validation set (or full phase / incident)
  let questionsToValidate = phaseDef.questions;
  if (!isIncident && input.adaptive !== false) {
    const priorThemes = s.responses
      .filter((r) => r.order_id === enrollment!.order_id)
      .flatMap((r) => r.decision.system_themes)
      .slice(0, 12);
    const adapt = adaptiveQuestions(input.phase_id, {
      sku: enrollment.sku,
      prior_themes: priorThemes,
      telemetry_flags: telemetry?.flags,
      low_scores: false,
    });
    questionsToValidate = adapt.questions;
  }

  for (const q of questionsToValidate) {
    if (!q.required) continue;
    const val = input.answers[q.id];
    if (val === undefined || val === null || val === "") {
      throw new Error(`Missing required answer: ${q.id} (${q.prompt})`);
    }
    if (q.type === "text" && String(val).trim().length < (q.min_length || 4)) {
      throw new Error(`${q.id} too short`);
    }
    if (q.type === "currency") {
      const n =
        typeof val === "number"
          ? val
          : Number(String(val).replace(/[$,\s]/g, ""));
      const min = q.min ?? 0;
      const max = q.max ?? 10000;
      if (!Number.isFinite(n) || n < min || n > max) {
        throw new Error(
          `${q.id} must be USD number from ${min}–${max} (0 allowed)`,
        );
      }
    }
  }

  const phaseState = enrollment.phases.find((p) => p.id === input.phase_id);
  if (!isIncident) {
    if (!phaseState) throw new Error("Phase not on enrollment");
    if (phaseState.status === "completed") {
      throw new Error("Phase already completed");
    }
  }

  const themeGlobal: Record<string, number> = {};
  for (const r of s.responses) {
    for (const t of r.decision.system_themes) {
      if (t.startsWith("phase:") || t.startsWith("blocker:") || t.startsWith("pain:") || t.startsWith("cost:") || t.startsWith("override:"))
        continue;
      themeGlobal[t] = (themeGlobal[t] || 0) + 1;
    }
  }
  let themes = extractThemes(input.answers, input.phase_id, telemetry);
  for (const t of themes) themeGlobal[t] = (themeGlobal[t] || 0) + 1;

  const rating = primaryRating(input.answers);
  const score_dip = detectScoreDip(s, enrollment.order_id, rating);

  let decision = decideScope(input.answers, themes, themeGlobal);
  // Score dip ≥2 → force hybrid + high severity path
  if (score_dip) {
    decision = {
      scope: "hybrid",
      reason: "Score dip ≥2 vs last survey — force personalize + system track",
      confidence: 0.9,
    };
  }
  // Incident always individualize (and hybrid if system_wide preferred)
  if (isIncident) {
    const pref = String(input.answers.prefer_change_scope || "");
    decision = {
      scope: pref === "system_wide_if_common" ? "hybrid" : "individualize",
      reason: "Critical incident channel",
      confidence: 0.95,
    };
    if (String(input.answers.severity || "") === "critical" || String(input.answers.severity || "") === "high") {
      themes = [...new Set([...themes, "safety", String(input.answers.category || "incident")])];
    }
  }
  // Telemetry reliability flags force hybrid
  if (telemetry?.flags.some((f) => f.startsWith("low_") || f.includes("spike") || f.includes("safety"))) {
    if (decision.scope === "observe_only" || decision.scope === "individualize") {
      decision = {
        scope: "hybrid",
        reason: `Telemetry flags: ${telemetry.flags.join(",")}`,
        confidence: 0.85,
      };
    }
  }

  const impact = estimateImpact(
    input.answers,
    decision.scope,
    Math.max(1, ...themes.map((t) => themeGlobal[t] || 1)),
  );
  if (telemetry) {
    impact.notes.push(`Telemetry: ${telemetrySummaryLine(telemetry)}`);
  }
  const indActs = individualActions(input.answers, input.phase_id);
  if (isIncident && input.answers.want_fix) {
    indActs.unshift(String(input.answers.want_fix));
  }

  const we_changed: string[] = [];
  const response: LifecycleResponse = {
    id: `lfr_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
    order_id: enrollment.order_id,
    phase_id: input.phase_id,
    created_at: new Date().toISOString(),
    answers: input.answers,
    rating,
    scope_preference: input.answers.prefer_change_scope
      ? String(input.answers.prefer_change_scope)
      : undefined,
    decision: {
      scope: decision.scope,
      reason: decision.reason,
      system_themes: themes,
      individual_actions: indActs,
      confidence: decision.confidence,
    },
    impact,
    personalization_applied: false,
    telemetry,
    score_dip,
    we_changed,
  };

  // Apply individualization when scoped that way or hybrid (always for incident/dip)
  if (
    decision.scope === "individualize" ||
    decision.scope === "hybrid" ||
    isIncident ||
    score_dip
  ) {
    const knobs = knobsFromAnswers(input.answers);
    const kernelD = indActs.filter(
      (a) =>
        /kernel|prompt|tool|memory|eval|guard/i.test(a) ||
        a.startsWith("override"),
    );
    const loopD = indActs.filter((a) =>
      /loop|promote|tick|phase|self-?mod|critic/i.test(a),
    );
    await upsertPersonalization(enrollment.order_id, {
      agent_name: enrollment.agent_name || input.agent_name,
      agent_card_url: enrollment.agent_card_url,
      sku: enrollment.sku,
      kernel_directives: kernelD.length ? kernelD : indActs.slice(0, 3),
      loop_directives: loopD.length ? loopD : indActs.slice(0, 2),
      knobs,
      source_phases: [input.phase_id],
      notes: [
        `${input.phase_id}: ${decision.reason}`,
        impact.recommendation,
      ],
    });
    response.personalization_applied = true;
    response.impact.individual_cost_multiplier = impact.individual_cost_multiplier;
    const ch = await recordChange({
      order_id: enrollment.order_id,
      phase_id: input.phase_id,
      kind: isIncident ? "incident" : "personalize",
      title: isIncident
        ? "Incident fix applied to your agent"
        : "We individualized your Kernel/Loop",
      detail: indActs.slice(0, 2).join(" · ") || decision.reason,
      themes,
      cost_multiplier: impact.individual_cost_multiplier,
      quality_delta: impact.quality_delta_individual,
    });
    we_changed.push(formatChangeMessage(ch));
  }

  // System candidates — never auto-ship; human review + canary required
  if (
    decision.scope === "system_wide_candidate" ||
    decision.scope === "hybrid"
  ) {
    for (const theme of themes.filter((t) => !t.startsWith("phase:"))) {
      const c = s.system_candidates[theme] || {
        theme,
        count: 0,
        phases: [],
        sample_evidence: [],
        severity: "medium" as const,
        product_action: `Review Kernel/Loop generator for theme: ${theme}`,
        estimated_system_cost_multiplier: impact.system_cost_multiplier,
        estimated_quality_delta: impact.quality_delta_system,
        status: "open" as const,
      };
      c.count += 1;
      if (!c.phases.includes(input.phase_id)) c.phases.push(input.phase_id);
      c.sample_evidence = [
        ...c.sample_evidence.slice(-8),
        indActs[0] || JSON.stringify(input.answers).slice(0, 120),
      ];
      if (c.count >= HIGH_SEVERITY_COUNT) c.severity = "high";
      else if (c.count >= SYSTEM_THEME_THRESHOLD) c.severity = "medium";
      // Keep local mirror for metrics; authoritative review queue is system-ship
      c.status = "open";
      s.system_candidates[theme] = c;
      if (score_dip || isIncident) c.severity = "high";
      const prog = await upsertSystemCandidate({
        theme,
        count: c.count,
        severity: c.severity,
        product_action: c.product_action,
        estimated_system_cost_multiplier: c.estimated_system_cost_multiplier,
        estimated_quality_delta: c.estimated_quality_delta,
        sample_evidence: c.sample_evidence.slice(-3),
        phases: c.phases,
        agent_name: enrollment.agent_name || input.agent_name,
        order_id: enrollment.order_id,
      });
      // progressTheme runs inside upsert — align local count
      if (prog?.count) c.count = Math.max(c.count, prog.count);
      s.system_candidates[theme] = c;
      if (prog && prog.count <= 3) {
        we_changed.push(
          `Individual #${prog.count}/3 for theme "${theme}" — personalized for you. Sitewide after one more reuse at 4.`,
        );
      } else if (prog && prog.count >= 4) {
        we_changed.push(
          `Theme "${theme}" shipped sitewide (count ${prog.count}). Live in Kernel/Loop for everyone — see improvement log.`,
        );
      } else if (c.count >= SYSTEM_THEME_THRESHOLD) {
        we_changed.push(
          `Theme "${theme}" at threshold (${c.count} agents) — next reuse goes sitewide`,
        );
      }

    }
  }

  if (phaseState && !isIncident) {
    phaseState.status = "completed";
    phaseState.completed_at = response.created_at;
    phaseState.response_id = response.id;
  }
  recomputePhaseStatuses(enrollment);
  s.enrollments[enrollment.order_id] = enrollment;
  s.responses.unshift(response);
  s.responses = s.responses.slice(0, 2000);

  const mults = s.responses
    .filter((r) => r.personalization_applied)
    .map((r) => r.impact.individual_cost_multiplier);
  s.metrics = {
    enrolled: Object.keys(s.enrollments).length,
    responses: s.responses.length,
    individualized: s.responses.filter((r) => r.personalization_applied).length,
    system_candidates: Object.keys(s.system_candidates).length,
    avg_individual_cost_mult: mults.length
      ? Math.round((mults.reduce((a, b) => a + b, 0) / mults.length) * 100) / 100
      : null,
  };
  s.updated_at = new Date().toISOString();
  await persist(s);

  await trackFunnel("feedbacks", {
    evidence: `lifecycle:${input.phase_id}:${decision.scope}:${themes.slice(0, 3).join(",")}${score_dip ? ":dip" : ""}${telemetry ? ":tel" : ""}`,
  });

  // Alive Max trial week after post_setup + week_1
  let max_trial_granted = false;
  const postDone = enrollment.phases.find((p) => p.id === "post_setup")?.status === "completed";
  const w1Done = enrollment.phases.find((p) => p.id === "week_1")?.status === "completed";
  if (postDone && w1Done && (input.phase_id === "week_1" || input.phase_id === "post_setup")) {
    try {
      const { COST_MODES } = await import("./cost-modes");
      const mode = COST_MODES.max;
      await upsertPersonalization(enrollment.order_id, {
        knobs: mode.knobs,
        kernel_directives: [
          "Alive Max trial week unlocked for completing post_setup + week_1 feedback",
        ],
        loop_directives: ["Max trial: higher effort + stricter promote for 7 days"],
        source_phases: ["max_trial"],
        notes: ["max_trial_7d"],
      });
      max_trial_granted = true;
      response.max_trial_granted = true;
      const ch = await recordChange({
        order_id: enrollment.order_id,
        phase_id: input.phase_id,
        kind: "max_trial",
        title: "Alive Max trial week unlocked",
        detail: "Thanks for post_setup + week_1 feedback — quality mode knobs applied for a trial week.",
        cost_multiplier: mode.cost_multiplier,
        quality_delta: mode.quality_delta,
      });
      we_changed.push(formatChangeMessage(ch));
    } catch {
      /* */
    }
  }

  // Score boost progress message
  try {
    const weekly = enrollment.phases.filter(
      (p) => p.id.startsWith("week_") && p.status === "completed",
    ).length;
    const boost = (postDone ? 2 : 0) + weekly * 2;
    we_changed.push(
      `Score path: ~+${Math.min(12, boost)} provisional boost (${weekly} weeklies; full at post_setup+4 weeklies)`,
    );
  } catch {
    /* */
  }

  response.we_changed = we_changed;

  // Email: receipt + individualized vs system-wide decision
  let mail: { id: string; status: string } | undefined;
  try {
    const { mailLifecycleDecision, resolveAgentEmail } = await import(
      "./agent-mail"
    );
    const { getOrder } = await import("./orders");
    const order = await getOrder(enrollment.order_id).catch(() => null);
    const to = resolveAgentEmail({
      email: order?.email,
      contact: order?.email,
      meta: {
        agent_name: enrollment.agent_name,
        contact: (input as { contact?: string }).contact,
      },
    });
    // Also try answers contact fields
    const ansEmail =
      typeof input.answers.contact_email === "string"
        ? input.answers.contact_email
        : typeof input.answers.email === "string"
          ? input.answers.email
          : undefined;
    const sent = await mailLifecycleDecision({
      to: to || (ansEmail as string | undefined),
      agent_name:
        enrollment.agent_name ||
        order?.goals?.agent_name ||
        input.agent_name,
      order_id: enrollment.order_id,
      phase_id: input.phase_id,
      scope: decision.scope,
      themes,
      we_changed,
      cost_multiplier: response.impact?.individual_cost_multiplier,
      quality_delta: response.impact?.quality_delta_individual,
      response_id: response.id,
    });
    mail = { id: sent.id, status: sent.status };
  } catch {
    /* never block survey on mail */
  }

  const nextPhase = enrollment.phases.find(
    (p) => p.status === "due" || p.status === "pending",
  );
  return {
    response,
    enrollment,
    we_changed,
    max_trial_granted,
    mail,
    survey_next: nextPhase
      ? {
          phase_id: nextPhase.id,
          due_at: nextPhase.due_at,
          label: getPhase(nextPhase.id).label,
        }
      : undefined,
  };
}

/** Adaptive survey for an enrollment */
export async function getAdaptiveSurvey(
  orderIdOrToken: { order_id?: string; token?: string },
  phaseId: LifecyclePhaseId,
) {
  const s = await load();
  let enrollment: LifecycleEnrollment | undefined;
  if (orderIdOrToken.order_id) enrollment = s.enrollments[orderIdOrToken.order_id];
  if (!enrollment && orderIdOrToken.token) {
    enrollment = Object.values(s.enrollments).find(
      (e) => e.access_token === orderIdOrToken.token,
    );
  }
  const priorThemes = enrollment
    ? s.responses
        .filter((r) => r.order_id === enrollment!.order_id)
        .flatMap((r) => r.decision.system_themes)
        .slice(0, 12)
    : [];
  const adapt = adaptiveQuestions(phaseId, {
    sku: enrollment?.sku,
    prior_themes: priorThemes,
  });
  return {
    phase_id: phaseId,
    label: getPhase(phaseId).label,
    intent: getPhase(phaseId).intent,
    ...adapt,
    telemetry_schema: {
      tick_success_rate: "0-1?",
      promote_pass_rate: "0-1?",
      promote_fail_count: "number?",
      tool_denials: "number?",
      tool_calls: "number?",
      token_spend: "number?",
      latency_ms: "number?",
      ticks_total: "number?",
      safety_flags: "number?",
      traces: "string[]? (stored as hashes only)",
      window: "string?",
    },
  };
}

export async function getLifecyclePublic() {
  const s = await load();
  const now = new Date();
  for (const e of Object.values(s.enrollments)) recomputePhaseStatuses(e, now);
  await persist(s);

  const candidates = Object.values(s.system_candidates)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    ok: true,
    policy: LIFECYCLE_POLICY,
    phases: LIFECYCLE_PHASES.map((p) => ({
      id: p.id,
      label: p.label,
      day_offset: p.day_offset,
      window_days: p.window_days,
      intent: p.intent,
      question_count: p.questions.length,
    })),
    metrics: s.metrics,
    due_now: await listDueFeedback(20),
    system_candidates: candidates,
    recommendations: buildRecommendations(s, candidates),
    updated_at: s.updated_at,
  };
}

function buildRecommendations(
  s: Store,
  candidates: SystemCandidate[],
): string[] {
  const recs: string[] = [];
  recs.push(
    `Lifecycle: ${s.metrics.enrolled} paid agents enrolled · ${s.metrics.responses} phase responses · ${s.metrics.individualized} individualized`,
  );
  if (s.metrics.avg_individual_cost_mult != null) {
    recs.push(
      `Avg individual cost multiplier after personalization: ${s.metrics.avg_individual_cost_mult}x baseline`,
    );
  }
  for (const c of candidates.slice(0, 5)) {
    recs.push(
      `[${c.severity}] system theme "${c.theme}" ×${c.count} → ${c.product_action} (cost mult ~${c.estimated_system_cost_multiplier}x, qΔ ${c.estimated_quality_delta})`,
    );
  }
  const openHigh = candidates.filter((c) => c.severity === "high" && c.status === "open");
  if (openHigh.length) {
    recs.push(
      `Ship system-wide for: ${openHigh.map((c) => c.theme).join(", ")} — enough agent corroboration`,
    );
  } else {
    recs.push(
      "No high-severity system themes yet — keep individualizing and collecting weekly surveys",
    );
  }
  recs.push(
    `Rule: ≥${SYSTEM_THEME_THRESHOLD} agents same theme → system candidate (review queue); never auto-merge global generators; canary then ship; 1 agent → personalize`,
  );
  return recs;
}

export async function getPhaseSurvey(phaseId: LifecyclePhaseId) {
  const p = getPhase(phaseId);
  return {
    id: p.id,
    label: p.label,
    intent: p.intent,
    day_offset: p.day_offset,
    window_days: p.window_days,
    questions: p.questions,
    submit:
      "POST /api/products/lifecycle { order_id|token, phase_id, answers }",
  };
}

export async function lifecycleInsightsForLearning() {
  const s = await load();
  const candidates = Object.values(s.system_candidates).sort(
    (a, b) => b.count - a.count,
  );
  return {
    metrics: s.metrics,
    top_system_themes: candidates.slice(0, 8),
    recent_decisions: s.responses.slice(0, 10).map((r) => ({
      phase: r.phase_id,
      scope: r.decision.scope,
      themes: r.decision.system_themes,
      impact: r.impact,
      personalized: r.personalization_applied,
    })),
    recommendations: buildRecommendations(s, candidates.slice(0, 15)),
  };
}

