/**
 * Interest Closer cron — $2/mo xAI follow-ups that help Interest Scout convert.
 *
 * GET/POST /api/cron/interest-closer
 * Auth: x-vercel-cron: 1 | CRON_SECRET
 * Optional: ?dry_run=1 | ?max=N | ?ignore_lag=1
 *
 * Env:
 *   INTEREST_CLOSER_MONTHLY_BUDGET_USD=2 (default)
 *   INTEREST_CLOSER_MAX_PER_DAY=8
 *   INTEREST_CLOSER_MIN_LAG_HOURS=48
 *   INTEREST_CLOSER_SCORE_MIN=0.7
 *   XAI_API_KEY (recommended — grok-build-0.1 follow-up copy)
 *   CRON_SECRET
 */
import { createFileRoute } from "@tanstack/react-router";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";
import { readDurableRaw } from "@/lib/agents1/durable-json";

export const maxDuration = MAX_DURATION.cron_prefilter; // 60s
export const preferredRegion = PREFERRED_REGION;

function authorized(request: Request): boolean {
  if (request.headers.get("x-vercel-cron") === "1") return true;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const url = new URL(request.url);
  const q = url.searchParams.get("secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const hdr = request.headers.get("x-cron-secret") || "";
  return q === secret || bearer === secret || hdr === secret;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dry_run =
    url.searchParams.get("dry_run") === "1" ||
    url.searchParams.get("dry_run") === "true";
  const ignore_lag =
    url.searchParams.get("ignore_lag") === "1" ||
    url.searchParams.get("ignore_lag") === "true";
  const maxRaw = url.searchParams.get("max");
  const max = maxRaw
    ? Math.min(12, Math.max(0, Number(maxRaw) || 0))
    : undefined;

  const t0 = Date.now();
  try {
    const { runInterestCloser } = await import(
      "@/lib/agents1/growth/interest-closer"
    );
    const result = await runInterestCloser({
      dry_run,
      max,
      ignore_lag,
      origin: url.origin.includes("localhost")
        ? "https://www.dualregistry.dev"
        : url.origin,
    });

    const wall_ms = Date.now() - t0;
    try {
      const { recordPlatformUsage } = await import(
        "@/lib/agents1/platform-cost"
      );
      await recordPlatformUsage({
        class: "product",
        wall_ms,
        route: "/api/cron/interest-closer",
        label:
          result.status === "budget_exhausted"
            ? "interest_closer_budget_exhausted"
            : "interest_closer",
        skipped: result.status === "budget_exhausted",
        await_persist: true,
      });
      const { recordAgentRun } = await import("@/lib/agents1/agent-runs");
      await recordAgentRun({
        title:
          result.status === "budget_exhausted"
            ? "interest_closer_budget_exhausted"
            : "interest_closer",
        tool: "interest_closer",
        trigger: "cron",
        status:
          result.status === "error"
            ? "error"
            : result.status === "budget_exhausted"
              ? "skipped"
              : "ok",
        duration_ms: wall_ms,
        usd_estimate: result.cycle_usd ?? 0,
        bill: false,
        await_persist: true,
        meta: {
          followups_sent: result.followups_sent,
          pool: result.pool,
          eligible: result.eligible,
          budget_remaining_usd: result.budget_remaining_usd,
          month_usd: result.month_usd,
          used_llm: result.used_llm,
          xai_configured: result.xai_configured,
        },
        route: "/api/cron/interest-closer",
      });
    } catch {
      /* observability soft */
    }

    let closerRaw: string | null = null;
    try {
      closerRaw = await readDurableRaw("interest-closer.json");
    } catch {
      /* */
    }

    return Response.json(
      {
        ...result,
        wall_ms,
        commit: closerRaw
          ? { "data/prod/interest-closer.json": closerRaw }
          : undefined,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const wall_ms = Date.now() - t0;
    try {
      const { recordAgentRun } = await import("@/lib/agents1/agent-runs");
      await recordAgentRun({
        title: "interest_closer_error",
        tool: "interest_closer",
        trigger: "cron",
        status: "error",
        duration_ms: wall_ms,
        bill: false,
        error: e instanceof Error ? e.message : String(e),
        route: "/api/cron/interest-closer",
      });
    } catch {
      /* */
    }
    return Response.json(
      {
        ok: false,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        wall_ms,
      },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/cron/interest-closer")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
