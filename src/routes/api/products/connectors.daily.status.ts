/**
 * POST /api/products/connectors/daily/status
 * Operator marks today's connector outcome (sent / replied / dead / skipped).
 * No outbound email side effects.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/products/connectors/daily/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          partner_id?: string;
          day?: string;
          status?: string;
          notes?: string;
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json(
            { ok: false, error: "JSON body required" },
            { status: 400 },
          );
        }
        const status = body.status as
          | "prepped"
          | "sent_by_operator"
          | "replied"
          | "dead"
          | "skipped"
          | undefined;
        if (!status) {
          return Response.json(
            { ok: false, error: "status required" },
            { status: 400 },
          );
        }
        const { markConnectorDailyStatus, getConnectorDailyStatus } =
          await import("@/lib/products/connector-daily");
        const result = await markConnectorDailyStatus({
          partner_id: body.partner_id,
          day: body.day,
          status,
          notes: body.notes,
        });
        if (!result.ok) {
          return Response.json(result, { status: 400 });
        }
        const statusView = await getConnectorDailyStatus();
        return Response.json({
          ok: true,
          entry: result.entry,
          history: statusView.history,
        });
      },
    },
  },
});
