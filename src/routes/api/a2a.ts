/**
 * Inbound A2A — agents call Dual Registry.
 * GET  /api/a2a — endpoint info + card pointer
 * POST /api/a2a — JSON-RPC message/send | tasks/send
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { agents1AgentCard } from "@/lib/agents1/a2a-card";
import { handleInboundA2a } from "@/lib/products/inbound-a2a";
import { inboundDiscoverySurfaces } from "@/lib/products/dual-strategy";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/a2a")({
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
        return Response.json(
          {
            ok: true,
            protocol: "a2a",
            endpoint: `${origin}/api/a2a`,
            agent_card: `${origin}/.well-known/agent.json`,
            methods: ["message/send", "tasks/send", "help"],
            card: agents1AgentCard(origin),
            discovery: inboundDiscoverySurfaces(origin),
            note: "POST JSON-RPC body to self-serve list/demo/status. Dual strategy: inbound + outbound both live.",
          },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "public, max-age=60",
                "access-control-allow-origin": "*",
              },
              { origin },
            ),
          },
        );
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        try {
          const result = await handleInboundA2a(request, body);
          return Response.json(result, {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
              { origin },
            ),
          });
        } catch (e) {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32000,
                message: e instanceof Error ? e.message : String(e),
              },
            },
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
