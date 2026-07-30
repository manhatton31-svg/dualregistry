import { createFileRoute } from "@tanstack/react-router";
import {
  listMailOutbox,
  retryPendingMail,
} from "@/lib/products/agent-mail";

export const Route = createFileRoute("/api/products/mail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const limit = Number(url.searchParams.get("limit") || "40");
        return Response.json(await listMailOutbox(limit), {
          headers: { "cache-control": "no-store" },
        });
      },
      POST: async ({ request }) => {
        let body: { action?: string; limit?: number } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        if (body.action === "retry") {
          return Response.json(await retryPendingMail(body.limit ?? 20));
        }
        return Response.json(
          { error: "Unknown action. Use {action:'retry'}" },
          { status: 400 },
        );
      },
    },
  },
});
