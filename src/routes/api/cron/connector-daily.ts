/**
 * GET/POST /api/cron/connector-daily
 * Safe automation: once per UTC day, rank + draft + durable log.
 * NEVER emails connector targets. Optional operator digest only.
 *
 * Auth: x-vercel-cron | CRON_SECRET
 */
import { createFileRoute } from "@tanstack/react-router";
import { bootstrapSecrets, getSecret } from "@/lib/secrets";

export const maxDuration = 30;

function authorized(request: Request): boolean {
  if (request.headers.get("x-vercel-cron") === "1") return true;
  bootstrapSecrets();
  const secret = (getSecret("cron_secret") || process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  const hdr = request.headers.get("x-cron-secret") || "";
  if (hdr === secret) return true;
  try {
    const u = new URL(request.url);
    if (u.searchParams.get("secret") === secret) return true;
  } catch {
    /* */
  }
  return false;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const origin = "https://www.dualregistry.dev";
  const { runConnectorDailyPrep, getConnectorDailyStatus } = await import(
    "@/lib/products/connector-daily"
  );
  const prep = await runConnectorDailyPrep({ origin });
  const status = await getConnectorDailyStatus();
  return Response.json({
    ok: true,
    route: "/api/cron/connector-daily",
    prep,
    status,
    hard_laws: {
      auto_send_to_targets: false,
      max_first_touch_per_day: 1,
      quiet_outbound_respected: true,
    },
  });
}

export const Route = createFileRoute("/api/cron/connector-daily")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
