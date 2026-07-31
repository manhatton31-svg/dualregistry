/**
 * GET/POST /api/mcp — primary MCP streamable-http alias for Dual tools.
 * GET is CDN/ETag-cached metadata; POST is live JSON-RPC (no-store).
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
import { discoveryJsonResponse } from "@/lib/agents1/discovery-cache";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";
import { withTrackedRequest } from "@/lib/agents1/track-request";

export const maxDuration = MAX_DURATION.mcp_post;
export const preferredRegion = PREFERRED_REGION;

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
              "content-type, mcp-session-id, accept, if-none-match",
          },
        }),
      GET: async ({ request }) =>
        withTrackedRequest(
          {
            class: "discovery",
            route: "/api/mcp",
            label: "mcp_get_meta",
          },
          async () => {
            const origin = resolvePublicOrigin(request);
            const pack = discoveryPack(origin);
            const hard = conversionHardNext({ origin });
            const body = {
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
              note: "POST JSON-RPC here. Prefer improve_kernel / run_loop_tick / mesh_match (free allowance, no demo order). leave_feedback optional. Human path: /products.",

              card: agents1McpServerCard(origin),
              dual_as_tool: mcpToolCatalogPublic(origin),
            };
            return discoveryJsonResponse(request, body, {
              browser: 30,
              cdn: 120,
              swr: 300,
              fingerprint: `mcp-meta|${origin}|${REGISTRY_TOOLS_VERSION}`,
              extraHeaders: withDemoCtaHeaders(
                { "access-control-allow-origin": "*" },
                { origin },
              ),
            });
          },
        ),
      POST: async ({ request }) =>
        withTrackedRequest(
          {
            class: "mcp",
            route: "/api/mcp",
            label: "mcp_post",
          },
          async () => {
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
        ),
    },
  },
});
