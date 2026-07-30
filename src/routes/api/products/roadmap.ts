/**
 * Public feedback → product roadmap scoreboard.
 * Top themes, canary/shipped/rejected, cost mult estimates.
 */
import { createFileRoute } from "@tanstack/react-router";
import { listReviewQueue } from "@/lib/products/system-ship";
import { recentChanges } from "@/lib/products/change-log";
import { getLifecyclePublic } from "@/lib/products/feedback-lifecycle";
import { getFeedbackInsights, getWtpReport } from "@/lib/products/feedback";

export const Route = createFileRoute("/api/products/roadmap")({
  server: {
    handlers: {
      GET: async () => {
        const [review, life, insights, changes, wtp] = await Promise.all([
          listReviewQueue(),
          getLifecyclePublic(),
          getFeedbackInsights(),
          recentChanges(20),
          getWtpReport(),
        ]);

        const top = [
          ...review.queue.map((i) => ({
            theme: i.theme,
            status: i.status,
            count: i.count,
            severity: i.severity,
            cost_mult: i.estimated_system_cost_multiplier,
            quality_delta: i.estimated_quality_delta,
            ab: i.ab_metrics || null,
            action: i.product_action,
          })),
          ...review.shipped.slice(0, 10).map((i) => ({
            theme: i.theme,
            status: i.status,
            count: i.count,
            severity: i.severity,
            cost_mult: i.estimated_system_cost_multiplier,
            quality_delta: i.estimated_quality_delta,
            ab: i.ab_metrics || null,
            action: i.product_action,
          })),
        ]
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        return Response.json(
          {
            ok: true,
            title: "Agents1 Kernel / Loop feedback roadmap",
            tagline:
              "Agents shape the product. ≥3 agents → review; canary A/B; ship only after human step.",
            top_themes: top,
            shipped_global: review.shipped_global,
            lifecycle_metrics: life.metrics,
            willingness_to_pay: {
              by_sku: wtp.by_sku,
              recommendations: wtp.recommendations,
              samples_n: wtp.samples.length,
              note: wtp.note,
            },
            demo_insights: {
              n: insights.n,
              avg_overall: insights.avg_overall,
              top_improvements: insights.top_improvements.slice(0, 5),
            },
            recent_changes: changes.map((c) => ({
              kind: c.kind,
              title: c.title,
              detail: c.detail,
              themes: c.themes,
              at: c.created_at,
            })),
            policy: review.policy,
            how_to_contribute: {
              demo: "POST /api/products/feedback (survey → 25% code)",
              paid: "POST /api/products/lifecycle with answers + telemetry",
              incident: "POST /api/products/lifecycle { phase_id: 'incident', ... }",
            },
          },
          {
            headers: {
              "cache-control": "public, max-age=30",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
