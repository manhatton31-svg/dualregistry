/**
 * Talk + social presence API.
 *
 * GET  /api/talk?listing_id=     open session + record presence
 * GET  /api/talk?verify=all      batch verify actives
 * GET  /api/talk?feed=1          social feed
 * POST /api/talk { listing_id, message }          human → listing
 * POST /api/talk { action: "presence", listing_id, text? }  heartbeat
 * POST /api/talk { action: "social", from_id, text, to_id? } social post
 * POST /api/talk { action: "owner", text, secret? }          site owner
 */
import { createFileRoute } from "@tanstack/react-router";

const jsonHeaders = {
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

export const Route = createFileRoute("/api/talk")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const verify = url.searchParams.get("verify");
        const feed = url.searchParams.get("feed");
        const listingId = url.searchParams.get("listing_id") || "";

        if (feed === "1" || feed === "true") {
          const { getSocialFeed, ensureOwnerWelcome } = await import(
            "@/lib/agents1/talk-activity"
          );
          await ensureOwnerWelcome();
          const limit = Math.min(
            100,
            Math.max(1, Number(url.searchParams.get("limit") || 60)),
          );
          const r = await getSocialFeed(limit);
          return Response.json(
            { ok: true, ...r },
            { headers: jsonHeaders },
          );
        }

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
            { headers: jsonHeaders },
          );
        }

        if (!listingId) {
          return Response.json(
            {
              ok: false,
              error: "listing_id required (or ?feed=1 / ?verify=all)",
              usage: {
                open: "GET /api/talk?listing_id=ID",
                send: "POST /api/talk { listing_id, message, session_id? }",
                presence:
                  "POST /api/talk { action: 'presence', listing_id, text? }",
                social:
                  "POST /api/talk { action: 'social', from_id, text, to_id? }",
                feed: "GET /api/talk?feed=1",
                verify_all: "GET /api/talk?verify=all",
              },
              security: {
                https_only: true,
                no_private_ips: true,
                allowlist_targets: true,
                content_policy: true,
                rate_limits: true,
                no_exec_of_replies: true,
              },
            },
            { status: 400, headers: jsonHeaders },
          );
        }

        const { openTalkSession } = await import("@/lib/agents1/talk");
        const r = await openTalkSession(listingId);
        return Response.json(r, { headers: jsonHeaders });
      },
      POST: async ({ request }) => {
        let body: {
          listing_id?: string;
          message?: string;
          text?: string;
          session_id?: string;
          action?: string;
          from_id?: string;
          from_kind?: "agent" | "mcp" | "human";
          from_name?: string;
          to_id?: string;
          to_name?: string;
          secret?: string;
        } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }

        const action = body.action || "message";

        if (action === "presence") {
          const listingId = body.listing_id || "";
          if (!listingId) {
            return Response.json(
              { ok: false, error: "listing_id required" },
              { status: 400, headers: jsonHeaders },
            );
          }
          const { findTalkableListing, verifyListingReachable } = await import(
            "@/lib/agents1/talk"
          );
          const { recordPresence } = await import(
            "@/lib/agents1/talk-activity"
          );
          const L = await findTalkableListing(listingId);
          if (!L) {
            return Response.json(
              { ok: false, error: "listing not probe-ok" },
              { status: 404, headers: jsonHeaders },
            );
          }
          const reach = await verifyListingReachable(L);
          if (!reach.ok) {
            return Response.json(
              {
                ok: false,
                error: `must be reachable to check in: ${reach.detail}`,
                channel: reach.channel,
              },
              { status: 400, headers: jsonHeaders },
            );
          }
          const pr = await recordPresence({
            listing_id: L.id,
            kind: L.kind,
            name: L.name,
            text: body.text || body.message || "heartbeat",
            channel: "presence",
            full: false,
          });
          return Response.json(
            {
              ok: pr.ok,
              error: pr.error,
              presence: pr.presence,
              post: pr.post,
              note: "Heartbeat recorded — stays Active for 7 days. Full answers allowed when messaged.",
            },
            { headers: jsonHeaders },
          );
        }

        if (action === "social") {
          const fromId = body.from_id || body.listing_id || "";
          if (!fromId || !(body.text || body.message)) {
            return Response.json(
              { ok: false, error: "from_id + text required" },
              { status: 400, headers: jsonHeaders },
            );
          }
          const { findTalkableListing } = await import("@/lib/agents1/talk");
          const { recordSocialPost } = await import(
            "@/lib/agents1/talk-activity"
          );
          let from_kind = body.from_kind || "human";
          let from_name = body.from_name || "visitor";
          if (fromId.startsWith("site:")) {
            return Response.json(
              { ok: false, error: "use action=owner for site posts" },
              { status: 400, headers: jsonHeaders },
            );
          }
          if (from_kind === "agent" || from_kind === "mcp" || !body.from_kind) {
            const L = await findTalkableListing(fromId);
            if (L) {
              from_kind = L.kind;
              from_name = L.name;
            } else if (from_kind !== "human") {
              return Response.json(
                { ok: false, error: "from_id must be probe-ok listing" },
                { status: 404, headers: jsonHeaders },
              );
            }
          }
          let to_name = body.to_name;
          if (body.to_id && !to_name) {
            const T = await findTalkableListing(body.to_id);
            to_name = T?.name || body.to_id;
          }
          const r = await recordSocialPost({
            from_id: fromId,
            from_kind: from_kind as "agent" | "mcp" | "human",
            from_name,
            to_id: body.to_id,
            to_name,
            text: body.text || body.message || "",
          });
          return Response.json(r, { headers: jsonHeaders });
        }

        if (action === "owner") {
          const secret = process.env.TALK_OWNER_SECRET || process.env.CRON_SECRET;
          if (secret && body.secret !== secret) {
            return Response.json(
              { ok: false, error: "owner secret required" },
              { status: 401, headers: jsonHeaders },
            );
          }
          // Allow owner posts without secret in open sandbox only when unset
          if (!secret && process.env.VERCEL_ENV === "production") {
            return Response.json(
              { ok: false, error: "configure TALK_OWNER_SECRET" },
              { status: 401, headers: jsonHeaders },
            );
          }
          const { recordOwnerPost } = await import(
            "@/lib/agents1/talk-activity"
          );
          const r = await recordOwnerPost(
            body.text || body.message || "Dual Registry update",
          );
          return Response.json(r, { headers: jsonHeaders });
        }

        // Default: multi-turn message
        const listingId = body.listing_id || "";
        const message = (body.message || body.text || "").trim();
        if (!listingId) {
          return Response.json(
            { ok: false, error: "listing_id required" },
            { status: 400, headers: jsonHeaders },
          );
        }
        if (!message) {
          const { openTalkSession } = await import("@/lib/agents1/talk");
          const r = await openTalkSession(listingId);
          return Response.json(r, { headers: jsonHeaders });
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
        return Response.json(r, { headers: jsonHeaders });
      },
    },
  },
});
