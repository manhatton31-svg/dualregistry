import { createFileRoute } from "@tanstack/react-router";
import { confirmSession } from "@/lib/products/stripe";
import { getOrder, publicOrder, fulfillOrder } from "@/lib/products/orders";

export const Route = createFileRoute("/api/products/confirm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const orderId = url.searchParams.get("order_id") || undefined;
        const sessionId = url.searchParams.get("session_id") || undefined;
        try {
          if (sessionId) {
            const order = await confirmSession(sessionId, orderId);
            return Response.json({ ok: true, order: publicOrder(order) });
          }
          if (orderId) {
            const existing = await getOrder(orderId);
            if (!existing) {
              return Response.json({ ok: false, error: "not found" }, { status: 404 });
            }
            if (existing.status === "fulfilled" || existing.status === "demo") {
              return Response.json({ ok: true, order: publicOrder(existing) });
            }
            // demo path: allow confirm by order id alone when pending
            if (existing.status === "pending") {
              const order = await fulfillOrder(orderId, { demo: true });
              return Response.json({ ok: true, order: publicOrder(order) });
            }
            return Response.json({ ok: true, order: publicOrder(existing) });
          }
          return Response.json(
            { ok: false, error: "order_id or session_id required" },
            { status: 400 },
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
