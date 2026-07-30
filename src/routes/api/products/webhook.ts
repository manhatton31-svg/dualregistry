import { createFileRoute } from "@tanstack/react-router";
import { handleWebhook } from "@/lib/products/stripe";

export const Route = createFileRoute("/api/products/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const sig = request.headers.get("stripe-signature");
        try {
          const r = await handleWebhook(raw, sig);
          return Response.json(r);
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
