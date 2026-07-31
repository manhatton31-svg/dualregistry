/**
 * GET /.well-known/signature-agent-card.json
 * Cloudflare / IETF Web Bot Auth Signature Agent Card for Dual Registry.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/.well-known/signature-agent-card.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request).replace(/\/$/, "");
        const body = {
          client_id: o,
          client_name: "Dual Registry",
          client_uri: `${o}/for-agents`,
          logo_uri: `${o}/favicon.svg`,
          contacts: [`${o}/for-agents`],
          jwks_uri: `${o}/.well-known/http-message-signatures-directory`,
          web_bot_auth: {
            "expected-user-agent":
              "DualRegistryNudge/1.2 (+https://dualregistry.dev; soft-invite)",
            "rfc9309-product-token": "DualRegistry",
            "rfc9309-compliance": [
              "User-Agent",
              "Allow",
              "Disallow",
              "Content-Signal",
            ],
            trigger: "fetcher",
            purpose: "registry-invite",
          },
          known_urls: [
            "/",
            "/robots.txt",
            "/.well-known/agent-card.json",
            "/.well-known/ai-catalog.json",
            "/api/listings/active",
            "/api/products/demo",
          ],
          dual_strategy: {
            outbound: "soft_demo_invite to Active clean only",
            inbound: "self-serve publish + demo + feedback",
            anti_spam: "30-day silence after Talk DM",
          },
          a2a_agent_card: `${o}/.well-known/agent-card.json`,
          mcp_server_card: `${o}/.well-known/mcp/server-card.json`,
        };
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
              "access-control-allow-origin": "*",
            },
            { origin: o },
          ),
        });
      },
    },
  },
});
