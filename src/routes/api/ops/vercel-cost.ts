/**
 * GET /api/ops/vercel-cost — running platform cost matching Vercel dashboard dims.
 * Optional POST { action: "sample", ... } for external calibration pings.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ops/vercel-cost")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const {
            loadPlatformCost,
            platformCostPublic,
          } = await import("@/lib/agents1/platform-cost");
          const s = await loadPlatformCost();
          return Response.json(platformCostPublic(s), {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          });
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
      POST: async ({ request }) => {
        try {
          let body: {
            action?: string;
            class?: string;
            wall_ms?: number;
            route?: string;
            label?: string;
            skipped?: boolean;
            cache_hit?: boolean;
          } = {};
          try {
            body = await request.json();
          } catch {
            /* */
          }
          if (body.action === "sample" || body.wall_ms != null) {
            const { recordPlatformUsage, platformCostPublic, loadPlatformCost } =
              await import("@/lib/agents1/platform-cost");
            await recordPlatformUsage({
              class: (body.class as "other") || "other",
              wall_ms: Math.max(0, Number(body.wall_ms) || 1),
              route: body.route || "/api/ops/vercel-cost",
              label: body.label || "manual_sample",
              skipped: Boolean(body.skipped),
              cache_hit: Boolean(body.cache_hit),
            });
            const s = await loadPlatformCost();
            return Response.json(platformCostPublic(s), {
              headers: { "cache-control": "no-store" },
            });
          }
          const { loadPlatformCost, platformCostPublic } = await import(
            "@/lib/agents1/platform-cost"
          );
          return Response.json(platformCostPublic(await loadPlatformCost()), {
            headers: { "cache-control": "no-store" },
          });
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
