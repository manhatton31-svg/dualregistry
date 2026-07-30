import { createFileRoute } from "@tanstack/react-router";
import { buildPreview } from "@/lib/products/preview";
import { trackFunnel } from "@/lib/products/learning-loop";
import { goalsFromListing, GOAL_PRESETS } from "@/lib/products/demo-funnel";

export const Route = createFileRoute("/api/products/preview")({
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
      GET: async () =>
        Response.json({
          name: "Agents1 free kernel preview",
          usage:
            "POST { goals?, agent_name?, description?, preset?, short_preview? } — goals optional with preset/description",
          presets: Object.keys(GOAL_PRESETS),
          note: "Free ~30-line taste. Demo Alive for full artifacts. Payments at 250 feedback agents + 250 feedback MCPs.",

        }),
      POST: async ({ request }) => {
        let body: {
          goals?: string;
          agent_name?: string;
          domain?: string;
          constraints?: string;
          success_metrics?: string;
          description?: string;
          preset?: string;
          short_preview?: boolean;
        } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "JSON required" }, { status: 400 });
        }
        let goals = (body.goals || "").trim();
        if (goals.length < 8) {
          const resolved = goalsFromListing({
            name: body.agent_name,
            description: body.description,
            preset: body.preset,
          });
          goals = resolved.goals;
        }
        if (goals.length < 8) {
          return Response.json(
            {
              ok: false,
              error: "goals required (or description/preset)",
              presets: Object.keys(GOAL_PRESETS),
            },
            { status: 400 },
          );
        }
        const preview = buildPreview({
          goals,
          agent_name: body.agent_name,
          domain: body.domain,
          constraints: body.constraints,
          success_metrics: body.success_metrics,
          short_preview: body.short_preview !== false,
          preset: body.preset,
          description: body.description,
        });
        await trackFunnel("previews");
        return Response.json(
          {
            ok: true,
            preview,
            next: "demo_alive",
            message:
              "Preview ready. Call demo_alive or one_click_demo for full demo; feedback → founding 25% vault.",
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
