import { createFileRoute } from "@tanstack/react-router";
import {
  getEnrollment,
  getEnrollmentByToken,
  getLifecyclePublic,
  getPhaseSurvey,
  getAdaptiveSurvey,
  listDueFeedback,
  submitLifecycleFeedback,
  enrollLifecycle,
} from "@/lib/products/feedback-lifecycle";
import { getOrder, getOrderByToken } from "@/lib/products/orders";
import type { LifecyclePhaseId } from "@/lib/products/lifecycle-surveys";
import {
  LIFECYCLE_PHASES,
  INCIDENT_PHASE,
} from "@/lib/products/lifecycle-surveys";
import { changesForOrder } from "@/lib/products/change-log";

export const Route = createFileRoute("/api/products/lifecycle")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || undefined;
        const orderId = url.searchParams.get("order_id") || undefined;
        const phase = url.searchParams.get("phase") as LifecyclePhaseId | null;
        const adaptive = url.searchParams.get("adaptive") !== "0";

        if (phase === "incident") {
          return Response.json(
            {
              ok: true,
              survey: {
                id: INCIDENT_PHASE.id,
                label: INCIDENT_PHASE.label,
                intent: INCIDENT_PHASE.intent,
                questions: INCIDENT_PHASE.questions,
              },
              note: "Anytime channel — does not consume weekly schedule",
            },
            {
              headers: {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
            },
          );
        }

        if (phase && LIFECYCLE_PHASES.some((p) => p.id === phase)) {
          const survey = adaptive
            ? await getAdaptiveSurvey({ order_id: orderId, token }, phase)
            : await getPhaseSurvey(phase);
          let enrollment = null;
          if (token) enrollment = await getEnrollmentByToken(token);
          if (orderId) enrollment = await getEnrollment(orderId);
          return Response.json(
            {
              ok: true,
              survey,
              enrollment: enrollment
                ? {
                    order_id: enrollment.order_id,
                    next_due: enrollment.next_due,
                    completed_count: enrollment.completed_count,
                    phases: enrollment.phases,
                  }
                : null,
            },
            {
              headers: {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
            },
          );
        }

        if (token || orderId) {
          let enrollment = token
            ? await getEnrollmentByToken(token)
            : await getEnrollment(orderId!);
          if (!enrollment) {
            const order = token
              ? await getOrderByToken(token)
              : await getOrder(orderId!);
            if (order && order.status === "fulfilled") {
              enrollment = await enrollLifecycle(order);
            }
          }
          if (!enrollment) {
            return Response.json(
              {
                ok: false,
                error:
                  "No lifecycle enrollment. Paid purchases enroll automatically.",
              },
              { status: 404 },
            );
          }
          const due = enrollment.phases.filter((p) => p.status === "due");
          const next =
            due[0] || enrollment.phases.find((p) => p.status === "pending");
          const survey = next
            ? adaptive
              ? await getAdaptiveSurvey(
                  { order_id: enrollment.order_id, token },
                  next.id,
                )
              : await getPhaseSurvey(next.id)
            : null;
          const we_changed = await changesForOrder(enrollment.order_id, 8);
          return Response.json(
            {
              ok: true,
              enrollment: {
                order_id: enrollment.order_id,
                agent_name: enrollment.agent_name,
                sku: enrollment.sku,
                enrolled_at: enrollment.enrolled_at,
                completed_count: enrollment.completed_count,
                next_due: enrollment.next_due,
                phases: enrollment.phases,
              },
              due_phases: due.map((p) => p.id),
              active_survey: survey,
              we_changed,
              incident: {
                phase_id: "incident",
                url: "/api/products/lifecycle?phase=incident",
              },
              submit: {
                method: "POST",
                body: {
                  token: token || undefined,
                  order_id: enrollment.order_id,
                  phase_id: next?.id,
                  answers: "{ question_id: value }",
                  telemetry:
                    "{ tick_success_rate, promote_pass_rate, token_spend, latency_ms, traces? }",
                },
              },
            },
            {
              headers: {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
            },
          );
        }

        const pub = await getLifecyclePublic();
        return Response.json(
          {
            ...pub,
            due: await listDueFeedback(30),
            incident_channel: true,
          },
          {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
      POST: async ({ request }) => {
        let body: {
          order_id?: string;
          token?: string;
          phase_id?: string;
          answers?: Record<string, unknown>;
          agent_name?: string;
          telemetry?: Record<string, unknown>;
          adaptive?: boolean;
        } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "JSON required" },
            { status: 400 },
          );
        }
        if (!body.phase_id || !body.answers) {
          return Response.json(
            {
              ok: false,
              error: "phase_id and answers required",
              phases: [
                ...LIFECYCLE_PHASES.map((p) => p.id),
                "incident",
              ],
            },
            { status: 400 },
          );
        }
        try {
          if (body.token || body.order_id) {
            const order = body.token
              ? await getOrderByToken(body.token)
              : await getOrder(body.order_id!);
            if (order && order.status === "fulfilled") {
              await enrollLifecycle(order);
            }
          }
          const result = await submitLifecycleFeedback({
            order_id: body.order_id,
            token: body.token,
            phase_id: body.phase_id as LifecyclePhaseId,
            answers: body.answers as Record<
              string,
              string | number | string[] | undefined
            >,
            agent_name: body.agent_name,
            telemetry: body.telemetry as never,
            adaptive: body.adaptive,
          });

          let regenerated = false;
          if (result.response.personalization_applied) {
            try {
              const { regenerateArtifacts, getOrder } = await import(
                "@/lib/products/orders"
              );
              const ord = await getOrder(result.enrollment.order_id);
              if (ord) await regenerateArtifacts(ord.access_token);
              regenerated = true;
            } catch {
              /* */
            }
          }

          const changed = result.we_changed || result.response.we_changed || [];
          return Response.json(
            {
              ok: true,
              decision: result.response.decision,
              impact: result.response.impact,
              personalization_applied: result.response.personalization_applied,
              artifacts_regenerated: regenerated,
              recommendation: result.response.impact.recommendation,
              survey_next: result.survey_next,
              phase_completed: result.response.phase_id,
              telemetry_received: !!result.response.telemetry,
              score_dip: result.response.score_dip,
              max_trial_granted: result.max_trial_granted,
              we_changed: changed,
              thanks: changed.length
                ? `Thanks — ${changed[0]}`
                : result.response.personalization_applied
                  ? "Thanks — we individualized your Kernel/Loop and regenerated artifacts."
                  : "Thanks — feedback recorded.",
            },
            {
              headers: {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
            },
          );
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
