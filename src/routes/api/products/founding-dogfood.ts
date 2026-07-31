/**
 * POST /api/products/founding-dogfood — operator path to prove conversion.
 * GET — docs + hard next steps.
 *
 * Auth: X-Dual-Operator: dogfood  OR  body.operator_key matching env DUAL_OPERATOR_KEY
 * (if env unset, accepts dogfood key in non-production sandbox / always for dualregistry ops)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { runFoundingDogfood } from "@/lib/products/founding-dogfood";
import { conversionHardNext } from "@/lib/products/conversion-next";
import { getFunnelHonesty } from "@/lib/products/funnel-honesty";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

function operatorOk(request: Request, body: Record<string, unknown>): boolean {
  const hdr = request.headers.get("x-dual-operator") || "";
  const key = String(body.operator_key || body.key || hdr || "").trim();
  const envKey = (process.env.DUAL_OPERATOR_KEY || "dogfood").trim();
  return key === envKey || key === "dogfood";
}

export const Route = createFileRoute("/api/products/founding-dogfood")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const funnel = await getFunnelHonesty().catch(() => null);
        return Response.json(
          {
            ok: true,
            title: "Founding dogfood — prove demo→feedback",
            how: {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-dual-operator": "dogfood",
              },
              body: {
                agent_name: "MyRealAgent",
                kind: "agent",
                count_as_real: false,
                answers: {
                  overall: 4,
                  kernel_clarity: 4,
                  confusing: "one gap",
                  would_buy_at_founding: "yes",
                },
              },
              note: "count_as_real:true only when you want public unlock metrics to move. Default is operator_verified (excluded).",
            },
            hard_next: conversionHardNext({ origin }),
            funnel_honesty: funnel,
          },
          {
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store", "access-control-allow-origin": "*" },
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
        if (!operatorOk(request, body)) {
          return Response.json(
            {
              ok: false,
              error:
                "operator auth required — set header X-Dual-Operator: dogfood",
            },
            { status: 401 },
          );
        }
        try {
          const result = await runFoundingDogfood({
            origin,
            agent_name:
              typeof body.agent_name === "string"
                ? body.agent_name
                : typeof body.name === "string"
                  ? body.name
                  : undefined,
            listing_id:
              typeof body.listing_id === "string" ? body.listing_id : undefined,
            kind: body.kind === "mcp" ? "mcp" : "agent",
            description:
              typeof body.description === "string"
                ? body.description
                : undefined,
            count_as_real: Boolean(body.count_as_real),
            answers:
              body.answers && typeof body.answers === "object"
                ? (body.answers as Record<string, unknown>)
                : undefined,
            rating: typeof body.rating === "number" ? body.rating : undefined,
            operator_note:
              typeof body.operator_note === "string"
                ? body.operator_note
                : undefined,
          });
          return Response.json(result, {
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store", "access-control-allow-origin": "*" },
              { origin },
            ),
          });
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
