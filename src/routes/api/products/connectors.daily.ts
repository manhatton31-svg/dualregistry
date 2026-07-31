/**
 * GET /api/products/connectors/daily
 * One HiRey-class connector pick per day + operator playbook.
 * No outbound side effects — draft only.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/products/connectors/daily")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin.includes("localhost")
          ? "https://www.dualregistry.dev"
          : new URL(request.url).origin;
        const { rankLiveConnectorCandidates } = await import(
          "@/lib/products/connectors"
        );
        const { connectorDailyPublic } = await import(
          "@/lib/products/connector-daily"
        );
        const live = await rankLiveConnectorCandidates(30);
        const body = connectorDailyPublic(origin, live);
        return Response.json(
          { ...body, updated_at: new Date().toISOString() },
          {
            headers: {
              "cache-control": "public, max-age=120, s-maxage=300",
            },
          },
        );
      },
    },
  },
});
