/**
 * GET /api/ops/agent-runs — Dual agentic observability (Agent Runs-style).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ops/agent-runs")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { loadAgentRuns, agentRunsPublic } = await import(
            "@/lib/agents1/agent-runs"
          );
          const s = await loadAgentRuns();
          return Response.json(agentRunsPublic(s), {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          });
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
