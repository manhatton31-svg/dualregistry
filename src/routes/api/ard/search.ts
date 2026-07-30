/**
 * ARD registry search — natural language / keyword over Dual catalog + Active
 * GET  /api/ard/search?q=…&federation=referrals|auto|none
 * POST /api/ard/search { q, limit?, federation? }
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  ardSearch,
  type ArdFederationMode,
} from "@/lib/agents1/ai-catalog";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

function parseFed(raw: string | null | undefined): ArdFederationMode {
  const v = (raw || "referrals").toLowerCase();
  if (v === "none" || v === "auto" || v === "referrals") return v;
  return "referrals";
}

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
        const federation = parseFed(url.searchParams.get("federation"));
        try {
          const result = await ardSearch(origin, q, { limit, federation });
          return Response.json(
            {
              ok: true,
              protocol: "ard",
              ...result,
              note: "Dual Registry ARD search — static catalog + Active projection + federation referrals",
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
        let body: {
          q?: string;
          query?: string;
          limit?: number;
          federation?: string;
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* */
        }
        const q = body.q || body.query || "";
        try {
          const result = await ardSearch(origin, q, {
            limit: body.limit,
            federation: parseFed(body.federation),
          });
          return Response.json(
            {
              ok: true,
              protocol: "ard",
              ...result,
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
