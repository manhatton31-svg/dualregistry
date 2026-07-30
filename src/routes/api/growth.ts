import { createFileRoute } from "@tanstack/react-router";
import { dataRoot } from "@/lib/data-root";

export const Route = createFileRoute("/api/growth")({
  server: {
    handlers: {
      GET: async () => {
        const { ensureGrowthScheduler, getGrowthStatus } = await import(
          "@/lib/agents1/growth/server"
        );
        ensureGrowthScheduler();
        const status = await getGrowthStatus();
        let probe_worker: unknown = null;
        try {
          const { readFile } = await import("node:fs/promises");
          const { join } = await import("node:path");
          probe_worker = JSON.parse(
            await readFile(
              join(dataRoot(), "growth", "probe-worker.json"),
              "utf8",
            ),
          );
        } catch {
          probe_worker = { status: "missing", hint: "sh /workspace/startup.sh starts scripts/probe-worker.mjs" };
        }
        let probes: unknown = null;
        try {
          const { getProbePublic } = await import("@/lib/agents1/probe");
          probes = await getProbePublic();
        } catch {
          /* */
        }
        return Response.json(
          { ...status, probe_worker, probes },
          { headers: { "cache-control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const {
          ensureGrowthScheduler,
          runGrowthCycle,
          submitByUrl,
        } = await import("@/lib/agents1/growth/server");
        ensureGrowthScheduler();
        let body: {
          action?: string;
          url?: string;
          maxSubmit?: number;
          reason?: string;
          kind?: "get" | "put" | "both";
        } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }

        if (body.action === "submit_url" && body.url) {
          return Response.json(await submitByUrl(body.url));
        }

        if (body.action === "probe_tick" || body.action === "probe") {
          const { runProbeTick } = await import(
            "@/lib/agents1/growth/engine"
          );
          const r = await runProbeTick();
          return Response.json(
            { action: "probe_tick", ...r },
            { headers: { "cache-control": "no-store" } },
          );
        }

        if (
          body.action === "cf_safe" ||
          body.action === "trip_limit" ||
          body.action === "kv_safe"
        ) {
          const { tripCfExhausted, publicBudgetView, loadFreeTier } =
            await import("@/lib/agents1/free-tier");
          const kind = body.kind || "both";
          const reason =
            body.reason ||
            `Manual CF KV safe-mode (${kind}) — pause Agents1 store traffic until UTC midnight`;
          await tripCfExhausted(kind, reason);
          return Response.json({
            ok: true,
            action: "cf_safe",
            kind,
            reason,
            budget: publicBudgetView(await loadFreeTier()),
          });
        }

        if (
          body.action === "cf_paid" ||
          body.action === "reopen" ||
          body.action === "upgrade"
        ) {
          const { reopenAfterUpgrade, publicBudgetView, CF_PLAN } =
            await import("@/lib/agents1/free-tier");
          const state = await reopenAfterUpgrade(
            body.reason ||
              `CF ${CF_PLAN} upgrade acknowledged — budgets reset, write-safe cleared`,
          );
          return Response.json({
            ok: true,
            action: "reopen",
            plan: CF_PLAN,
            budget: publicBudgetView(state),
          });
        }

        const maxSubmit = Math.min(body.maxSubmit ?? 20, 50);
        return Response.json(
          await runGrowthCycle({ force: true, maxSubmit }),
        );
      },
    },
  },
});
