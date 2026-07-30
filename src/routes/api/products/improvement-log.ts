/**
 * Public improvement log — Kernel Improver + Recursive Loop dogfood trail.
 * GET: read log + dogfood snapshot
 * POST { action: "dogfood" }: force re-run on Agents1 itself
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  getPublicImprovementLog,
  runDogfoodImprovement,
  syncLogFromSources,
} from "@/lib/products/improvement-log";

export const Route = createFileRoute("/api/products/improvement-log")({
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
        const url = new URL(request.url);
        const limit = Math.min(
          100,
          Math.max(5, Number(url.searchParams.get("limit") || 40) || 40),
        );
        const dogfood = url.searchParams.get("dogfood") !== "0";
        const log = await getPublicImprovementLog({ limit, dogfood });
        return Response.json(log, {
          headers: {
            "cache-control": "public, max-age=30",
            "access-control-allow-origin": "*",
          },
        });
      },
      POST: async ({ request }) => {
        let body: { action?: string } = {};
        try {
          body = await request.json();
        } catch {
          /* empty */
        }
        if (body.action === "sync") {
          const r = await syncLogFromSources();
          return Response.json(
            { ok: true, ...r },
            { headers: { "access-control-allow-origin": "*" } },
          );
        }
        const dogfood = await runDogfoodImprovement();
        const log = await getPublicImprovementLog({
          limit: 20,
          dogfood: false,
        });
        return Response.json(
          {
            ok: true,
            message: "Agents1 Kernel + Loop dogfood re-run complete",
            dogfood,
            recent_entries: log.entries.slice(0, 10),
          },
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
