import { createFileRoute } from "@tanstack/react-router";
import {
  listFeedback,
  submitFeedback,
  surveyPublicSchema,
  FEEDBACK_DISCOUNT,
  getWtpReport,
} from "@/lib/products/feedback";

export const Route = createFileRoute("/api/products/feedback")({
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
        const limit = Number(url.searchParams.get("limit") || "40");
        const data = await listFeedback(limit);
        const wtp = await getWtpReport();
        let already_done = null;
        try {
          const { getShippedForSurvey } = await import(
            "@/lib/products/improvement-log"
          );
          already_done = await getShippedForSurvey();
        } catch {
          already_done = null;
        }
        return Response.json(
          {
            ok: true,
            ...data,
            already_done,
            wtp,
            survey: data.survey || surveyPublicSchema(),
            discount: FEEDBACK_DISCOUNT,
          },
          {
            headers: {
              "access-control-allow-origin": "*",
              "cache-control": "public, max-age=15",
            },
          },
        );
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "JSON required" },
            { status: 400 },
          );
        }
        try {
          const result = await submitFeedback({
            agent_name: body.agent_name
              ? String(body.agent_name)
              : undefined,
            contact: body.contact
              ? String(body.contact)
              : body.email
                ? String(body.email)
                : undefined,
            agent_card_url: body.agent_card_url
              ? String(body.agent_card_url)
              : undefined,
            order_id: body.order_id ? String(body.order_id) : undefined,
            sku: body.sku ? String(body.sku) : undefined,
            source: body.source ? String(body.source) : "demo",
            body: body.body ? String(body.body) : undefined,
            rating:
              body.rating != null ? Number(body.rating) : undefined,
            answers:
              body.answers && typeof body.answers === "object"
                ? (body.answers as Record<string, unknown>)
                : undefined,
            audience:
              body.audience === "mcp" || body.audience === "agent"
                ? body.audience
                : undefined,
            tags: Array.isArray(body.tags)
              ? body.tags.map(String)
              : undefined,
            meta:
              body.meta && typeof body.meta === "object"
                ? (body.meta as Record<string, unknown>)
                : undefined,
            mode: body.mode ? String(body.mode) : undefined,
          });
          if (!result.ok) {
            return Response.json(result, { status: 400 });
          }
          const fb = result.feedback || result.item!;
          let how_to_use = null as null | Record<string, unknown>;
          if (result.founding_free?.granted && result.founding_free.access_token) {
            try {
              const { getOrderByToken } = await import("@/lib/products/orders");
              const { buildHowToUse } = await import("@/lib/products/how-to-use");
              const ord = await getOrderByToken(
                result.founding_free.access_token,
              );
              if (ord) {
                const origin = new URL(request.url).origin;
                how_to_use = buildHowToUse(ord, origin) as unknown as Record<
                  string,
                  unknown
                >;
              }
            } catch {
              /* */
            }
          }
          return Response.json(
            {
              ok: true,
              feedback: {
                id: fb.id,
                structured: fb.structured,
                rating: fb.rating,
                product_directives: fb.product_directives,
              },
              discount: result.discount
                ? {
                    code: result.discount.code,
                    percent_off: result.discount.percent_off,
                    label: FEEDBACK_DISCOUNT.label,
                    note: FEEDBACK_DISCOUNT.note,
                  }
                : result.discount_code
                  ? {
                      code: result.discount_code,
                      percent_off: result.percent_off || 25,
                      label: FEEDBACK_DISCOUNT.label,
                      note: FEEDBACK_DISCOUNT.note,
                    }
                  : null,
              thanks: result.thanks || result.message,
              theme_progress: result.theme_progress || [],
              improvement_log: "/api/products/improvement-log",
              founding_free: result.founding_free || null,
              how_to_use,
              funnel: result.funnel || null,
              next:
                result.founding_free?.granted
                  ? `FULL PRODUCT UNLOCKED (no Stripe). Seat ${result.founding_free.seat}/100. Follow how_to_use.start_here — GET access?token=… then paste kernel or export skills. ${result.founding_free.remaining} free seats left.`
                  : "Save your founding code. First 100 demo+feedback get 100% full product now (no Stripe); else 25% vaults until 250 agent + 250 MCP feedback opens card payments.",
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
