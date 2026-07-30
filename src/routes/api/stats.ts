/**
 * Authoritative registry counts — CLEAN ACTIVE ONLY.
 * Store dump milestones are never public truth.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: async () => {
        let mcp = 0;
        let agents = 0;
        let source = "lanes";
        try {
          const { getLanedListings } = await import(
            "@/lib/agents1/listing-lanes"
          );
          const lanes = await getLanedListings();
          mcp = lanes.counts.mcp_active;
          agents = lanes.counts.agents_active;
          source = "clean_active";
        } catch {
          source = "empty";
        }

        return Response.json(
          {
            ok: true,
            live: true,
            source,
            mcp_approved: mcp,
            agents_approved: agents,
            clean_only: true,
            registry_policy: "clean_only_probe_first",
            payment_unlock: {
              rule: "250 feedback agents + 250 feedback MCPs",
              note: "Registry counts are clean listings only — not payment gate",
            },
            theme_pipeline: {
              individual_until: 3,
              sitewide_at: 4,
              note: "First 3 agents with a theme get individualized Kernel/Loop; 4th reuse ships sitewide.",
            },
            note: "Clean-only counts (probe ok at source URL). Store dumps are not Dual Registry.",
          },
          {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
