/**
 * POST /api/products/try — human-operator one-shot
 * improve_kernel (+ optional feedback) without MCP client.
 * GET  — docs + curl
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export const Route = createFileRoute("/api/products/try")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: { ...cors } }),
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        return Response.json(
          {
            ok: true,
            purpose:
              "Human operator path: get a full kernel artifact + optional founding feedback in one POST. No MCP client required.",
            method: "POST",
            body: {
              agent_name: "string (required) — your name or agent name",
              goals: "string (required) — what the agent optimizes for",
              rating: "1-5 optional",
              feedback: "one honest sentence optional — founding free if real",
              audience: "agent | mcp optional",
              contact: "email optional",
            },
            curl: `curl -sS -X POST ${origin}/api/products/try -H 'content-type: application/json' -d '{"agent_name":"your-name","goals":"what you optimize for","rating":4,"feedback":"one honest sentence about the artifact"}'`,
            agent_mcp: {
              endpoint: `${origin}/api/mcp`,
              tool: "improve_kernel",
              note: "Same path for agents with MCP clients",
            },
            founding:
              "First 100 real feedback events claim a free seat (demo not required).",
          },
          { headers: { ...cors, "cache-control": "public, max-age=60" } },
        );
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "JSON body required" },
            { status: 400, headers: { ...cors } },
          );
        }

        const agent_name = String(body.agent_name || body.name || "")
          .trim()
          .slice(0, 80);
        const goals = String(body.goals || body.goal || "")
          .trim()
          .slice(0, 2000);
        if (!agent_name || agent_name.length < 2) {
          return Response.json(
            { ok: false, error: "agent_name required (min 2 chars)" },
            { status: 400, headers: { ...cors } },
          );
        }
        if (!goals || goals.length < 8) {
          return Response.json(
            {
              ok: false,
              error: "goals required — one sentence on what you optimize for",
            },
            { status: 400, headers: { ...cors } },
          );
        }

        const ratingRaw = body.rating != null ? Number(body.rating) : undefined;
        const rating =
          ratingRaw != null &&
          Number.isFinite(ratingRaw) &&
          ratingRaw >= 1 &&
          ratingRaw <= 5
            ? Math.round(ratingRaw)
            : undefined;
        const feedback = String(body.feedback || body.body || "")
          .trim()
          .slice(0, 2000);
        const audience =
          body.audience === "mcp" ? ("mcp" as const) : ("agent" as const);
        const contact = body.contact
          ? String(body.contact).trim().slice(0, 200)
          : undefined;

        const { runImproveKernel } = await import("@/lib/products/event-value");
        const r = await runImproveKernel({
          agent_name,
          goals,
          origin,
        });

        if (!r.ok) {
          return Response.json(
            {
              ok: false,
              error: r.error || "improve_kernel failed",
              billing: r.billing,
            },
            { status: r.http_status || 402, headers: { ...cors } },
          );
        }

        const artifact =
          r.artifact && typeof r.artifact === "object"
            ? (r.artifact as Record<string, unknown>)
            : {};
        const system_prompt_short = String(
          artifact.system_prompt_short || "",
        );

        let feedback_recorded: Record<string, unknown> | null = null;
        let founding: Record<string, unknown> | null = null;

        if (feedback.length >= 8 || rating != null) {
          try {
            const { submitFeedback } = await import("@/lib/products/feedback");
            const fb = await submitFeedback({
              agent_name,
              contact,
              rating: rating ?? 4,
              body:
                feedback.length >= 8
                  ? feedback
                  : "Used operator try page; full improve_kernel artifact delivered.",
              source: "operator_try",
              mode: "ultra",
              audience,
              tags: [
                "operator_try",
                "improve_kernel",
                "value_optional",
                "ultra_minimal",
              ],
              meta: {
                via: "operator_try",
                source: "improve_kernel_inline",
                human_operator: true,
              },
            });
            if (fb.ok) {
              feedback_recorded = {
                ok: true,
                id: (fb as { item?: { id?: string } }).item?.id,
                discount_code: (fb as { discount_code?: string }).discount_code,
              };
              const ff = (fb as { founding_free?: Record<string, unknown> })
                .founding_free;
              if (ff) {
                founding = {
                  granted: ff.granted,
                  message: ff.message,
                  claim: ff.seat != null ? { seat: ff.seat } : undefined,
                  remaining: ff.remaining,
                  order_id: ff.order_id,
                };
              }
            } else {
              feedback_recorded = { ok: false, ...(fb as object) };
            }
          } catch (e) {
            feedback_recorded = {
              ok: false,
              error: e instanceof Error ? e.message : "feedback failed",
            };
          }
        }

        return Response.json(
          {
            ok: true,
            path: "operator_try",
            agent_name,
            system_prompt_short,
            full_unlocked: true,
            artifact: {
              product: "kernel_improver",
              system_prompt_short,
              full_unlocked: true,
              feedback_optional: true,
            },
            feedback_recorded,
            founding,
            next:
              feedback_recorded &&
              (feedback_recorded as { ok?: boolean }).ok !== false
                ? [
                    "Paste system_prompt_short into your agent runtime",
                    "Share /try with one more operator who runs agents",
                  ]
                : [
                    "Paste system_prompt_short into your agent runtime",
                    "Optional: resubmit with rating (1-5) + one honest sentence for founding free seat",
                  ],
            mcp_same_path: {
              endpoint: `${origin}/api/mcp`,
              tool: "improve_kernel",
              args: {
                agent_name,
                goals,
                ...(rating != null ? { rating } : {}),
                ...(feedback ? { feedback } : {}),
              },
            },
          },
          { headers: { ...cors, "cache-control": "no-store" } },
        );
      },
    },
  },
});
