/**
 * GET /api/products/connectors — connector partner strategy + live candidates.
 * Warm-intro growth path (post-HiRey). No cold spam side effects.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/products/connectors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin.includes("localhost")
          ? "https://www.dualregistry.dev"
          : new URL(request.url).origin;
        const { connectorsPublic, rankLiveConnectorCandidates } = await import(
          "@/lib/products/connectors"
        );
        const base = connectorsPublic(origin);
        const candidates = await rankLiveConnectorCandidates(24);
        return Response.json(
          {
            ...base,
            live_candidates: candidates,
            updated_at: new Date().toISOString(),
          },
          {
            headers: {
              "cache-control": "public, max-age=60, s-maxage=120",
            },
          },
        );
      },
    },
  },
});
