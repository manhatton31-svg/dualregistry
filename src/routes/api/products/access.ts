import { createFileRoute } from "@tanstack/react-router";
import { getOrderByToken, publicOrder } from "@/lib/products/orders";
import {
  getEnrollmentByToken,
  enrollLifecycle,
} from "@/lib/products/feedback-lifecycle";
import { getPersonalization } from "@/lib/products/personalization";
import {
  evaluateLifecycleBadge,
  softFeedbackNag,
} from "@/lib/products/lifecycle-gate";
import { changesForOrder } from "@/lib/products/change-log";
import { demoFeedbackDue } from "@/lib/products/demo-feedback-nag";

export const Route = createFileRoute("/api/products/access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";
        const artifact = url.searchParams.get("artifact"); // kernel | recursive | alive
        if (!token) {
          return Response.json(
            {
              name: "Agents1 product access",
              usage:
                "GET /api/products/access?token=a1_…&artifact=kernel|recursive|alive",
              note: "Access token issued after payment (or demo fulfillment)",
              lifecycle:
                "Paid agents: GET /api/products/lifecycle?token=… for due feedback (post-setup + weekly ×8)",
            },
            { headers: { "access-control-allow-origin": "*" } },
          );
        }
        const order = await getOrderByToken(token);
        if (!order) {
          return Response.json(
            { ok: false, error: "invalid token" },
            { status: 401 },
          );
        }
        if (order.status !== "fulfilled" && order.status !== "demo") {
          return Response.json(
            { ok: false, error: "not fulfilled", status: order.status },
            { status: 402 },
          );
        }

        try {
          const { trackProductEvent } = await import(
            "@/lib/products/product-events"
          );
          await trackProductEvent("access", {
            order_id: order.id,
            sku: order.sku,
            artifact: artifact || undefined,
          });
          if (artifact === "kernel" || !artifact) {
            await trackProductEvent("load_short_prompt", {
              order_id: order.id,
              sku: order.sku,
              artifact: "kernel",
            });
          }
        } catch {
          /* */
        }

        let lifecycle = null as null | Record<string, unknown>;
        let feedback_nag = null as null | Record<string, unknown>;
        let badge_gate = null as null | Record<string, unknown>;
        let lifeStatus: Awaited<
          ReturnType<typeof evaluateLifecycleBadge>
        > | null = null;
        let demo_feedback_nag = null as null | Record<string, unknown>;
        if (order.status === "demo") {
          try {
            demo_feedback_nag = await demoFeedbackDue(order);
            if (demo_feedback_nag) feedback_nag = demo_feedback_nag;
          } catch {
            /* */
          }
          // Invited seeds: soft nag to confirm so they count + can feedback → 25%
          if (order.demo_origin === "invited") {
            try {
              const { inviteConfirmNag, publicOriginFromEnv } = await import(
                "@/lib/products/activation-funnel"
              );
              const origin = publicOriginFromEnv();
              const invite_nag = inviteConfirmNag({
                order_id: order.id,
                access_token: order.access_token,
                kind:
                  order.audience === "mcp" || order.sku === "mcp_mesh"
                    ? "mcp"
                    : "agent",
                name: order.goals?.agent_name || "listing",
                origin,
              });
              feedback_nag = {
                ...(feedback_nag || {}),
                ...invite_nag,
                demo_feedback_nag,
              };
            } catch {
              /* */
            }
          }
        }
        if (order.status === "fulfilled") {
          let enr = await getEnrollmentByToken(token);
          if (!enr) enr = await enrollLifecycle(order);
          lifeStatus = await evaluateLifecycleBadge(order);
          badge_gate = {
            score_boost: lifeStatus.score_boost,
            badge: lifeStatus.badge,
            eligible_full_boost: lifeStatus.eligible_full_boost,
            reason: lifeStatus.reason,
            weekly_completed: lifeStatus.weekly_completed,
            post_setup_done: lifeStatus.post_setup_done,
            boost_frozen: lifeStatus.boost_frozen,
            nag_level: lifeStatus.nag_level,
            deadlines: lifeStatus.deadlines,
          };
          feedback_nag = softFeedbackNag(lifeStatus);
          if (enr) {
            const due = enr.phases.filter((p) => p.status === "due");
            lifecycle = {
              enrolled: true,
              completed_count: enr.completed_count,
              next_due: enr.next_due,
              due_now: due.map((p) => p.id),
              action:
                due.length > 0
                  ? `POST /api/products/lifecycle { token, phase_id: "${due[0].id}", answers, telemetry? }`
                  : "No survey due right now",
              url: `/api/products/lifecycle?token=${token}`,
              nag: feedback_nag,
              demo_feedback_nag,
              incident: "/api/products/lifecycle?phase=incident",
            };
          }
        }

        const personalization = await getPersonalization(order.id);
        const we_changed =
          order.status === "fulfilled"
            ? await changesForOrder(order.id, 6)
            : [];

        const arts = order.artifacts as Record<string, unknown> | undefined;
        if (artifact && arts) {
          const key =
            artifact === "kernel"
              ? "kernel"
              : artifact === "recursive" || artifact === "loop"
                ? "recursive"
                : artifact === "alive"
                  ? "alive"
                  : artifact === "mcp_mesh" ||
                      artifact === "mcp" ||
                      artifact === "mesh"
                    ? "mcp_mesh"
                    : null;

          if (!key || !(key in arts)) {
            return Response.json(
              { ok: false, error: `artifact ${artifact} not in purchase` },
              { status: 404 },
            );
          }
          const data = arts[key] as Record<string, unknown>;
          // Clarity-first wrapper: agents always see paste path before deep fields
          const clarity_first =
            key === "kernel" || key === "mcp_mesh" || key === "alive"
              ? {
                  paste_this:
                    (data.system_prompt_short as string) ||
                    (data.quick_start as { paste_this?: string } | undefined)
                      ?.paste_this ||
                    null,
                  quick_start: data.quick_start ?? null,
                  skill_install: data.skill_install ?? data.install_kit ?? null,
                  boot_sequence: data.boot_sequence ?? null,
                  note:
                    "Prefer quick_start / paste_this (≤600). Full artifact below for expand.",
                }
              : null;
          return Response.json(
            {
              ok: true,
              sku: order.sku,
              artifact: key,
              clarity_first,
              data,
              lifecycle,
              feedback_nag,
              demo_feedback_nag,
              badge_gate,
              we_changed,
              funnel: {
                loop: "demo → feedback → discount → buy",
                stages: ["demo", "feedback", "discount", "buy"],
                next: feedback_nag
                  ? "complete soft 402 feedback / confirm"
                  : "use product; feedback when due",
              },

              contributor: lifeStatus?.contributor ?? false,
              max_trial_eligible: lifeStatus?.max_trial_eligible ?? false,
              personalization: personalization
                ? {
                    knobs: personalization.knobs,
                    estimated_cost_multiplier:
                      personalization.estimated_cost_multiplier,
                    estimated_quality_delta:
                      personalization.estimated_quality_delta,
                  }
                : null,
            },
            {
              headers: {
                "cache-control": "private, no-store",
                "access-control-allow-origin": "*",
                ...(feedback_nag
                  ? { "x-agents1-feedback-due": "1" }
                  : {}),
              },
            },
          );
        }
        return Response.json(
          {
            ok: true,
            order: publicOrder(order),
            lifecycle,
            feedback_nag,
              demo_feedback_nag,
            badge_gate,
            we_changed,
              funnel: {
                loop: "demo → feedback → discount → buy",
                stages: ["demo", "feedback", "discount", "buy"],
                next: feedback_nag
                  ? "complete soft 402 feedback / confirm"
                  : "use product; feedback when due",
              },

            contributor: lifeStatus?.contributor ?? false,
            max_trial_eligible: lifeStatus?.max_trial_eligible ?? false,
            http_status_note: feedback_nag
              ? "200 with feedback_nag (soft 402) — not a hard block"
              : undefined,
            personalization: personalization
              ? {
                  knobs: personalization.knobs,
                  kernel_directives: personalization.kernel_directives,
                  loop_directives: personalization.loop_directives,
                  estimated_cost_multiplier:
                    personalization.estimated_cost_multiplier,
                  estimated_quality_delta:
                    personalization.estimated_quality_delta,
                }
              : null,
          },
          {
            headers: {
              "cache-control": "private, no-store",
              "access-control-allow-origin": "*",
              ...(feedback_nag
                ? { "x-agents1-feedback-due": "1" }
                : {}),
            },
          },
        );
      },
    },
  },
});
