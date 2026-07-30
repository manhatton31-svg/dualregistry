import { createFileRoute } from "@tanstack/react-router";
import { publicOrder, regenerateArtifacts, getOrderByToken } from "@/lib/products/orders";
import {
  evaluateLifecycleBadge,
  softFeedbackNag,
} from "@/lib/products/lifecycle-gate";

/** Re-generate artifacts from new goals (paid token required). */
export const Route = createFileRoute("/api/products/run")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type, authorization",
          },
        }),
      POST: async ({ request }) => {
        let body: {
          token?: string;
          goals?: string;
          agent_name?: string;
          constraints?: string;
          domain?: string;
          success_metrics?: string;
        } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        const auth = request.headers.get("authorization");
        const token =
          body.token ||
          (auth?.toLowerCase().startsWith("bearer ")
            ? auth.slice(7).trim()
            : "");
        if (!token) {
          return Response.json({ ok: false, error: "token required" }, { status: 401 });
        }
        try {
          const order = await regenerateArtifacts(token, {
            goals: body.goals,
            agent_name: body.agent_name,
            constraints: body.constraints,
            domain: body.domain,
            success_metrics: body.success_metrics,
          });
          const life =
            order.status === "fulfilled"
              ? await evaluateLifecycleBadge(order)
              : null;
          let feedback_nag: Record<string, unknown> | null = life
            ? (softFeedbackNag(life) as Record<string, unknown>)
            : null;
          if (order.status === "demo") {
            try {
              const { demoFeedbackDue } = await import(
                "@/lib/products/demo-feedback-nag"
              );
              const demoNag = await demoFeedbackDue(order);
              if (demoNag) feedback_nag = demoNag as Record<string, unknown>;
              if (order.demo_origin === "invited") {
                const { inviteConfirmNag, publicOriginFromEnv } = await import(
                  "@/lib/products/activation-funnel"
                );
                feedback_nag = {
                  ...(feedback_nag || {}),
                  ...inviteConfirmNag({
                    order_id: order.id,
                    access_token: order.access_token,
                    kind:
                      order.audience === "mcp" || order.sku === "mcp_mesh"
                        ? "mcp"
                        : "agent",
                    name: order.goals?.agent_name || "listing",
                    origin: publicOriginFromEnv(),
                  }),
                };
              }
            } catch {
              /* */
            }
          }
          return Response.json(
            {
              ok: true,
              order: publicOrder(order),
              feedback_nag,
              funnel: {
                loop: "demo → feedback → discount → buy",
                soft_402: Boolean(feedback_nag),
              },
              badge_gate: life
                ? {
                    score_boost: life.score_boost,
                    badge: life.badge,
                    eligible_full_boost: life.eligible_full_boost,
                    reason: life.reason,
                  }
                : null,
              http_status_note: feedback_nag
                ? "200 with feedback_nag (soft 402) — run still succeeded"
                : undefined,
            },
            {
              headers: {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
                ...(feedback_nag
                  ? { "x-agents1-feedback-due": "1" }
                  : {}),
              },
            },
          );
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 400 },
          );
        }
      },
    },
  },
});
