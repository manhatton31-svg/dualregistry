/**
 * GET /api/categories — live exclusive category catalog (active listings only)
 */
import { createFileRoute } from "@tanstack/react-router";
import { getLiveCategoryCatalog } from "@/lib/agents1/categories";
import { getLanedListings } from "@/lib/agents1/listing-lanes";

export const Route = createFileRoute("/api/categories")({
  server: {
    handlers: {
      GET: async () => {
        // Ensure active listings refreshed categories first
        try {
          await getLanedListings();
        } catch {
          /* */
        }
        const data = await getLiveCategoryCatalog();
        return Response.json(
          { ok: true, ...data },
          {
            headers: {
              "access-control-allow-origin": "*",
              "cache-control": "public, max-age=20",
            },
          },
        );
      },
    },
  },
});
