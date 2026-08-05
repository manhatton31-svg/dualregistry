/**
 * GET /api/ops/secrets-status — presence-only secret diagnostics (no values).
 */
import { createFileRoute } from "@tanstack/react-router";

function authorized(request: Request): boolean {
  const secret =
    process.env.OPS_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return true;
  const url = new URL(request.url);
  const q = url.searchParams.get("secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const hdr =
    request.headers.get("x-cron-secret") ||
    request.headers.get("x-ops-secret") ||
    "";
  return q === secret || bearer === secret || hdr === secret;
}

export const Route = createFileRoute("/api/ops/secrets-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          if (!authorized(request)) {
            return Response.json(
              { ok: false, error: "unauthorized" },
              { status: 401 },
            );
          }
          const { bootstrapSecrets, secretsStatus } = await import(
            "@/lib/secrets"
          );
          bootstrapSecrets();
          const st = secretsStatus();
          return Response.json(
            {
              ...st,
              note: "Values never returned. Set missing keys in Vercel → Environment Variables, then redeploy.",
              local_env_file: ".env.local (gitignored)",
            },
            {
              headers: {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
            },
          );
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
