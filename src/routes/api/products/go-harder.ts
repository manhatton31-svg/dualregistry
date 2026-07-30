/**
 * POST /api/products/go-harder — run conversion escalation wave
 * GET  /api/products/go-harder — status (nudge + human outreach queue)
 *
 * Never re-Talk-DMs 30d contacts. Multipath + A2A + human drafts only.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  getGoHarderStatus,
  runGoHarder,
} from "@/lib/products/go-harder";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/api/products/go-harder")({
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
        try {
          const status = await getGoHarderStatus();
          return Response.json(status, {
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store" },
              { origin },
            ),
          });
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            {
              status: 500,
              headers: withDemoCtaHeaders(undefined, { origin }),
            },
          );
        }
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: {
          first_touch_max?: number;
          multipath_max?: number;
          outreach_max?: number;
          skip_first_touch?: boolean;
          skip_multipath?: boolean;
          skip_outreach?: boolean;
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* */
        }
        try {
          const result = await runGoHarder({
            origin,
            first_touch_max: body.first_touch_max,
            multipath_max: body.multipath_max,
            outreach_max: body.outreach_max,
            skip_first_touch: body.skip_first_touch,
            skip_multipath: body.skip_multipath,
            skip_outreach: body.skip_outreach,
          });
          return Response.json(result, {
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store" },
              { origin },
            ),
          });
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            {
              status: 500,
              headers: withDemoCtaHeaders(undefined, { origin }),
            },
          );
        }
      },
    },
  },
});
