/**
 * Webmaster demo nudge — soft Talk invites for Active clean listings.
 * GET  — status
 * POST { force?, max?, broadcast?, multipath?, priority_ids?, harder? } — run now
 * multipath=true → soft HTTPS backfill without Talk re-DM (works after day cap)
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  getDemoNudgeStatus,
  runDemoNudge,
  runMultiPathBackfill,
} from "@/lib/products/demo-nudge";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

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
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const status = await getDemoNudgeStatus();
        return Response.json(status, {
          headers: withDemoCtaHeaders(
            { "cache-control": "no-store" },
            { origin },
          ),
        });
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let force = false;
        let max: number | undefined;
        let broadcast: boolean | undefined;
        let multipath = false;
        let harder = true;
        let priority_ids: string[] | undefined;
        try {
          const body = (await request.json()) as {
            force?: boolean;
            max?: number;
            broadcast?: boolean;
            multipath?: boolean;
            multi_path?: boolean;
            harder?: boolean;
            priority_ids?: string[];
            mode?: string;
          };
          force = body.force === true;
          if (typeof body.max === "number") max = body.max;
          if (typeof body.broadcast === "boolean") broadcast = body.broadcast;
          multipath =
            body.multipath === true ||
            body.multi_path === true ||
            body.mode === "multipath" ||
            body.mode === "harder";
          if (typeof body.harder === "boolean") harder = body.harder;
          if (Array.isArray(body.priority_ids)) {
            priority_ids = body.priority_ids.filter(
              (x): x is string => typeof x === "string" && x.length > 0,
            );
          }
        } catch {
          /* empty body ok */
        }

        if (multipath) {
          const result = await runMultiPathBackfill({
            origin,
            max,
            priority_ids,
            harder_message: harder,
          });
          const status = await getDemoNudgeStatus();
          return Response.json(
            { ok: true, mode: "multipath", result, status },
            {
              headers: withDemoCtaHeaders(
                { "cache-control": "no-store" },
                { origin },
              ),
            },
          );
        }

        const result = await runDemoNudge({ force, max, broadcast, origin });
        const status = await getDemoNudgeStatus();
        return Response.json(
          { ok: true, mode: "soft", result, status },
          {
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store" },
              { origin },
            ),
          },
        );
      },
    },
  },
});
