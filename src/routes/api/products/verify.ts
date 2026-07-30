import { createFileRoute } from "@tanstack/react-router";
import { verifyCertificate } from "@/lib/products/certify";
import { trackFunnel } from "@/lib/products/learning-loop";

export const Route = createFileRoute("/api/products/verify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const order_id = url.searchParams.get("order_id") || undefined;
        const token = url.searchParams.get("token") || undefined;
        const agent_card_url =
          url.searchParams.get("agent_card_url") ||
          url.searchParams.get("agent") ||
          undefined;
        if (!order_id && !token && !agent_card_url) {
          return Response.json({
            name: "Agents1 product verify",
            usage:
              "GET /api/products/verify?order_id=… | token=… | agent_card_url=…",
          });
        }
        const result = await verifyCertificate({ order_id, token, agent_card_url });
        if (result.certified) await trackFunnel("verifies");
        return Response.json(result, {
          headers: {
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
