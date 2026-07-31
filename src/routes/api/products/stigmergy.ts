/**
 * GET /api/products/stigmergy — public stigmergy medium status
 * POST — leave_trace | sense | follow | endorse | used_with | evaporate
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import {
  getStigmergyPublic,
  leaveTrace,
  senseTraces,
  followTrail,
  evaporateAll,
  STIGMERGY_VERSION,
} from "@/lib/products/stigmergy";

export const Route = createFileRoute("/api/products/stigmergy")({
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
        const body = await getStigmergyPublic({ origin, limit: 12 });
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-stigmergy": STIGMERGY_VERSION,
            },
            { origin },
          ),
        });
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const action = String(body.action || body.op || "sense").toLowerCase();

        let result: unknown;
        if (action === "leave" || action === "leave_trace" || action === "deposit") {
          result = await leaveTrace({
            listing_id:
              typeof body.listing_id === "string" ? body.listing_id : undefined,
            listing_b:
              typeof body.listing_b === "string" ? body.listing_b : undefined,
            kind: body.kind as
              | "mark"
              | "endorse"
              | "used_with"
              | "intent"
              | "note"
              | "danger"
              | undefined,
            body: typeof body.body === "string" ? body.body : undefined,
            from: typeof body.from === "string" ? body.from : undefined,
            tags: Array.isArray(body.tags)
              ? (body.tags as unknown[]).map(String)
              : undefined,
            intensity:
              typeof body.intensity === "number" ? body.intensity : undefined,
          });
        } else if (action === "endorse") {
          result = await leaveTrace({
            listing_id: String(body.listing_id || ""),
            kind: "endorse",
            body: typeof body.body === "string" ? body.body : "endorsed",
            from: typeof body.from === "string" ? body.from : undefined,
            intensity: 12,
          });
        } else if (action === "used_with") {
          result = await leaveTrace({
            listing_id: String(body.listing_id || ""),
            listing_b: String(body.listing_b || ""),
            kind: "used_with",
            body: typeof body.body === "string" ? body.body : undefined,
            from: typeof body.from === "string" ? body.from : undefined,
          });
        } else if (action === "follow" || action === "follow_trail") {
          result = await followTrail({
            kind:
              (body.kind as "hot" | "dangerous" | "demand" | "composition") ||
              "hot",
            limit: Number(body.limit) || 12,
          });
        } else if (action === "evaporate") {
          result = await evaporateAll();
        } else {
          result = await senseTraces({
            listing_id:
              typeof body.listing_id === "string" ? body.listing_id : undefined,
            q: typeof body.q === "string" ? body.q : undefined,
            limit: Number(body.limit) || 12,
          });
        }

        return Response.json(
          { ok: true, action, version: STIGMERGY_VERSION, result, origin },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
              { origin },
            ),
          },
        );
      },
    },
  },
});
