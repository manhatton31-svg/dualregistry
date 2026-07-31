/**
 * GET /api/products/connectors/daily
 * One HiRey-class connector pick per day + operator playbook + prep status.
 * No outbound side effects on GET (read/prep only; never emails targets).
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
        const {
          connectorDailyPublic,
          runConnectorDailyPrep,
          getConnectorDailyStatus,
        } = await import("@/lib/products/connector-daily");
        // Idempotent prep (no target email)
        const prep = await runConnectorDailyPrep({ origin });
        const live = await rankLiveConnectorCandidates(30);
        const body = connectorDailyPublic(origin, live);
        const status = await getConnectorDailyStatus();
        return Response.json(
          {
            ...body,
            today: prep.pick,
            prep: {
              already: prep.already,
              operator_notified: prep.operator_notified,
              notify_error: prep.notify_error,
              note: prep.note,
            },
            automation: status.automation,
            history: status.history,
            updated_at: new Date().toISOString(),
          },
          {
            headers: {
              "cache-control": "public, max-age=60, s-maxage=120",
            },
          },
        );
      },
    },
  },
});
