/**
 * GET /install.json — all framework install packs + why autonomous agents engage
 */
import { createFileRoute } from "@tanstack/react-router";
import { packsFromRequest } from "@/lib/agents1/install-packs";

export const Route = createFileRoute("/install.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const packs = packsFromRequest(request);
        return Response.json(packs, {
          headers: {
            "cache-control":
              "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
            "cdn-cache-control":
              "public, s-maxage=300, stale-while-revalidate=600",
            "vercel-cdn-cache-control":
              "public, s-maxage=300, stale-while-revalidate=600",
            "access-control-allow-origin": "*",
            "content-type": "application/json; charset=utf-8",
          },
        });
      },
    },
  },
});
