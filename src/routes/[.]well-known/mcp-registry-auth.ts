/**
 * GET /.well-known/mcp-registry-auth
 * Official MCP Registry HTTP domain authentication challenge.
 * Public key only — private key used offline by mcp-publisher login http.
 */
import { createFileRoute } from "@tanstack/react-router";

/** Ed25519 public key (base64) for dualregistry.dev MCP registry namespace */
const MCP_REGISTRY_AUTH_LINE =
  "v=MCPv1; k=ed25519; p=AYLu/dJpwe1IkWiuahzQKYa1MXgQckdaxZ3y8jRzu7Q=";

export const Route = createFileRoute("/.well-known/mcp-registry-auth")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(`${MCP_REGISTRY_AUTH_LINE}\n`, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
