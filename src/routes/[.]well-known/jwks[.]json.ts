/**
 * GET /.well-known/jwks.json — public keys for Agent Card JWS verification
 */
import { createFileRoute } from "@tanstack/react-router";
import { getAgentCardJwks } from "@/lib/agents1/card-sign";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/.well-known/jwks.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const jwks = await getAgentCardJwks(origin);
        return Response.json(jwks, {
          headers: {
            "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
              "cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "vercel-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
            "access-control-allow-origin": "*",
            "content-type": "application/json; charset=utf-8",
          },
        });
      },
    },
  },
});
