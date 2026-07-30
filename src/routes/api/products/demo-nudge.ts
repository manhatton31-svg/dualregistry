/**
 * Webmaster demo nudge — soft Talk invites for Active clean listings.
 * GET  — status
 * POST { force?: true, max?: number, broadcast?: boolean } — run now
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  getDemoNudgeStatus,
  runDemoNudge,
} from "@/lib/products/demo-nudge";

export const Route = createFileRoute("/api/products/demo-nudge")({
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
        const status = await getDemoNudgeStatus();
        return Response.json(status, {
          headers: {
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      },
      POST: async ({ request }) => {
        let force = false;
        let max: number | undefined;
        let broadcast: boolean | undefined;
        try {
          const body = (await request.json()) as {
            force?: boolean;
            max?: number;
            broadcast?: boolean;
          };
          force = body.force === true;
          if (typeof body.max === "number") max = body.max;
          if (typeof body.broadcast === "boolean") broadcast = body.broadcast;
        } catch {
          /* empty body ok */
        }
        const result = await runDemoNudge({ force, max, broadcast });
        const status = await getDemoNudgeStatus();
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
