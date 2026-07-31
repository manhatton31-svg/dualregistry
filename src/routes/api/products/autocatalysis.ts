/**
 * GET /api/products/autocatalysis — Dorr/RethinkX S-curve meter + multipliers
 * POST — bump | cascade | evaporate (ops)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import {
  getAutocatalysisPublic,
  bumpAcceleration,
  runFeedbackCascade,
  getViciousCycle,
  getAccelerationMultipliers,
  AUTOCATALYSIS_VERSION,
} from "@/lib/products/autocatalysis";

export const Route = createFileRoute("/api/products/autocatalysis")({
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
        const body = await getAutocatalysisPublic({ origin });
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-autocatalysis": AUTOCATALYSIS_VERSION,
            },
            { origin },
          ),
        });
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const action = String(body.action || body.op || "status").toLowerCase();
        let result: unknown;
        if (action === "bump") {
          result = await bumpAcceleration({
            kind: String(body.kind || "leave_trace"),
            listing_id:
              typeof body.listing_id === "string" ? body.listing_id : undefined,
            amount:
              typeof body.amount === "number" ? body.amount : undefined,
          });
        } else if (action === "cascade") {
          result = await runFeedbackCascade({
            listing_id:
              typeof body.listing_id === "string" ? body.listing_id : undefined,
            agent_name:
              typeof body.agent_name === "string" ? body.agent_name : undefined,
            founding_claimed: Boolean(body.founding_claimed),
            from: typeof body.from === "string" ? body.from : undefined,
          });
        } else if (action === "vicious") {
          result = await getViciousCycle(
            Number(body.limit) > 0 ? Number(body.limit) : 20,
          );
        } else if (action === "multipliers") {
          result = await getAccelerationMultipliers();
        } else {
          result = await getAutocatalysisPublic({ origin });
        }
        return Response.json(
          {
            ok: true,
            action,
            version: AUTOCATALYSIS_VERSION,
            result,
            origin,
          },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
              { origin },
            ),
          },
        );
      },
    },
  },
});
