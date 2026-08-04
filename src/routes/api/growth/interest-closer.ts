/**
 * GET /api/growth/interest-closer — public status for Interest Closer ($2/mo).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/growth/interest-closer")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getInterestCloserStatus } = await import(
            "@/lib/agents1/growth/interest-closer"
          );
          const status = await getInterestCloserStatus();
          return Response.json(
            {
              ok: true,
              product: "interest_closer",
              helps: "external_interest_scout",
              one_liner:
                "Daily: follow up high-score Interest Scout first-touches with xAI ultra-path closer. $2/mo budget. Warm-seed assist when scout contacts are thin.",
              ...status,
            },
            {
              headers: {
                "cache-control": "private, max-age=30",
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
            { status: 500 },
          );
        }
      },
    },
  },
});
