/**
 * Production probe tick — Vercel Cron + GitHub Actions every 6 minutes.
 *
 * GET/POST /api/cron/probe
 * Optional: Authorization: Bearer $CRON_SECRET or ?secret=
 *
 * Returns full durable probe snapshot so Actions can commit data/prod/probes.json
 * without needing a write token on Vercel.
 */
import { createFileRoute } from "@tanstack/react-router";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import { durableConfigPublic, readDurableRaw } from "@/lib/agents1/durable-json";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // open tick (budget-capped at 240/day)
  const url = new URL(request.url);
  const q = url.searchParams.get("secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const hdr = request.headers.get("x-cron-secret") || "";
  return q === secret || bearer === secret || hdr === secret;
}

async function stampWorker(patch: Record<string, unknown>) {
  try {
    const dir = join(dataRoot(), "growth");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "probe-worker.json");
    let prev: Record<string, unknown> = {};
    try {
      const { readFile } = await import("node:fs/promises");
      prev = JSON.parse(await readFile(path, "utf8"));
    } catch {
      /* */
    }
    const next = {
      ...prev,
      ...patch,
      mode: "production-cron",
      origin: "https://dualregistry.dev",
      tick_ms: 6 * 60_000,
      updated_at: new Date().toISOString(),
    };
    await writeFile(path, JSON.stringify(next, null, 2), "utf8");
    return next;
  } catch {
    return patch;
  }
}

async function runTick() {
  // Warm store cache so probe targets exist (listings from store)
  try {
    const { getLiveSnapshot } = await import("@/lib/agents1/fetch-live");
    await getLiveSnapshot({ forceLive: true });

  } catch {
    try {
      const { loadStoreCache } = await import("@/lib/agents1/store-cache");
      await loadStoreCache();
    } catch {
      /* */
    }
  }

  const { runProbeTick } = await import("@/lib/agents1/growth/engine");
  const { invalidateProbeCache, loadProbeState } = await import(
    "@/lib/agents1/probe"
  );
  invalidateProbeCache();
  const result = await runProbeTick({ max: 1 });
  invalidateProbeCache();
  const state = await loadProbeState();
  const worker = await stampWorker({
    status: "ok",
    last_tick_at: new Date().toISOString(),
    last_result: result.last_result || null,
    probed: result.probed,
    used: result.used,
    ticks: Number((result as { used?: number }).used || 0),
    notes: result.notes?.slice(0, 8),
  });

  const probesRaw = await readDurableRaw("probes.json");
  const growthRaw = await readDurableRaw("growth-state.json");
  const cacheRaw = await readDurableRaw("store-cache.json");

  // Count live active from probe oks
  const oks = Object.entries(state.results || {}).filter(
    ([k, r]) =>
      !k.startsWith("name:") &&
      !k.startsWith("url:") &&
      r &&
      r.ok &&
      r.handshake === "ok",
  ).length;

  return {
    ok: true,
    action: "probe_tick",
    probed: result.probed,
    used_today: state.used,
    budget: state.budget,
    live_active_probe_ok: oks,
    last_result: result.last_result,
    notes: result.notes,
    worker,
    durable: durableConfigPublic(),
    // For GitHub Actions commit
    commit: {
      "data/prod/probes.json": probesRaw,
      "data/prod/growth-state.json": growthRaw,
      "data/prod/store-cache.json": cacheRaw
        ? // trim huge caches for commit size — keep counts + recent items
          (() => {
            try {
              const c = JSON.parse(cacheRaw);
              return JSON.stringify(
                {
                  ...c,
                  mcp_items: (c.mcp_items || []).slice(0, 200),
                  agent_items: (c.agent_items || []).slice(0, 200),
                },
                null,
                2,
              );
            } catch {
              return cacheRaw.slice(0, 500_000);
            }
          })()
        : null,
    },
  };
}

export const Route = createFileRoute("/api/cron/probe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorized(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        try {
          const body = await runTick();
          return Response.json(body, {
            headers: { "cache-control": "no-store" },
          });
        } catch (e) {
          await stampWorker({
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
      POST: async ({ request }) => {
        if (!authorized(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        try {
          const body = await runTick();
          return Response.json(body, {
            headers: { "cache-control": "no-store" },
          });
        } catch (e) {
          await stampWorker({
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
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
