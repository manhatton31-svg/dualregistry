/**
 * GET/POST /api/products/collab-session — multi-party agent/MCP sessions
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import {
  COLLAB_SESSION_VERSION,
  getSessionPublic,
  openSession,
  joinSession,
  postMessage,
  addStep,
  nextForListing,
  claimStep,
  postStepResult,
  closeSession,
  getSession,
  listSessions,
} from "@/lib/products/collab-session";
import type { CollabNode } from "@/lib/products/collab-studio";

export const Route = createFileRoute("/api/products/collab-session")({
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
        const id = url.searchParams.get("id") || url.searchParams.get("session_id");
        if (id) {
          const session = await getSession(id);
          if (!session) {
            return Response.json(
              { ok: false, error: "session_not_found" },
              {
                status: 404,
                headers: withDemoCtaHeaders(
                  { "cache-control": "no-store", "access-control-allow-origin": "*" },
                  { origin },
                ),
              },
            );
          }
          return Response.json(
            { ok: true, session },
            {
              headers: withDemoCtaHeaders(
                {
                  "cache-control": "no-store",
                  "access-control-allow-origin": "*",
                  "x-dual-collab-session": COLLAB_SESSION_VERSION,
                },
                { origin },
              ),
            },
          );
        }
        const listing_id = url.searchParams.get("listing_id") || undefined;
        const sessions = await listSessions({
          listing_id: listing_id || undefined,
          limit: 30,
        });
        const pub = await getSessionPublic({ origin });
        return Response.json(
          { ...pub, sessions: sessions.map((s) => ({
            id: s.id,
            goal: s.goal,
            status: s.status,
            workflow_id: s.workflow_id,
            participant_n: s.participants.length,
            pending_steps: s.steps.filter((x) => x.status === "pending" || x.status === "claimed").length,
            updated_at: s.updated_at,
          })) },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
                "x-dual-collab-session": COLLAB_SESSION_VERSION,
              },
              { origin },
            ),
          },
        );
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const action = String(body.action || body.op || "open").toLowerCase();
        let result: unknown;

        if (action === "open") {
          const lead: CollabNode = {
            listing_id: String(body.listing_id || body.lead_listing_id || ""),
            name: String(body.agent_name || body.name || body.listing_id || "lead"),
            kind: body.kind === "mcp" ? "mcp" : "agent",
            role: "lead",
          };
          const partners: CollabNode[] = [];
          if (typeof body.partner_listing_id === "string") {
            partners.push({
              listing_id: body.partner_listing_id,
              name: String(body.partner_name || body.partner_listing_id),
              kind: body.partner_kind === "mcp" ? "mcp" : "agent",
              role: "partner",
            });
          }
          if (Array.isArray(body.partner_listing_ids)) {
            for (const id of body.partner_listing_ids as unknown[]) {
              const s = String(id);
              if (s) partners.push({ listing_id: s, name: s, kind: "agent", role: "partner" });
            }
          }
          if (Array.isArray(body.nodes)) {
            const nodes = body.nodes as CollabNode[];
            result = await openSession({
              goal: String(body.goal || ""),
              origin,
              lead: nodes[0] || lead,
              partners: nodes.slice(1),
              workflow_id: typeof body.workflow_id === "string" ? body.workflow_id : undefined,
            });
          } else {
            result = await openSession({
              goal: String(body.goal || ""),
              origin,
              lead,
              partners,
              workflow_id: typeof body.workflow_id === "string" ? body.workflow_id : undefined,
            });
          }
        } else if (action === "join") {
          result = await joinSession({
            session_id: String(body.session_id || body.id || ""),
            listing_id: String(body.listing_id || ""),
            name: typeof body.agent_name === "string" ? body.agent_name : undefined,
          });
        } else if (action === "message") {
          result = await postMessage({
            session_id: String(body.session_id || ""),
            from_listing_id: String(body.listing_id || body.from_listing_id || ""),
            text: String(body.text || body.message || ""),
            to_listing_id: typeof body.to_listing_id === "string" ? body.to_listing_id : undefined,
          });
        } else if (action === "add_step") {
          result = await addStep({
            session_id: String(body.session_id || ""),
            from_listing_id: String(body.listing_id || body.from_listing_id || ""),
            assignee_listing_id: String(body.assignee_listing_id || body.listing_id || ""),
            instruction: String(body.instruction || body.text || ""),
          });
        } else if (action === "next") {
          result = await nextForListing({
            session_id: String(body.session_id || ""),
            listing_id: String(body.listing_id || ""),
          });
        } else if (action === "claim") {
          result = await claimStep({
            session_id: String(body.session_id || ""),
            step_id: String(body.step_id || ""),
            listing_id: String(body.listing_id || ""),
          });
        } else if (action === "result" || action === "post_result") {
          result = await postStepResult({
            session_id: String(body.session_id || ""),
            step_id: String(body.step_id || ""),
            listing_id: String(body.listing_id || ""),
            ok: body.ok !== false,
            body: typeof body.body === "string" ? body.body : typeof body.result === "string" ? body.result : undefined,
            artifact: body.artifact,
          });
        } else if (action === "close") {
          result = await closeSession({
            session_id: String(body.session_id || ""),
            listing_id: String(body.listing_id || ""),
            origin,
            package: body.package !== false,
            publish: body.publish !== false,
            title: typeof body.title === "string" ? body.title : undefined,
            price_cents: typeof body.price_cents === "number" ? body.price_cents : undefined,
          });
        } else if (action === "list") {
          result = {
            ok: true,
            sessions: await listSessions({
              listing_id: typeof body.listing_id === "string" ? body.listing_id : undefined,
            }),
          };
        } else {
          result = { ok: false, error: "unknown_action", allowed: ["open","join","message","add_step","next","claim","result","close","list"] };
        }

        return Response.json(result, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-collab-session": COLLAB_SESSION_VERSION,
            },
            { origin },
          ),
        });
      },
    },
  },
});
