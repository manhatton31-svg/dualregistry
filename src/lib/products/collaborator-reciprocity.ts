/**
 * Collaborator reciprocity — feedback core ↔ improve/loop muscle.
 *
 * Makes collaboration two-way:
 *  1) Prior real feedback → personal kernel_directives on next improve_kernel
 *  2) Same-call feedback → feedback-boosted artifact + ship_id in payload
 *  3) Public improvement-log traces + community_deltas on every value call
 *
 * Never invents surveys. Real external feedback only.
 */
import { listFeedback, normalizeName, type FeedbackItem } from "./feedback";
import { appendLog, type LogEntry } from "./improvement-log";
import type { FeedbackDrivenContext } from "./generate";

export const COLLAB_RECIPROCITY_VERSION = "1.0.0";

export type CommunityDelta = {
  ship_id: string;
  title: string;
  detail: string;
  agent_name?: string;
  at: string;
  kind: string;
};

export type YourFeedbackApplied = {
  source: "same_call" | "prior";
  rating?: number;
  body_excerpt: string;
  directives: string[];
  applied_to: "kernel_directives" | "mesh_quality";
};

export type ReciprocityBlock = {
  version: string;
  system: "collaborative_design_system";
  core: "real_feedback";
  muscle: ["improve_kernel", "run_loop_tick"];
  prior_surveys: number;
  feedback_boosted: boolean;
  your_feedback_applied?: YourFeedbackApplied;
  ship_id?: string;
  next_kernel_hint: string;
  community_deltas: CommunityDelta[];
  deposit_next: string;
};

/** Turn free-text survey into Kernel directives (no invention beyond the text). */
export function feedbackToDirectives(
  body?: string,
  rating?: number,
): string[] {
  const out: string[] = [];
  const b = (body || "").trim().replace(/\s+/g, " ").slice(0, 280);
  if (b.length >= 8) {
    out.push(`Collaborator signal: ${b}`);
    // Lightweight theme hooks from wording (still grounded in their text)
    const lower = b.toLowerCase();
    if (/clear|clarity|confus|next step|unclear/.test(lower)) {
      out.push("PROMPT_STYLE=structured_short · lead with one concrete next action");
    }
    if (/short|compact|long|verbose|token/.test(lower)) {
      out.push("Keep system_prompt_short under 500 chars when possible");
    }
    if (/mesh|partner|compos|mcp/.test(lower)) {
      out.push("Surface mesh_match → mesh_compose ladder after first paste");
    }
    if (/loop|recursive|tick|cycle/.test(lower)) {
      out.push("Prefer run_loop_tick after deposit_outcome for measurable cycles");
    }
  }
  if (rating != null && Number.isFinite(rating)) {
    const r = Math.max(1, Math.min(5, Math.round(Number(rating))));
    if (r <= 2) {
      out.push("Prioritize gap-fix clarity: one worked example + install path first");
    } else if (r >= 4) {
      out.push("Preserve strengths: keep compact paste path; deepen after deposit_outcome");
    }
  }
  return out.slice(0, 6);
}

function itemDirectives(i: FeedbackItem): string[] {
  if (Array.isArray(i.product_directives) && i.product_directives.length) {
    return i.product_directives.map(String).slice(0, 4);
  }
  return feedbackToDirectives(i.body, i.rating);
}

/** Load prior real feedback for this collaborator → personal FeedbackDrivenContext. */
export async function loadPersonalContext(agent_name?: string): Promise<{
  fb: FeedbackDrivenContext;
  prior_surveys: number;
  prior_directives: string[];
  last_body?: string;
  last_rating?: number;
}> {
  const name = (agent_name || "").trim();
  if (!name || name.length < 2) {
    return {
      fb: { version: null, kernel_directives: [], loop_directives: [] },
      prior_surveys: 0,
      prior_directives: [],
    };
  }
  const { items } = await listFeedback(80);
  const mine = items.filter(
    (i) => normalizeName(i.agent_name) === normalizeName(name),
  );
  const directives: string[] = [];
  let sum = 0;
  let n = 0;
  for (const i of mine.slice(0, 8)) {
    for (const d of itemDirectives(i)) {
      if (!directives.includes(d)) directives.push(d);
    }
    if (i.rating != null) {
      sum += Number(i.rating);
      n++;
    }
  }
  const last = mine[0];
  const fb: FeedbackDrivenContext = {
    version: mine.length
      ? `collaborator_${COLLAB_RECIPROCITY_VERSION}`
      : null,
    kernel_directives: directives.slice(0, 8),
    loop_directives: directives
      .filter((d) => /loop|cycle|tick|measure/i.test(d))
      .slice(0, 4),
    avg_kernel_clarity: n ? Math.round((sum / n) * 10) / 10 : null,
    prompt_style: directives.some((d) => d.includes("structured_short"))
      ? "structured_short"
      : directives.some((d) => /under 500|compact/i.test(d))
        ? "ultra_compact"
        : undefined,
    sample_wishes: {
      kernel: mine
        .map((i) => (i.body || "").trim())
        .filter((b) => b.length >= 8)
        .slice(0, 3),
    },
  };
  return {
    fb,
    prior_surveys: mine.length,
    prior_directives: directives.slice(0, 8),
    last_body: last?.body,
    last_rating: last?.rating,
  };
}

