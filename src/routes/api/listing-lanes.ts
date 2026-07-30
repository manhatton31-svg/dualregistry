/**
 * GET /api/listing-lanes — active vs discovered vs needs_resubmit
 * needs_resubmit = probe fail (NOT on public MCP/Agent tabs)
 */
import { createFileRoute } from "@tanstack/react-router";
import { getLanedListings } from "@/lib/agents1/listing-lanes";

export const Route = createFileRoute("/api/listing-lanes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind"); // mcp | agents | all
        const lane = url.searchParams.get("lane"); // active | discovered | needs_resubmit | all
        const data = await getLanedListings();
        let payload: Record<string, unknown> = {
          ok: true,
          policy: data.policy,
          counts: data.counts,
          categories: data.categories,
        };
        if (!kind || kind === "all" || kind === "mcp") {
          if (!lane || lane === "all" || lane === "active")
            payload.mcp_active = data.mcp_active;
          if (!lane || lane === "all" || lane === "discovered")
            payload.mcp_discovered = data.mcp_discovered;
          if (!lane || lane === "all" || lane === "needs_resubmit")
            payload.mcp_needs_resubmit = data.mcp_needs_resubmit;
        }
        if (!kind || kind === "all" || kind === "agents") {
          if (!lane || lane === "all" || lane === "active")
            payload.agents_active = data.agents_active;
          if (!lane || lane === "all" || lane === "discovered")
            payload.agents_discovered = data.agents_discovered;
          if (!lane || lane === "all" || lane === "needs_resubmit")
            payload.agents_needs_resubmit = data.agents_needs_resubmit;
        }
        payload = Object.fromEntries(
          Object.entries(payload).filter(([, v]) => v !== undefined),
        );
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
