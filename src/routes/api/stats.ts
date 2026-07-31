/**
 * Authoritative registry counts — CLEAN ACTIVE ONLY.
 * Soft CDN + ETag (60s edge) — public stats change slowly.
 */
import { createFileRoute } from "@tanstack/react-router";
import { discoveryJsonResponse } from "@/lib/agents1/discovery-cache";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";
import { withTrackedRequest } from "@/lib/agents1/track-request";

export const maxDuration = MAX_DURATION.api_read;
export const preferredRegion = PREFERRED_REGION;

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        withTrackedRequest(
          {
            class: "api_read",
            route: "/api/stats",
            label: "stats",
          },
          async () => {
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

            let funnel_honesty: unknown = null;
            try {
              const { getFunnelHonesty } = await import(
                "@/lib/products/funnel-honesty"
              );
              funnel_honesty = await getFunnelHonesty();
            } catch {
              funnel_honesty = null;
            }

            const body = {
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
              funnel_honesty,
              note: "Clean-only counts (probe ok at source URL). Store dumps are not Dual Registry. funnel_honesty splits invited vs real demos.",
            };

            // Fingerprint counts + funnel key fields so 304 works across CDN
            const fh = funnel_honesty as {
              demos_real?: number;
              feedback_real?: number;
            } | null;
            return discoveryJsonResponse(request, body, {
              browser: 30,
              cdn: 60,
              swr: 120,
              fingerprint: `stats|${mcp}|${agents}|${fh?.demos_real ?? 0}|${fh?.feedback_real ?? 0}`,
            });
          },
        ),
    },
  },
});
