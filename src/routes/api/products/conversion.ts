import { createFileRoute } from "@tanstack/react-router";
import { buildConversionPath } from "@/lib/products/conversion";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { trackFunnel } from "@/lib/products/learning-loop";

export const Route = createFileRoute("/api/products/conversion")({
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
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const path = await buildConversionPath({
          origin,
          agent_name: url.searchParams.get("agent_name") || undefined,
          agent_card_url: url.searchParams.get("agent_card_url") || undefined,
          listed: url.searchParams.get("listed") !== "0",
        });
        await trackFunnel("conversions_shown");
        return Response.json(
          { ok: true, conversion: path },
          {
            headers: {
              "cache-control": "public, max-age=30",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: Record<string, unknown> = {};
        try {
          body = await request.json();
        } catch {
          /* empty ok */
        }
        const path = await buildConversionPath({
          origin,
          agent_name: body.agent_name ? String(body.agent_name) : undefined,
          agent_card_url: body.agent_card_url
            ? String(body.agent_card_url)
            : undefined,
          goals_hint: body.goals ? String(body.goals) : undefined,
          listed: body.listed !== false,
        });
        await trackFunnel("conversions_shown");
        return Response.json(
          { ok: true, conversion: path },
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
