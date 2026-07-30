/**
 * Preference pairs A/B + report for Kernel/Loop learning.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  getPreferenceReport,
  recordPreferencePair,
  preferencePairCatalog,
} from "@/lib/products/preference-learning";
import { getPatchReport } from "@/lib/products/prompt-patches";
import { getClarityByVersion } from "@/lib/products/post-ship-probe";
import { getBehavioralInsights } from "@/lib/products/product-events";

export const Route = createFileRoute("/api/products/preferences")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        }),
      GET: async () => {
        const [prefs, patches, clarity, behavior] = await Promise.all([
          getPreferenceReport(),
          getPatchReport(),
          getClarityByVersion(),
          getBehavioralInsights(),
        ]);
        return Response.json(
          {
            ok: true,
            preference_pairs: prefs,
            prompt_patches: patches,
            clarity_by_version: clarity,
            behavioral: behavior,
            catalog: preferencePairCatalog(),
          },
          {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "JSON required" },
            { status: 400 },
          );
        }
        const winner = String(body.winner || "").toLowerCase();
        if (!["a", "b", "tie"].includes(winner)) {
          return Response.json(
            { ok: false, error: "winner must be a|b|tie" },
            { status: 400 },
          );
        }
        const pair = await recordPreferencePair({
          pair_id: body.pair_id ? String(body.pair_id) : undefined,
          theme: body.theme ? String(body.theme) : undefined,
          winner: winner as "a" | "b" | "tie",
          order_id: body.order_id ? String(body.order_id) : undefined,
          agent_name: body.agent_name ? String(body.agent_name) : undefined,
          audience: (body.audience as "agent" | "mcp" | "paid") || "unknown",
          artifact_version: body.artifact_version
            ? String(body.artifact_version)
            : "2.2.0",
          kernel_clarity:
            typeof body.kernel_clarity === "number"
              ? body.kernel_clarity
              : undefined,
          source: body.source ? String(body.source) : "api",
        });
        return Response.json(
          { ok: true, pair, report: await getPreferenceReport() },
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
