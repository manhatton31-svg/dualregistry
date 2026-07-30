/**
 * POST /api/talk — open or continue a real conversation with a clean listing.
 * GET  /api/talk?listing_id= — open session + verify reachability
 * GET  /api/talk?verify=all — batch-verify every clean agent/MCP
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/talk")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const verify = url.searchParams.get("verify");
        const listingId = url.searchParams.get("listing_id") || "";

        if (verify === "all") {
          const { verifyAllClean } = await import("@/lib/agents1/talk");
          const r = await verifyAllClean();
          return Response.json(
            {
              ok: true,
              total: r.total,
              reachable: r.ok,
              fail: r.fail,
              rows: r.rows,
            },
            {
              headers: {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
            },
          );
        }

        if (!listingId) {
          return Response.json(
            {
              ok: false,
              error: "listing_id required (or ?verify=all)",
              usage: {
                open: "GET /api/talk?listing_id=ID",
                send: "POST /api/talk { listing_id, message, session_id? }",
                verify_all: "GET /api/talk?verify=all",
              },
            },
            { status: 400 },
          );
        }

        const { openTalkSession } = await import("@/lib/agents1/talk");
        const r = await openTalkSession(listingId);
        return Response.json(r, {
          headers: {
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      },
      POST: async ({ request }) => {
        let body: {
          listing_id?: string;
          message?: string;
          text?: string;
          session_id?: string;
        } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        const listingId = body.listing_id || "";
        const message = (body.message || body.text || "").trim();
        if (!listingId) {
          return Response.json(
            { ok: false, error: "listing_id required" },
            { status: 400 },
          );
        }
        if (!message) {
          const { openTalkSession } = await import("@/lib/agents1/talk");
          const r = await openTalkSession(listingId);
          return Response.json(r, {
            headers: { "access-control-allow-origin": "*" },
          });
        }
        const { sendTalkMessage, openTalkSession } = await import(
          "@/lib/agents1/talk"
        );
        let sessionId = body.session_id || "";
        if (!sessionId) {
          const opened = await openTalkSession(listingId);
          sessionId = opened.session.session_id;
        }
        const r = await sendTalkMessage(sessionId, listingId, message);
        return Response.json(r, {
          headers: {
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
