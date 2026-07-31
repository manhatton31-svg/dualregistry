/**
 * GET /.well-known/http-message-signatures-directory
 * Web Bot Auth / Signature-Agent directory (JWKS-shaped) for Dual outbound identity.
 * Complements A2A card JWS — Cloudflare Verified Bots style.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getAgentCardJwks } from "@/lib/agents1/card-sign";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute(
  "/.well-known/http-message-signatures-directory",
)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request).replace(/\/$/, "");
        const jwks = await getAgentCardJwks(origin);
        const body = {
          keys: jwks.keys,
          // Signature Agent Card metadata (draft-meunier-webbotauth-registry)
          client_id: origin,
          client_name: "Dual Registry",
          client_uri: `${origin}/for-agents`,
          logo_uri: `${origin}/favicon.svg`,
          contacts: ["https://dualregistry.dev/for-agents"],
          jwks_uri: `${origin}/.well-known/http-message-signatures-directory`,
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
            purpose_note:
              "Soft demo invites to Active clean listings only; 30d silence; no content scrape for training",
          },
          dualregistry: {
            agent_card: `${origin}/.well-known/agent-card.json`,
            jwks_a2a: `${origin}/.well-known/jwks.json`,
            signature_agent_card: `${origin}/.well-known/signature-agent-card.json`,
          },
        };
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
              "access-control-allow-origin": "*",
            },
            { origin },
          ),
        });
      },
    },
  },
});
