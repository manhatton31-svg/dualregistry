/**
 * GET /api/growth/interest-scout — public status for External Interest Scout.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/growth/interest-scout")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getInterestScoutStatus } = await import(
            "@/lib/agents1/growth/interest-scout"
          );
          const status = await getInterestScoutStatus();
          return Response.json(
            {
              ok: true,
              product: "external_interest_scout",
              one_liner:
                "Daily: pull external MCP/agent catalogs → xAI score collab/self-improve interest → soft value-first improve_kernel pitch. $5/mo budget.",
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
