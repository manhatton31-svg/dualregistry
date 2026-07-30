/**
 * GET /api/listing-lanes — public CLEAN ACTIVE ONLY.
 * Discovered / needs_resubmit never returned (product law).
 */
import { createFileRoute } from "@tanstack/react-router";
import { getLanedListings } from "@/lib/agents1/listing-lanes";

export const Route = createFileRoute("/api/listing-lanes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind"); // mcp | agents | all
        const data = await getLanedListings();
        const payload: Record<string, unknown> = {
          ok: true,
          policy: data.policy,
          counts: {
            mcp_active: data.counts.mcp_active,
            agents_active: data.counts.agents_active,
            mcp_discovered: 0,
            agents_discovered: 0,
            mcp_needs_resubmit: 0,
            agents_needs_resubmit: 0,
            public_listed: data.counts.public_listed,
          },
          categories: data.categories,
          // Explicit empties so old clients don't keep rendering fail walls
          mcp_discovered: [],
          agents_discovered: [],
          mcp_needs_resubmit: [],
          agents_needs_resubmit: [],
        };
        if (!kind || kind === "all" || kind === "mcp") {
          payload.mcp_active = data.mcp_active;
        }
        if (!kind || kind === "all" || kind === "agents") {
          payload.agents_active = data.agents_active;
        }
        return Response.json(payload, {
          headers: {
            "access-control-allow-origin": "*",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
