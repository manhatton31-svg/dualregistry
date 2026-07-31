/**
 * GET/POST /api/products/interop — unified capability graph + protocol adapters
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import {
  getInteropPublic,
  buildCapabilityGraph,
  interopResolve,
  composePeers,
  openInteropSession,
  appendInteropSession,
  getInteropSession,
  INTEROP_VERSION,
} from "@/lib/products/interop";

export const Route = createFileRoute("/api/products/interop")({
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
        const action = (url.searchParams.get("action") || "status").toLowerCase();
        let body: unknown;
        if (action === "graph") {
          body = await buildCapabilityGraph({
            origin,
            q: url.searchParams.get("q") || undefined,
            limit: Number(url.searchParams.get("limit")) || 40,
          });
        } else if (action === "resolve") {
          body = await interopResolve({
            origin,
            q: url.searchParams.get("q") || undefined,
            listing_id: url.searchParams.get("listing_id") || undefined,
            tool: url.searchParams.get("tool") || undefined,
            skill: url.searchParams.get("skill") || undefined,
            prefer:
              (url.searchParams.get("prefer") as
                | "mcp"
                | "a2a"
                | "ard"
                | "http"
                | "dns") || "mcp",
            limit: Number(url.searchParams.get("limit")) || 8,
          });
        } else if (action === "compose") {
          body = await composePeers({
            origin,
            listing_id: url.searchParams.get("listing_id") || undefined,
            limit: Number(url.searchParams.get("limit")) || 10,
          });
        } else {
          body = await getInteropPublic({ origin });
        }
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-interop": INTEROP_VERSION,
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
        const action = String(body.action || body.op || "status").toLowerCase();
        let result: unknown;
        if (action === "graph") {
          result = await buildCapabilityGraph({
            origin,
            q: typeof body.q === "string" ? body.q : undefined,
            limit: Number(body.limit) || 40,
          });
        } else if (action === "resolve") {
          result = await interopResolve({
            origin,
            q: typeof body.q === "string" ? body.q : undefined,
            listing_id:
              typeof body.listing_id === "string" ? body.listing_id : undefined,
            tool: typeof body.tool === "string" ? body.tool : undefined,
            skill: typeof body.skill === "string" ? body.skill : undefined,
            prefer:
              (body.prefer as "mcp" | "a2a" | "ard" | "http" | "dns") || "mcp",
            limit: Number(body.limit) || 8,
          });
        } else if (action === "compose") {
          result = await composePeers({
            origin,
            listing_id:
              typeof body.listing_id === "string" ? body.listing_id : undefined,
            limit: Number(body.limit) || 10,
          });
        } else if (action === "session_open") {
          result = await openInteropSession({
            entry_protocol:
              (body.entry_protocol as "mcp" | "a2a" | "ard" | "http" | "dns") ||
              "http",
            listing_id:
              typeof body.listing_id === "string" ? body.listing_id : undefined,
            agent_name:
              typeof body.agent_name === "string" ? body.agent_name : undefined,
            match_q: typeof body.match_q === "string" ? body.match_q : undefined,
          });
        } else if (action === "session_append") {
          result = await appendInteropSession(String(body.session_id || ""), {
            action: String(body.step_action || "step"),
            protocol: body.entry_protocol as
              | "mcp"
              | "a2a"
              | "ard"
              | "http"
              | "dns"
              | undefined,
            detail: typeof body.detail === "string" ? body.detail : undefined,
            demo_order_id:
              typeof body.demo_order_id === "string"
                ? body.demo_order_id
                : undefined,
            feedback_id:
              typeof body.feedback_id === "string" ? body.feedback_id : undefined,
          });
        } else if (action === "session_get") {
          result = await getInteropSession(String(body.session_id || ""));
        } else {
          result = await getInteropPublic({ origin });
        }
        return Response.json(
          { ok: true, action, version: INTEROP_VERSION, result, origin },
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
