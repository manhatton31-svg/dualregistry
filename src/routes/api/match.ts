/**
 * GET|POST /api/match — capability matchmaking over Active clean + ARD.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { matchCapabilities } from "@/lib/products/capability-match";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/match")({
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
        const kind = (url.searchParams.get("kind") || "all") as
          | "agent"
          | "mcp"
          | "all";
        const limit = Number(url.searchParams.get("limit") || 12);
        const federation = (url.searchParams.get("federation") ||
          "referrals") as "none" | "referrals" | "auto";
        if (!q.trim()) {
          return Response.json(
            {
              ok: false,
              error: "q required",
              example: `${origin}/api/match?q=github+issues&kind=mcp`,
              tool: "match_capability via POST /api/protocol tools/call",
            },
            {
              status: 400,
              headers: withDemoCtaHeaders(
                { "access-control-allow-origin": "*" },
                { origin },
              ),
            },
          );
        }
        const result = await matchCapabilities(origin, q, {
          kind,
          limit,
          federation,
        });
        return Response.json(result, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
            { origin },
          ),
        });
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: {
          q?: string;
          query?: string;
          kind?: "agent" | "mcp" | "all";
          limit?: number;
          federation?: "none" | "referrals" | "auto";
        } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        const q = body.q || body.query || "";
        if (!q.trim()) {
          return Response.json(
            { ok: false, error: "q required" },
            { status: 400 },
          );
        }
        const result = await matchCapabilities(origin, q, {
          kind: body.kind || "all",
          limit: body.limit || 12,
          federation: body.federation || "referrals",
        });
        return Response.json(result, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
            { origin },
          ),
        });
      },
    },
  },
});
