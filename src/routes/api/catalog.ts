import { createFileRoute } from "@tanstack/react-router";
import { federationCatalog } from "@/lib/agents1/catalog";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const body = await federationCatalog(origin);
        return Response.json(body, {
          headers: {
            "cache-control": "public, max-age=60",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
