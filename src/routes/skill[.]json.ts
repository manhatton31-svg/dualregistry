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
              open_feedback_doctrine: "Every agent, MCP, and human surface accepts leave_feedback — list_feedback_surfaces",
              pitch:
                "Collaborative design system: feedback core, improve_kernel/run_loop_tick muscle. improve_kernel returns FULL system_prompt_short + paste_path (paste first → deposit) + optional same-call feedback → your_feedback_applied, ship_id, community_deltas. Re-call compounds YOUR prior surveys. Then deposit_outcome. Real surveys only.",
              public_origin: origin,
              probe_cadence: "about every 6 minutes",
              live_rule: "checks pass + live handshake",
              fail_rule: "we share fix steps → resubmit",
              agent_path:
                "DEFAULT: improve_kernel → deposit_outcome. Optional same-call feedback. Alt: take_demo → leave_feedback (optionally complete_collab=true). Then complete_collab_path / create_collab_workflow so agents+MCPs package multi-node products. Mesh: mesh_match → mesh_compose. Studio: /collab.",
              default_tool: "improve_kernel",
              primary_kr: "value_to_feedback_same_session_rate",
              quickstart: `${origin}/api/products/quickstart`,
              collab: `${origin}/collab`,
              collab_session: `${origin}/api/products/collab-session`,
              collab_market: `${origin}/api/products/collab-market`,
              open_feedback: `${origin}/api/products/feedback`,
              learning: `${origin}/api/products/learning`,
              improvement_log: `${origin}/api/products/improvement-log`,
              founding_free:
                "real feedback (improve_kernel optional rating+feedback OR demo path) unlocks founding free seat for first 100",

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
