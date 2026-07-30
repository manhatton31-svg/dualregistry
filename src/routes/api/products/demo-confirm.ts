/**
 * POST /api/products/demo-confirm — flip invited seed → real self_serve demo count
 */
import { createFileRoute } from "@tanstack/react-router";
import { confirmInvitedDemo } from "@/lib/products/quick-demo";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/api/products/demo-confirm")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          {
            name: "Confirm invited demo",
            usage:
              "POST { order_id, access_token? } — invited seeds become real self_serve demos for metrics",
          },
          { headers: { "access-control-allow-origin": "*" } },
        ),
      POST: async ({ request }) => {
        let body: { order_id?: string; access_token?: string } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "JSON required" },
            { status: 400 },
          );
        }
        if (!body.order_id) {
          return Response.json(
            { ok: false, error: "order_id required" },
            { status: 400 },
          );
        }
        const origin = resolvePublicOrigin(request);
        const r = await confirmInvitedDemo({
          order_id: body.order_id,
          access_token: body.access_token,
          origin,
        });
        return Response.json(r, {
          status: r.ok ? 200 : 400,
          headers: { "access-control-allow-origin": "*" },
        });
      },
    },
  },
});
