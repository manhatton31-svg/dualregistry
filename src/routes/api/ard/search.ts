/**
 * ARD registry search — natural language / keyword over Dual catalog + Active
 * GET  /api/ard/search?q=…
 * POST /api/ard/search { q, limit? }
 */
import { createFileRoute } from "@tanstack/react-router";
import { ardSearch } from "@/lib/agents1/ai-catalog";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/ard/search")({
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
        const q = url.searchParams.get("q") || url.searchParams.get("query") || "";
        const limit = parseInt(url.searchParams.get("limit") || "12", 10) || 12;
        try {
          const result = await ardSearch(origin, q, { limit });
          return Response.json(
            {
              ok: true,
              protocol: "ard",
              ...result,
              federation: "none",
              note: "Dual Registry ARD search — catalog entries + Active clean listings",
            },
            {
              headers: withDemoCtaHeaders(
                { "cache-control": "public, max-age=30" },
                { origin },
              ),
            },
          );
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            {
              status: 500,
              headers: withDemoCtaHeaders(undefined, { origin }),
            },
          );
        }
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: { q?: string; query?: string; limit?: number } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* */
        }
        const q = body.q || body.query || "";
        try {
          const result = await ardSearch(origin, q, { limit: body.limit });
          return Response.json(
            {
              ok: true,
              protocol: "ard",
              ...result,
              federation: "none",
            },
            {
              headers: withDemoCtaHeaders(
                { "cache-control": "no-store" },
                { origin },
              ),
            },
          );
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            {
              status: 500,
              headers: withDemoCtaHeaders(undefined, { origin }),
            },
          );
        }
      },
    },
  },
});
