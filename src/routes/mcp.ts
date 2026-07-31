/**
 * GET/POST /mcp — short alias for Dual MCP streamable-http (same as /api/mcp).
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  handleMcpJsonRpc,
  listRegistryTools,
  mcpToolCatalogPublic,
  REGISTRY_TOOLS_VERSION,
} from "@/lib/products/registry-tools";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { conversionHardNext } from "@/lib/products/conversion-next";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers":
              "content-type, mcp-session-id, accept",
          },
        }),
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        return Response.json(
          {
            ok: true,
            name: "dualregistry",
            transport: "streamable-http",
            version: REGISTRY_TOOLS_VERSION,
            endpoint: `${origin}/mcp`,
            primary: `${origin}/api/mcp`,
            protocol_alias: `${origin}/api/protocol`,
            methods: ["initialize", "tools/list", "tools/call", "ping"],
            tools: listRegistryTools(origin).map((t) => t.name),
            hard_next: conversionHardNext({ origin }),
            note: "POST JSON-RPC tools/list | tools/call. take_demo → leave_feedback for founding.",
            dual_as_tool: mcpToolCatalogPublic(origin),
          },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "public, max-age=30",
                "access-control-allow-origin": "*",
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
          body = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {},
          };
        }
        if (!body.method && body.jsonrpc !== "2.0") {
          body = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {},
          };
        }
        const result = await handleMcpJsonRpc(body, { request, origin });
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
