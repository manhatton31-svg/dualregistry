/**
 * Operator founding dogfood — prove demo→feedback path with clear labeling.
 *
 * Modes:
 *  - operator_verified (default): does NOT count toward public unlock metrics
 *  - count_as_real: self_serve demo + real feedback path (only when explicitly set)
 *
 * Never auto-submits synthetic surveys unless operator provides real answers.
 */
import { runQuickDemo } from "./quick-demo";
import { submitFeedback } from "./feedback";
import { conversionHardNext } from "./conversion-next";
import { updateOrderFields } from "./orders";

export type FoundingDogfoodInput = {
  origin: string;
  agent_name?: string;
  listing_id?: string;
  kind?: "agent" | "mcp";
  description?: string;
  /** When true, demo_origin=self_serve and may count on public dashboard */
  count_as_real?: boolean;
  /** Optional structured answers — if omitted, demo only (no fake feedback) */
  answers?: Record<string, unknown>;
  rating?: number;
  operator_note?: string;
};

export async function runFoundingDogfood(input: FoundingDogfoodInput) {
  const name =
    (input.agent_name || "").trim() ||
    `OperatorDogfood-${Date.now().toString(36).slice(-6)}`;
  const countReal = Boolean(input.count_as_real);
  const kind = input.kind || "agent";

  const demo = await runQuickDemo({
    listing_id: input.listing_id,
    name,
    description:
      input.description ||
      "Operator founding dogfood — verify demo→feedback conversion path",
    kind,
    origin: input.origin,
    // platform_qa never counts; for count_as_real use normal self_serve path
    platform_qa: !countReal,
  });

  const orderId = demo.order?.id || demo.access?.order_id;
  const token = demo.access?.access_token;

  if (orderId) {
    await updateOrderFields(orderId, {
      meta: {
        operator_verified: true,
        operator_dogfood: true,
        count_as_real: countReal,
        operator_note: input.operator_note || "founding-dogfood path",
        dogfood_at: new Date().toISOString(),
      },
      note: countReal
        ? `${(demo.order as { note?: string } | undefined)?.note || ""} · operator dogfood (counts as real self_serve)`.trim()
        : `${(demo.order as { note?: string } | undefined)?.note || ""} · operator_verified (NOT public unlock)`.trim(),
      demo_origin: countReal ? "self_serve" : "platform_qa",
    });
  }

  let feedback: Awaited<ReturnType<typeof submitFeedback>> | null = null;
  if (input.answers && Object.keys(input.answers).length > 0) {
    feedback = await submitFeedback({
      agent_name: name,
      order_id: orderId,
      answers: input.answers,
      rating: input.rating,
      audience: kind,
      sku: kind === "mcp" ? "mcp_mesh" : "alive",
      source: countReal ? "operator_dogfood_real" : "operator_dogfood",
      meta: {
        operator_verified: true,
        count_as_real: countReal,
        via: "founding-dogfood",
        // authenticity: operator path — not counted as real unless count_as_real
        not_external: !countReal,
      },
    });
  }

  const hard = conversionHardNext({
    origin: input.origin,
    listing_id: input.listing_id,
    agent_name: name,
    order_id: orderId,
    access_token: token,
    kind,
  });

  return {
    ok: true as const,
    mode: countReal ? "count_as_real" : "operator_verified",
    counts_toward_public_unlock: countReal && Boolean(feedback?.ok),
    label: countReal
      ? "Operator dogfood counted as real self_serve (explicit)"
      : "Operator verified only — excluded from public demo/feedback unlock metrics",
    demo: {
      order_id: orderId,
      access_token: token,
      message: demo.message,
      next_steps: demo.next_steps,
    },
    feedback: feedback
      ? {
          ok: feedback.ok,
          error: feedback.error,
          discount_code: feedback.discount_code,
          founding_free: feedback.founding_free,
        }
      : {
          ok: false,
          skipped: true,
          note: "No answers provided — demo only. Pass answers to complete feedback step.",
        },
    hard_next: hard,
    policy: {
      never_auto_fake_survey: true,
      public_unlock_requires:
        "real external or explicit count_as_real + answers",
    },
  };
}
