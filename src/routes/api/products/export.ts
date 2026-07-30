import { createFileRoute } from "@tanstack/react-router";
import { getOrderByToken } from "@/lib/products/orders";
import { buildSkillsTree } from "@/lib/products/export-skills";
import { trackFunnel } from "@/lib/products/learning-loop";

export const Route = createFileRoute("/api/products/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";
        const format = url.searchParams.get("format") || "skills";
        if (!token) {
          return Response.json({
            name: "Agents1 skills export",
            usage: "GET /api/products/export?token=a1_…&format=skills",
          });
        }
        const order = await getOrderByToken(token);
        if (!order) {
          return Response.json({ ok: false, error: "invalid token" }, { status: 401 });
        }
        if (order.status !== "fulfilled" && order.status !== "demo") {
          return Response.json(
            { ok: false, error: "not fulfilled", status: order.status },
            { status: 402 },
          );
        }
        if (format !== "skills" && format !== "skills.json") {
          return Response.json(
            { ok: false, error: "format must be skills" },
            { status: 400 },
          );
        }
        const tree = buildSkillsTree(order);
        await trackFunnel("exports");
        try {
          const { trackProductEvent } = await import(
            "@/lib/products/product-events"
          );
          await trackProductEvent("export_skills", {
            order_id: order.id,
            sku: order.sku,
          });
        } catch {
          /* */
        }
        return Response.json(
          { ok: true, order_id: order.id, sku: order.sku, ...tree },
          {
            headers: {
              "cache-control": "private, no-store",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
