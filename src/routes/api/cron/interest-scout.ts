/**
 * External Interest Scout cron — $5/mo xAI-ranked outbound to external agents/MCPs.
 *
 * GET/POST /api/cron/interest-scout
 * Auth: x-vercel-cron: 1 | CRON_SECRET (Bearer / ?secret= / x-cron-secret)
 * Optional: ?dry_run=1 | ?max=N
 *
 * Env:
 *   INTEREST_SCOUT_MONTHLY_BUDGET_USD=5 (default)
 *   INTEREST_SCOUT_MAX_PER_DAY=20
 *   INTEREST_SCOUT_COOLDOWN_DAYS=14
 *   INTEREST_SCOUT_SCORE_MIN=0.7
 *   XAI_API_KEY (recommended — grok-build-0.1 scoring; heuristic fallback)
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
  const maxRaw = url.searchParams.get("max");
  const max = maxRaw
    ? Math.min(20, Math.max(0, Number(maxRaw) || 0))
    : undefined;

  const t0 = Date.now();
  try {
    const { runInterestScout } = await import(
      "@/lib/agents1/growth/interest-scout"
    );
    const result = await runInterestScout({
      dry_run,
      max,
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
        route: "/api/cron/interest-scout",
        label:
          result.status === "budget_exhausted"
            ? "interest_scout_budget_exhausted"
            : "interest_scout",
        skipped: result.status === "budget_exhausted",
        await_persist: true,
      });
      const { recordAgentRun } = await import("@/lib/agents1/agent-runs");
      await recordAgentRun({
        title:
          result.status === "budget_exhausted"
            ? "interest_scout_budget_exhausted"
            : "interest_scout",
        tool: "interest_scout",
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
          outreaches_sent: result.outreaches_sent,
          scored: result.scored,
          keyword_hits: result.keyword_hits,
          budget_remaining_usd: result.budget_remaining_usd,
          month_usd: result.month_usd,
          used_llm: result.used_llm,
          xai_configured: result.xai_configured,
        },
        route: "/api/cron/interest-scout",
      });
    } catch {
      /* observability soft */
    }

    let scoutRaw: string | null = null;
    try {
      scoutRaw = await readDurableRaw("interest-scout.json");
    } catch {
      /* */
    }

    return Response.json(
      {
        ...result,
        wall_ms,
        commit: scoutRaw
          ? { "data/prod/interest-scout.json": scoutRaw }
          : undefined,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const wall_ms = Date.now() - t0;
    try {
      const { recordAgentRun } = await import("@/lib/agents1/agent-runs");
      await recordAgentRun({
        title: "interest_scout_error",
        tool: "interest_scout",
        trigger: "cron",
        status: "error",
        duration_ms: wall_ms,
        bill: false,
        error: e instanceof Error ? e.message : String(e),
        route: "/api/cron/interest-scout",
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

export const Route = createFileRoute("/api/cron/interest-scout")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
