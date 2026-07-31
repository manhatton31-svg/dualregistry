/**
 * GET /skills/hermes.md — Hermes Agent install skill
 */
import { createFileRoute } from "@tanstack/react-router";
import { installPackMarkdown } from "@/lib/agents1/install-packs";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/skills/hermes.md")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const md = installPackMarkdown("hermes", origin);
        return new Response(md, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control":
              "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
