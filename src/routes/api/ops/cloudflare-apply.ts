/**
 * POST /api/ops/cloudflare-apply
 * Body: { token?: string, domain?: string }  OR Authorization: Bearer CRON_SECRET
 * Applies _mcp DNS TXT (+ best-effort robots settings) via Cloudflare API.
 */
import { createFileRoute } from "@tanstack/react-router";
import { applyCloudflareDiscoverability, CF_ACCOUNT_ID } from "@/lib/agents1/cloudflare-ops";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { checkMcpDns } from "@/lib/agents1/dns-mcp";

function authorized(request: Request, bodyToken?: string): boolean {
  const secret = process.env.CRON_SECRET || process.env.OPS_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  const header =
    request.headers.get("x-cron-secret") ||
    request.headers.get("x-ops-secret") ||
    "";
  if (secret && (auth === `Bearer ${secret}` || header === secret)) return true;
  // Allow one-shot when caller provides CF token in body (operator apply)
  if (bodyToken && bodyToken.length >= 20) return true;
  // Dev
  if (process.env.NODE_ENV !== "production" && bodyToken) return true;
  return false;
}

export const Route = createFileRoute("/api/ops/cloudflare-apply")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const dns = await checkMcpDns(origin);
        return Response.json({
          ok: true,
          purpose: "Apply Dual Registry Cloudflare DNS (_mcp TXT) + robots guidance",
          cloudflare_account_id: CF_ACCOUNT_ID,
          required_env: ["CLOUDFLARE_API_TOKEN"],
          optional_env: ["CLOUDFLARE_ZONE_ID", "CLOUDFLARE_ACCOUNT_ID", "CRON_SECRET"],
          token_scopes: [
            "Zone → DNS → Edit",
            "Zone → Zone → Read",
            "Include zone dualregistry.dev",
          ],
          create_token_url:
            "https://dash.cloudflare.com/profile/api-tokens",
          dns_status: dns,
          post: {
            url: `${origin.replace(/\/$/, "")}/api/ops/cloudflare-apply`,
            headers: {
              Authorization: "Bearer CRON_SECRET",
              "Content-Type": "application/json",
            },
            body: {
              token: "optional-if-CLOUDFLARE_API_TOKEN-env-set",
              domain: "dualregistry.dev",
            },
          },
        });
      },
      POST: async ({ request }) => {
        let body: { token?: string; domain?: string; origin?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* */
        }
        if (!authorized(request, body.token)) {
          return Response.json(
            {
              ok: false,
              error:
                "Unauthorized. Pass Authorization: Bearer CRON_SECRET or body.token (Cloudflare API token).",
            },
            { status: 401 },
          );
        }
        const origin = body.origin || resolvePublicOrigin(request);
        const result = await applyCloudflareDiscoverability({
          token: body.token,
          domain: body.domain,
          origin,
        });
        const dns = await checkMcpDns(origin);
        return Response.json(
          {
            ...result,
            verify: dns,
            next:
              result.ok && dns.live
                ? "DNS live. Discovery stack complete."
                : result.token_present
                  ? "Re-check /api/dns/mcp-status in ~60s (TTL)."
                  : "Create CLOUDFLARE_API_TOKEN and POST again or set Vercel env.",
          },
          { status: result.ok ? 200 : 400 },
        );
      },
    },
  },
});
