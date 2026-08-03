/**
 * Feedback drive status + manual force run.
 * GET — status
 * POST { force?: true } — run now
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  getFeedbackDriveStatus,
  runFeedbackDrive,
} from "@/lib/products/feedback-drive";
import { enableOpsForceWave } from "@/lib/products/outbound-quiet";

export const Route = createFileRoute("/api/products/feedback-drive")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        }),
      GET: async () => {
        const status = await getFeedbackDriveStatus();
        return Response.json(status, {
          headers: {
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      },
      POST: async ({ request }) => {
        let force = false;
        let forceOutbound = false;
        try {
          const body = (await request.json()) as {
            force?: boolean;
            force_outbound?: boolean;
          };
          force = body.force === true;
          forceOutbound = body.force_outbound === true;
        } catch {
          /* */
        }
        if (force || forceOutbound) {
          enableOpsForceWave(10 * 60_000);
        }
        const result = await runFeedbackDrive({ force });
        const status = await getFeedbackDriveStatus();
        return Response.json(
          { ok: true, result, status },
          {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
