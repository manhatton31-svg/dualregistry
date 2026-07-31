/**
 * POST /api/cron/prefilter — bulk filter known-fail MCPs/agents (no probe budget).
 * Safe to call from Actions or manually. Idempotent via delist set.
 */
import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";

export const maxDuration = MAX_DURATION.cron_prefilter;
export const preferredRegion = PREFERRED_REGION;

async function readDurableRaw(name: string): Promise<string | null> {
  try {
    return await readFile(join(dataRoot(), name), "utf8");
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/cron/prefilter")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const t0 = Date.now();
        const url = new URL(request.url);
        const dry = url.searchParams.get("dry") === "1";
        const noLive = url.searchParams.get("pattern_only") === "1";
        try {
          const { runBulkPrefilter } = await import(
            "@/lib/agents1/bulk-prefilter"
          );
          const result = await runBulkPrefilter({
            dryRun: dry,
            liveCheck: !noLive,
            concurrency: 14,
          });

          const commit: Record<string, string | null> = {
            "data/prod/delisted.json": await readDurableRaw("delisted.json"),
            "data/prod/counter-floors.json": await readDurableRaw(
              "counter-floors.json",
            ),
            "data/prod/store-cache.json": await readDurableRaw(
              "store-cache.json",
            ),
          };

          try {
            const { recordPlatformUsage } = await import(
              "@/lib/agents1/platform-cost"
            );
            await recordPlatformUsage({
              class: "cron_prefilter",
              wall_ms: Date.now() - t0,
              route: "/api/cron/prefilter",
              label: dry ? "prefilter_dry" : "prefilter",
              await_persist: true,
            });
          } catch {
            /* */
          }

          return Response.json({
            ok: true,
            dry,
            result,
            commit,
            note: "No probe budget spent. Known-fail listings delisted + blocked.",
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
      GET: async () =>
        Response.json({
          ok: true,
          usage: "POST /api/cron/prefilter  (optional ?dry=1&pattern_only=1)",
        }),
    },
  },
});
