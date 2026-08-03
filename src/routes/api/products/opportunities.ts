/**
 * GET /api/products/opportunities — agent-readable demo + feedback board.
 * Optional: ?listing_id= / ?agent_name= / ?deposit_followups=1
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

const cors = {
  "access-control-allow-origin": "*" as const,
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export const Route = createFileRoute("/api/products/opportunities")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: cors }),
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const listing_id =
          url.searchParams.get("listing_id") ||
          url.searchParams.get("id") ||
          undefined;
        const agent_name =
          url.searchParams.get("agent_name") ||
          url.searchParams.get("name") ||
          undefined;
        const deposit =
          url.searchParams.get("deposit_followups") === "1" ||
          url.searchParams.get("followups") === "1";

        try {
          const {
            buildAgentOpportunities,
            depositFeedbackFollowups,
          } = await import("@/lib/products/agent-opportunities");

          let followups: { deposited: number; notes: string[] } | null = null;
          if (deposit) {
            followups = await depositFeedbackFollowups({ origin, max: 10 });
          }

          const board = await buildAgentOpportunities({
            origin,
            listing_id,
            agent_name,
            request,
          });

          return Response.json(
            {
              ...board,
              followups,
            },
            {
              headers: {
                ...cors,
                "cache-control": "public, max-age=30",
              },
            },
          );
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500, headers: cors },
          );
        }
      },
    },
  },
});