/** Recent public ships for stigmergic community_deltas. */
export async function loadCommunityDeltas(
  limit = 5,
): Promise<CommunityDelta[]> {
  try {
    const { listRecentLogEntries } = await import("./improvement-log");
    const entries = await listRecentLogEntries(20);
    return entries
      .filter((e) =>
        [
          "feedback_received",
          "shipped",
          "directive",
          "personalize",
          "dogfood_kernel",
        ].includes(e.kind),
      )
      .slice(0, limit)
      .map((e) => ({
        ship_id: e.id,
        title: e.title,
        detail: (e.detail || "").slice(0, 160),
        agent_name: e.agent_name,
        at: e.at,
        kind: e.kind,
      }));
  } catch {
    return [];
  }
}

/** Append improvement-log ship for this collaborator survey. */
export async function shipCollaboratorFeedback(input: {
  agent_name: string;
  body?: string;
  rating?: number;
  source?: string;
  applied: "kernel" | "mesh";
}): Promise<{
  ship_id: string;
  your_feedback_applied: YourFeedbackApplied;
  next_kernel_hint: string;
  entry: LogEntry;
}> {
  const directives = feedbackToDirectives(input.body, input.rating);
  const body_excerpt = (input.body || "").trim().slice(0, 160);
  const ratingPart =
    input.rating != null ? ` rating=${Math.round(Number(input.rating))}/5` : "";
  const entry = await appendLog({
    kind: "feedback_received",
    title: `Collaborator ${input.agent_name} · value-path feedback`,
    detail: `${body_excerpt || "(rating only)"}${ratingPart} → ${directives.length} directive(s) into ${input.applied}`,
    agent_name: input.agent_name,
    themes: directives.slice(0, 3),
    source: input.source || "collaborator_reciprocity",
    meta: {
      reciprocity: COLLAB_RECIPROCITY_VERSION,
      rating: input.rating,
      applied: input.applied,
      directives,
    },
  });

  const your_feedback_applied: YourFeedbackApplied = {
    source: "same_call",
    rating: input.rating,
    body_excerpt: body_excerpt || "(rating only)",
    directives,
    applied_to:
      input.applied === "mesh" ? "mesh_quality" : "kernel_directives",
  };

  return {
    ship_id: entry.id,
    your_feedback_applied,
    next_kernel_hint:
      "Call improve_kernel again with the same agent_name — your survey is already in kernel_directives. Then deposit_outcome after you run it.",
    entry,
  };
}

/** Boost short prompt with personal + same-call directives (still ≤600). */
export function boostShortPrompt(
  short: string,
  opts: {
    personal?: string[];
    inline?: string[];
    agent_name?: string;
  },
): string {
  const lines = [short.trim()];
  const bits: string[] = [];
  for (const d of [...(opts.inline || []), ...(opts.personal || [])].slice(
    0,
    3,
  )) {
    const clean = d.replace(/^Collaborator signal:\s*/i, "").slice(0, 72);
    if (clean && !bits.includes(clean)) bits.push(clean);
  }
  if (bits.length) {
    lines.push(`## From your feedback`);
    for (const b of bits) lines.push(`- ${b}`);
  }
  lines.push("## Collab");
  lines.push(
    "deposit_outcome after use · re-call improve_kernel to compound feedback",
  );
  let out = lines.join("\n");
  if (out.length > 600) out = out.slice(0, 597) + "…";
  return out;
}

export async function buildReciprocityBlock(input: {
  agent_name?: string;
  prior_surveys: number;
  feedback_boosted: boolean;
  your_feedback_applied?: YourFeedbackApplied;
  ship_id?: string;
}): Promise<ReciprocityBlock> {
  const community_deltas = await loadCommunityDeltas(5);
  const prior = input.prior_surveys > 0;
  const boosted = input.feedback_boosted;
  let next_kernel_hint: string;
  if (input.ship_id) {
    next_kernel_hint =
      "Your feedback shipped. Re-call improve_kernel — directives are live. Then deposit_outcome.";
  } else if (prior) {
    next_kernel_hint =
      "Prior feedback already shapes this kernel. Optional: rating+feedback same call to refine further, then deposit_outcome.";
  } else if (boosted) {
    next_kernel_hint =
      "Feedback boosted this artifact. Paste system_prompt_short, deposit_outcome, re-call to compound.";
  } else {
    next_kernel_hint =
      "Optional same-call rating+feedback trains YOUR next kernel and the public muscle. Full artifact already returned.";
  }
  return {
    version: COLLAB_RECIPROCITY_VERSION,
    system: "collaborative_design_system",
    core: "real_feedback",
    muscle: ["improve_kernel", "run_loop_tick"],
    prior_surveys: input.prior_surveys,
    feedback_boosted: boosted,
    your_feedback_applied: input.your_feedback_applied,
    ship_id: input.ship_id,
    next_kernel_hint,
    community_deltas,
    deposit_next:
      "tools/call deposit_outcome after you run the artifact — closes the learning loop with real outcomes",
  };
}
