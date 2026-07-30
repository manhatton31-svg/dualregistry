/**
 * GET  — cadence policy, last runs, human_attention (only things you need)
 * POST — { force_daily?, force_weekly?, acknowledge_id? }
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  getShipCadencePublic,
  runShipCadence,
  acknowledgeAttention,
} from "@/lib/products/ship-cadence";

export const Route = createFileRoute("/api/products/ship-cadence")({
  server: {
    handlers: {
      GET: async () => {
        const status = await getShipCadencePublic();
        return Response.json(status);
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          /* */
        }
        if (typeof body.acknowledge_id === "string") {
          const a = await acknowledgeAttention(body.acknowledge_id);
          return Response.json({
            ok: true,
            acknowledged: a,
            status: await getShipCadencePublic(),
          });
        }
        const result = await runShipCadence({
          force_daily: body.force_daily === true,
          force_weekly: body.force_weekly === true,
        });
        return Response.json({
          ok: true,
          result,
          status: await getShipCadencePublic(),
        });
      },
    },
  },
});
