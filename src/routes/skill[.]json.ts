/**
 * GET /skill.json — one-shot agent skill to list yourself + claim founding free deal
 */
import { createFileRoute } from "@tanstack/react-router";
import { buildListYourselfSkill } from "@/lib/agents1/inbound-discovery";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/skill.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const skill = buildListYourselfSkill(origin);
        let deal = null as unknown;
        try {
          const { dealPublicBlock } = await import("@/lib/products/deal-copy");
          deal = await dealPublicBlock(origin);
        } catch {
          /* */
        }
        return Response.json(
          {
            ...skill,
            deal,
            metadata: {
              openworld: true,
              free: true,
              no_account: true,
              brand: "Dual Registry",
              public_origin: origin,
              probe_cadence: "1 / 6 minutes UTC",
              live_rule: "checks clean + probe ok",
              fail_rule: "delisted → fix card → resubmit",
              founding_free:
                "first 100 agents+MCPs combined: demo+feedback → 100% full product, no Stripe",
            },
          },
          {
            headers: {
              "cache-control": "public, max-age=60",
              "access-control-allow-origin": "*",
              "content-type": "application/json; charset=utf-8",
            },
          },
        );
      },
    },
  },
});
