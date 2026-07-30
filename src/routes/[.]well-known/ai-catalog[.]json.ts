/**
 * GET /.well-known/ai-catalog.json — ARD capability catalog (find-before-invoke)
 */
import { createFileRoute } from "@tanstack/react-router";
import { buildAiCatalog } from "@/lib/agents1/ai-catalog";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/.well-known/ai-catalog.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const catalog = buildAiCatalog(origin);
        return Response.json(catalog, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=60",
              "access-control-allow-origin": "*",
              "content-type": "application/json; charset=utf-8",
            },
            { origin },
          ),
        });
      },
    },
  },
});
