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
        try {
          const body = (await request.json()) as { force?: boolean };
          force = body.force === true;
        } catch {
          /* */
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
