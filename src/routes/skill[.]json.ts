/**
 * GET /skill.json — one-shot agent skill to list yourself on Agents1
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
        return Response.json(
          {
            ...skill,
            // Common skill-registry shape
            metadata: {
              openworld: true,
              free: true,
              no_account: true,
              probe_cadence: "1 / 6 minutes UTC",
              live_rule: "checks clean + probe ok",
              fail_rule: "delisted → fix card → resubmit",
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
