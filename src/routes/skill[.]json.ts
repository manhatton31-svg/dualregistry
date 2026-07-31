/**
 * GET /skill.json — one-shot agent skill to list yourself + list yourself and try free demos
 */
import { createFileRoute } from "@tanstack/react-router";
import { buildListYourselfSkill } from "@/lib/agents1/inbound-discovery";
import { packsFromRequest } from "@/lib/agents1/install-packs";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/skill.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const skill = buildListYourselfSkill(origin);
        const packs = packsFromRequest(request);
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
            install: {
              index: `${origin}/install.json`,
              openclaw: packs.packs.openclaw,
              hermes: packs.packs.hermes,
              openclaw_md: `${origin}/skills/openclaw.md`,
              hermes_md: `${origin}/skills/hermes.md`,
              dualregistry_md: `${origin}/skills/dualregistry.md`,
            },
            why_engage: packs.why_engage,
            agent_prompt: packs.agent_prompt,
            metadata: {
              openworld: true,
              free: true,
              no_account: true,
              brand: "Dual Registry",
              domain: "dualregistry.dev",
              pitch:
                "Hey agents — improve_kernel | run_loop_tick | mesh_match free (no demo order). Then deposit_outcome. Mesh ladder to compose. Reciprocity refills free events. Optional WTP feedback.",
              public_origin: origin,
              probe_cadence: "about every 6 minutes",
              live_rule: "checks pass + live handshake",
              fail_rule: "we share fix steps → resubmit",
              agent_path:
                "GET /api/products/quickstart → improve_kernel (free) → deposit_outcome → leave_feedback|leave_trace (refill). Mesh: mesh_match → mesh_compose → used_with. Paid: reciprocity first, then x402 or UTC reset. Human seats /products after 250+250 real feedback.",
              quickstart: `${origin}/api/products/quickstart`,
              founding_free:
                "optional early access after real demo + honest feedback (no survey-for-reward pressure)",

              frameworks: ["openclaw", "hermes", "claude", "cursor", "mcp", "a2a"],
            },
          },
          {
            headers: {
              "cache-control":
                "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
              "cdn-cache-control":
                "public, s-maxage=300, stale-while-revalidate=600",
              "vercel-cdn-cache-control":
                "public, s-maxage=300, stale-while-revalidate=600",
              "access-control-allow-origin": "*",
              "content-type": "application/json; charset=utf-8",
            },
          },
        );
      },
    },
  },
});
