/**
 * GET /skills/collab-session.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { skillMarkdownResponse } from "@/lib/products/skill-md-response";

export const Route = createFileRoute("/skills/collab-session.md")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        return skillMarkdownResponse("collab-session", origin);
      },
    },
  },
});
