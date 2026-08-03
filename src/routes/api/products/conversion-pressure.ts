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
import { enableOpsForceWave } from "@/lib/products/outbound-quiet";
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
        let body: {
          max?: number;
          dry?: boolean;
          force_outbound?: boolean;
          force?: boolean;
          wave_ms?: number;
        } = {};
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
        let wave: { until: string; ms: number } | undefined;
        if (body.force_outbound === true || body.force === true) {
          wave = enableOpsForceWave(
            typeof body.wave_ms === "number" ? body.wave_ms : 10 * 60_000,
          );
        }
        const result = await runConversionPressure({
          origin,
          max: body.max,
        });
        if (wave) {
          (result as { ops_force_wave?: unknown }).ops_force_wave = wave;
        }
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
