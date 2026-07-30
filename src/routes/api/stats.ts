/**
 * Authoritative registry counts for the dashboard.
 * Prefer live /v1/milestones when free-tier allows; else last-known cache.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  invalidateStoreCacheMem,
  loadStoreCache,
  saveStoreCache,
  buildMilestones,
} from "@/lib/agents1/store-cache";
import { shouldLiveFetch, recordGet, detectKvLimitMessage, tripGetLimit } from "@/lib/agents1/free-tier";
import { STORE_BASE } from "@/lib/agents1/types";

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const refresh = url.searchParams.get("refresh") === "1";

        invalidateStoreCacheMem();
        let cache = await loadStoreCache();

        let source = "cache";
        let live = false;
        if (refresh) {
          const gate = await shouldLiveFetch({ force: true });
          if (gate.allow) {
            try {
              await recordGet(1);
              const res = await fetch(`${STORE_BASE}/v1/milestones`, {
                headers: {
                  accept: "application/json",
                  "user-agent": "Agents1Stats/1.0",
                },
                signal: AbortSignal.timeout(12000),
              });
              const text = await res.text();
              const kind = detectKvLimitMessage(text);
              if (kind === "get") {
                await tripGetLimit("stats milestones get limit");
              } else if (res.ok && text.trim().startsWith("{")) {
                const mil = JSON.parse(text) as {
                  mcp?: { approved?: number };
                  agents?: { approved?: number };
                };
                const mcp = mil.mcp?.approved;
                const agents = mil.agents?.approved;
                if (typeof mcp === "number" && typeof agents === "number") {
                  await saveStoreCache({
                    ...cache,
                    mcp_approved: mcp,
                    agents_approved: agents,
                    milestones: buildMilestones(mcp, agents, {
                      base: mil as never,
                    }),
                    live: true,
                    source: "milestones",
                    updated_at: new Date().toISOString(),
                  });
                  cache = await loadStoreCache();
                  source = "milestones";
                  live = true;
                }
              }
            } catch {
              /* keep cache */
            }
          }
        }

        const mcp =
          cache.milestones?.mcp?.approved ?? cache.mcp_approved;
        const agents =
          cache.milestones?.agents?.approved ?? cache.agents_approved;

        return Response.json(
          {
            ok: true,
            live,
            source,
            mcp_approved: mcp,
            agents_approved: agents,
            payment_unlock: {
              rule: "250 feedback agents + 250 feedback MCPs",
              note: "Registry counts are listings only — not payment gate",
            },
            theme_pipeline: {
              individual_until: 3,
              sitewide_at: 4,
              note: "First 3 agents with a theme get individualized Kernel/Loop; 4th reuse ships sitewide. Public improvement log.",
            },
            cache_updated_at: cache.updated_at,
            note: live
              ? "Live store milestones"
              : "Cached (use ?refresh=1 when free-tier allows)",
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
