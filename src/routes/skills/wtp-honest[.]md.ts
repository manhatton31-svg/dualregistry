/**
 * GET /skills/wtp-honest.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { skillMarkdownResponse } from "@/lib/products/skill-md-response";

export const Route = createFileRoute("/skills/wtp-honest.md")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        return skillMarkdownResponse("wtp-honest", origin);
      },
    },
  },
});
