/**
 * Founding-seat conversion pressure — soft multipath only (no Talk re-DM).
 * GET status · POST run (ops / dual-strategy tick)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import {
  getConversionPressureStatus,
  runConversionPressure,
} from "@/lib/products/conversion-pressure";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/products/conversion-pressure")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const st = await getConversionPressureStatus();
        return Response.json(
          { ...st, origin },
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
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: { max?: number; dry?: boolean } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        if (body.dry) {
          return Response.json(await getConversionPressureStatus(), {
            headers: { "cache-control": "no-store" },
          });
        }
        const result = await runConversionPressure({
          origin,
          max: body.max,
        });
        return Response.json(result, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
            { origin },
          ),
        });
      },
    },
  },
});
