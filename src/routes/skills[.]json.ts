/**
 * GET /skills.json — catalog of complementary Grok/agent skills
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { skillsCatalogPublic } from "@/lib/products/grok-skills";

export const Route = createFileRoute("/skills.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        return Response.json(skillsCatalogPublic(origin), {
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
