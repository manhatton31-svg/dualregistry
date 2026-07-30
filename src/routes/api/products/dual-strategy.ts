/**
 * Dual strategy API — outbound go-harder + inbound discovery together.
 * GET  — status / surfaces / policy (never depends on demos)
 * POST — run dual tick (first-touch + multipath + A2A + outreach)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import {
  dualStrategyPublic,
  runDualStrategyTick,
} from "@/lib/products/dual-strategy";
import { getGoHarderStatus } from "@/lib/products/go-harder";
import { getDemoNudgeStatus } from "@/lib/products/demo-nudge";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/products/dual-strategy")({
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
          const [nudge, go] = await Promise.all([
            getDemoNudgeStatus(),
            getGoHarderStatus(),
          ]);
          return Response.json(
            {
              ...dualStrategyPublic(origin),
              live: {
                active_clean: nudge.active_clean,
                never_contacted: nudge.never_contacted,
                unique_contacted: nudge.unique_listings ?? nudge.nudged_known,
                day: nudge.day,
                policy: nudge.policy,
                go_harder: {
                  outreach: go.outreach?.totals,
                  policy: go.policy,
                },
              },
            },
            {
              headers: withDemoCtaHeaders(
                { "cache-control": "no-store" },
                { origin },
              ),
            },
          );
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
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* */
        }
        try {
          const result = await runDualStrategyTick({
            origin,
            first_touch_max: body.first_touch_max,
            multipath_max: body.multipath_max,
            outreach_max: body.outreach_max,
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
