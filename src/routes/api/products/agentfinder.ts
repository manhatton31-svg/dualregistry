/**
 * GET /api/products/agentfinder — how to point Agent Finder / ARD clients at Dual
 * and status of catalog contribution pack.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/products/agentfinder")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request).replace(/\/$/, "");
        return Response.json(
          {
            ok: true,
            version: "2.2.0",
            title: "Dual Registry × GitHub Agent Finder",
            point_registry_at: {
              catalog: `${o}/.well-known/ai-catalog.json`,
              search: `${o}/api/ard/search?q={task}&federation=auto`,
              search_post: {
                method: "POST",
                url: `${o}/api/ard/search`,
                body: { q: "{task}", federation: "auto" },
              },
            },
            contribution_pack: {
              repo: "https://github.com/manhatton31-svg/dualregistry/tree/main/docs/agentfinder",
              skill_md:
                "https://github.com/manhatton31-svg/dualregistry/blob/main/skills/dualregistry/SKILL.md",
              skill_json: `${o}/skill.json`,
              entries: [
                {
                  path: "catalog/manhatton31-svg/dualregistry-list-and-claim.json",
                  mediaType: "application/ai-skill",
                },
                {
                  path: "catalog/dev.dualregistry/registry.json",
                  mediaType: "application/mcp-server+json",
                  official: "dev.dualregistry/registry",
                },
              ],
              upstream: "https://github.com/github/agentfinder-catalog",
              pr_guide:
                "https://github.com/manhatton31-svg/dualregistry/blob/main/docs/agentfinder/README.md",
            },
            dual_as_registry_note:
              "Copilot Agent Finder can use Dual's ai-catalog.json as a custom/private registry URL without waiting for the public catalog PR.",
            federation: {
              modes: ["none", "referrals", "auto"],
              default: "referrals",
              auto_pulls: [
                "https://huggingface.co/.well-known/ai-catalog.json",
              ],
            },
          },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "public, max-age=60",
                "access-control-allow-origin": "*",
              },
              { origin: o },
            ),
          },
        );
      },
    },
  },
});
