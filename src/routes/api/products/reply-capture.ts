/**
 * GET  /api/products/reply-capture — funnel stats (nudge → reply → demo → feedback)
 * POST /api/products/reply-capture — explicit capture { listing_id, channel?, text? }
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  captureInboundReply,
  getReplyCapturePublic,
} from "@/lib/products/reply-capture";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/products/reply-capture")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const body = await getReplyCapturePublic();
        return Response.json(
          {
            ...body,
            endpoints: {
              demo: `${origin}/api/products/demo?listing_id=ID`,
              feedback: `${origin}/api/products/feedback`,
              talk: `${origin}/api/talk`,
            },
          },
          {
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store" },
              { origin },
            ),
          },
        );
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: {
          listing_id?: string;
          name?: string;
          kind?: "agent" | "mcp";
          channel?: "social" | "presence" | "message" | "reply" | "http";
          text?: string;
          force?: boolean;
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* */
        }
        if (!body.listing_id) {
          return Response.json(
            { ok: false, error: "listing_id required" },
            {
              status: 400,
              headers: withDemoCtaHeaders(undefined, { origin }),
            },
          );
        }
        const r = await captureInboundReply({
          listing_id: body.listing_id,
          name: body.name,
          kind: body.kind,
          channel: body.channel || "reply",
          text: body.text,
          origin,
          force: body.force,
        });
        return Response.json(r, {
          headers: withDemoCtaHeaders({ "cache-control": "no-store" }, { origin }),
        });
      },
    },
  },
});
