/**
 * POST /api/products/checkout — demo or Stripe paid checkout
 */
import { createFileRoute } from "@tanstack/react-router";
import { startCheckout } from "@/lib/products/stripe";
import { publicOrder } from "@/lib/products/orders";
import { getPaymentGate } from "@/lib/products/payment-gate";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/api/products/checkout")({
  server: {
    handlers: {
      GET: async () => {
        const gate = await getPaymentGate();
        return Response.json(
          {
            name: "Agents1 product checkout",
            usage:
              gate.payments_open
                ? "POST { sku, goals, demo?: boolean, audience?: agent|mcp, discount_code? }"
                : "POST { sku, goals, demo: true } — demos only until 250 feedback agents + 250 feedback MCPs; feedback → 25% founding vault",
            skus: ["kernel", "recursive", "alive", "mcp_mesh"],
            payments_open: gate.payments_open,
            next_steps_on_demo:
              "Response includes next_steps.example_body for POST /api/products/feedback",
          },
          { headers: { "access-control-allow-origin": "*" } },
        );
      },
      POST: async ({ request }) => {
        let body: {
          sku?: string;
          goals?: string;
          agent_name?: string;
          constraints?: string;
          domain?: string;
          success_metrics?: string;
          email?: string;
          agent_card_url?: string;
          callback_url?: string;
          idempotency_key?: string;
          demo?: boolean;
          discount_code?: string;
          cost_mode?: string;
          audience?: string;
          demo_origin?: string;
        };
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "JSON required" },
            { status: 400 },
          );
        }
        if (!body.sku || !body.goals) {
          return Response.json(
            { ok: false, error: "sku and goals required" },
            { status: 400 },
          );
        }
        try {
          const origin = resolvePublicOrigin(request);
          const gate = await getPaymentGate();
          const demo = !gate.payments_open ? true : body.demo;
          const audience =
            body.audience === "mcp" ||
            String(body.sku).toLowerCase().includes("mcp")
              ? "mcp"
              : "agent";

          const result = await startCheckout({
            sku: body.sku,
            goals: body.goals,
            agent_name: body.agent_name,
            constraints: body.constraints,
            domain:
              body.domain ||
              (audience === "mcp" ? "mcp_tools" : undefined),
            success_metrics: body.success_metrics,
            email: body.email,
            agent_card_url: body.agent_card_url,
            callback_url: body.callback_url,
            idempotency_key: body.idempotency_key,
            origin,
            demo,
            discount_code: body.discount_code,
            cost_mode: body.cost_mode,
            audience,
            demo_origin:
              body.demo_origin === "invited" ? "invited" : "self_serve",
          });
          try {
            const { trackFunnel } = await import(
              "@/lib/products/learning-loop"
            );
            await trackFunnel("checkouts");
            if (result.mode === "demo") await trackFunnel("demos");
            else await trackFunnel("paid");
          } catch {
            /* */
          }
          return Response.json(
            {
              ok: true,
              mode: result.mode,
              message: result.message,
              checkout_url: result.checkout_url,
              order: {
                ...publicOrder(result.order),
                demo_origin: result.order.demo_origin,
              },
              payment_gate: result.payment_gate || gate,
              next_steps: result.next_steps,
              feedback_hint: result.next_steps
                ? "POST /api/products/feedback with next_steps.example_body — soft 402 on access until done; 25% founding vault"
                : !gate.payments_open
                  ? "POST /api/products/feedback after demo for 25% founding vault"
                  : undefined,
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
