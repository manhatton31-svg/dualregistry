/**
 * GET/POST /api/mcp — primary MCP streamable-http alias for Dual tools.
 * Same JSON-RPC surface as /api/protocol (initialize | tools/list | tools/call | ping).
 * Fixes clients that probe /api/mcp or /mcp and previously hit HTML-only 500s.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  handleMcpJsonRpc,
  listRegistryTools,
  mcpToolCatalogPublic,
  REGISTRY_TOOLS_VERSION,
} from "@/lib/products/registry-tools";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { agents1McpServerCard } from "@/lib/agents1/a2a-card";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { discoveryPack } from "@/lib/products/discovery-pack";
import { conversionHardNext } from "@/lib/products/conversion-next";

export const Route = createFileRoute("/api/mcp")({
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
        const pack = discoveryPack(origin);
        const hard = conversionHardNext({ origin });
        return Response.json(
          {
            ok: true,
            name: "dualregistry",
            transport: "streamable-http",
            mcp_release: "2026-07-28",
            stateless: true,
            version: REGISTRY_TOOLS_VERSION,
            endpoint: `${origin}/api/mcp`,
            aliases: [`${origin}/api/protocol`, `${origin}/mcp`],
            methods: ["initialize", "tools/list", "tools/call", "ping"],
            tools: listRegistryTools(origin).map((t) => t.name),
            server_card: `${origin}/.well-known/mcp/server-card.json`,
            mcp_json: `${origin}/.well-known/mcp.json`,
            discovery: pack,
            hard_next: hard,
            deal: hard.founding,
            note: "POST JSON-RPC here. Prefer take_demo then leave_feedback for founding seats.",
            card: agents1McpServerCard(origin),
            dual_as_tool: mcpToolCatalogPublic(origin),
          },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "public, max-age=30",
                "access-control-allow-origin": "*",
                "content-type": "application/json; charset=utf-8",
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
          /* */
        }
        const method = String(body.method || "");
        if (
          body.jsonrpc === "2.0" ||
          method.startsWith("tools/") ||
          method === "initialize" ||
          method === "ping" ||
          method === "notifications/initialized" ||
          method === "mcp/initialize" ||
          !method
        ) {
          // empty POST → tools/list convenience
          if (!method && body.jsonrpc !== "2.0") {
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
                "content-type": "application/json",
              },
              { origin },
            ),
          });
        }
        return Response.json(
          {
            ok: false,
            error:
              "Use JSON-RPC {jsonrpc:'2.0',method:'tools/list'|'tools/call'|'initialize'}",
            dual_as_tool: mcpToolCatalogPublic(origin),
            hard_next: conversionHardNext({ origin }),
          },
          {
            status: 400,
            headers: withDemoCtaHeaders(
              { "access-control-allow-origin": "*" },
              { origin },
            ),
          },
        );
      },
    },
  },
});
