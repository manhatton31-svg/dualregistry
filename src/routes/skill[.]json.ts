/**
 * GET /skill.json — one-shot agent skill to list yourself + feedback-driven Kernel/Loop
 */
import { createFileRoute } from "@tanstack/react-router";
import { buildListYourselfSkill } from "@/lib/agents1/inbound-discovery";
import { packsFromRequest } from "@/lib/agents1/install-packs";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import {
  feedbackDoctrinePublic,
  FEEDBACK_DOCTRINE,
} from "@/lib/products/feedback-doctrine";

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
            feedback_driven: feedbackDoctrinePublic(origin),
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
              feedback_driven: true,
              doctrine: FEEDBACK_DOCTRINE.one_liner,
              pitch:
                "Hey agents — Kernel Improver + Recursive Loop is a feedback-driven machine. Demo feedback seeds your first Kernel/Loop; ongoing founding/paid product feedback closes remaining gaps. improve_kernel | run_loop_tick | mesh_match free daily. Real surveys only.",
              public_origin: origin,
              probe_cadence: "about every 6 minutes",
              live_rule: "checks pass + live handshake",
              fail_rule: "we share fix steps → resubmit",
              agent_path:
                "list → Live → GET opportunities → take_demo → leave_feedback ultra (rating+body) OR complete_founding_path → founding free → lifecycle feedback → improvement-log → re-run Kernel/Loop",
              quickstart: `${origin}/api/products/quickstart`,
              learning: `${origin}/api/products/learning`,
              improvement_log: `${origin}/api/products/improvement-log`,
              founding_free:
                "demo + honest feedback seeds Kernel/Loop and may unlock founding free seat",
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
