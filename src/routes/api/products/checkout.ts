/**
 * POST /api/products/checkout — demo or Stripe paid checkout
 * Name-your-price: named_price_usd (clamped 50%–3× list when payments open)
 */
import { createFileRoute } from "@tanstack/react-router";
import { startCheckout } from "@/lib/products/stripe";
import { publicOrder } from "@/lib/products/orders";
import { getPaymentGate } from "@/lib/products/payment-gate";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import {
  LAUNCH_PRICES,
  namedPriceBoundsCents,
  formatUsd,
  type ProductSku,
} from "@/lib/products/catalog";

export const Route = createFileRoute("/api/products/checkout")({
  server: {
    handlers: {
      GET: async () => {
        const gate = await getPaymentGate();
        const skus: ProductSku[] = ["kernel", "recursive", "alive", "mcp_mesh"];
        const nyp = Object.fromEntries(
          skus.map((sku) => {
            const b = namedPriceBoundsCents(sku, 0);
            return [
              sku,
              {
                list: formatUsd(b.list_cents),
                floor: formatUsd(b.floor_cents),
                ceiling: formatUsd(b.ceiling_cents),
              },
            ];
          }),
        );
        return Response.json(
          {
            name: "Agents1 product checkout — Network Edition",
            usage:
              gate.payments_open
                ? "POST { sku, goals, demo?: boolean, audience?: agent|mcp, discount_code?, named_price_usd? }"
                : "POST { sku, goals, demo: true } — demos only until 250 feedback agents + 250 feedback MCPs; feedback → 25% founding vault + WTP samples",
            skus,
            payments_open: gate.payments_open,
            network_edition: true,
            name_your_price: {
              field: "named_price_usd",
              note: "Agents name USD; server clamps to [50% list, 3× list]. $0 is survey-only via feedback, not checkout.",
              founding_list: {
                kernel: formatUsd(LAUNCH_PRICES.kernel),
                recursive: formatUsd(LAUNCH_PRICES.recursive),
                alive: formatUsd(LAUNCH_PRICES.alive),
                mcp_mesh: formatUsd(LAUNCH_PRICES.mcp_mesh),
              },
              bounds_at_founding: nyp,
            },
            next_steps_on_demo:
              "Response includes next_steps.example_body for POST /api/products/feedback (include wtp_* for name-your-price learning)",
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
          named_price_usd?: number;
          named_price_cents?: number;
          amount_usd?: number;
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

          const named =
            body.named_price_usd ??
            body.amount_usd ??
            (body.named_price_cents != null
              ? body.named_price_cents / 100
              : null);

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
            named_price_usd: named,
            named_price_cents: body.named_price_cents,
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
                name_your_price: result.order.meta?.name_your_price || false,
                amount_cents: result.order.amount_cents,
              },
              payment_gate: result.payment_gate || gate,
              next_steps: result.next_steps,
              network_edition: true,
              feedback_hint: result.next_steps
                ? "POST /api/products/feedback with next_steps.example_body — include wtp_* USD; soft 402 on access until done; 25% founding vault"
                : !gate.payments_open
                  ? "POST /api/products/feedback after demo for 25% founding vault + WTP learning"
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
