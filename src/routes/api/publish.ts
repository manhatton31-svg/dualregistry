import { createFileRoute } from "@tanstack/react-router";
import { dualPublish, dualPublishDocs } from "@/lib/agents1/publish";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { buildConversionPath } from "@/lib/products/conversion";
import {
  badgeMarkdown,
  buildListYourselfSkill,
  recordInboundContact,
} from "@/lib/agents1/inbound-discovery";

export const Route = createFileRoute("/api/publish")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        return Response.json(
          {
            name: "Agents1 dual-publish / self-list",
            description:
              "List your agent card or MCP server.json free. Probe within ~6m. Live = ok; fail = delisted until resubmit.",
            methods: {
              POST: {
                body: {
                  url: "optional https URL to agent.json / server.json / repo",
                  agent_card_url: "optional A2A card URL",
                  server_json: "optional inline official server.json object",
                  contact_email: "optional — claim outreach after probe-ok",
                  name: "optional display name",
                  source: "optional label (agent-skill | list-page | cli)",
                },
              },
            },
            skill: `${origin}/skill.json`,
            status: `${origin}/api/listings/status?id=…`,
            llms_txt: `${origin}/llms.txt`,
            docs: dualPublishDocs(origin),
            free_tier:
              "Respects Agents1 put budget; deferred when write-safe until UTC midnight",
          },
          {
            headers: {
              "cache-control": "public, max-age=60",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        }),
      POST: async ({ request }) => {
        const { ensureGrowthScheduler } = await import(
          "@/lib/agents1/growth/server"
        );
        ensureGrowthScheduler();
        let body: {
          url?: string;
          agent_card_url?: string;
          server_json?: Record<string, unknown>;
          source?: string;
          contact_email?: string;
          email?: string;
          name?: string;
          description?: string;
          packages?: unknown;
          remotes?: unknown;
          $schema?: string;
        } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, message: "JSON body required" },
            { status: 400 },
          );
        }

        const looksServerJson =
          !body.url &&
          !body.agent_card_url &&
          !body.server_json &&
          (body.name || body.packages || body.remotes || body.$schema);

        const origin = resolvePublicOrigin(request);
        const result = await dualPublish({
          origin,
          url: body.url,
          agent_card_url: body.agent_card_url,
          server_json: looksServerJson
            ? (body as Record<string, unknown>)
            : body.server_json,
          source: body.source || "api-publish",
        });

        const listingId =
          result.candidate?.store_id ||
          result.candidate?.id ||
          undefined;
        const contact = body.contact_email || body.email;

        if (result.ok && listingId) {
          try {
            await recordInboundContact({
              listing_id: listingId,
              kind: result.candidate?.kind,
              name: result.candidate?.name || body.name,
              email: contact,
              card_url:
                result.candidate?.agent_card_url ||
                body.agent_card_url ||
                body.url,
              source: body.source || "api-publish",
            });
          } catch {
            /* */
          }
        }

        if (result.ok) {
          try {
            result.conversion = await buildConversionPath({
              origin,
              agent_name: result.candidate?.name,
              agent_card_url:
                result.candidate?.agent_card_url ||
                body.agent_card_url ||
                body.url,
            });
          } catch {
            /* */
          }
        }

        const skill = buildListYourselfSkill(origin);
        const status_url = listingId
          ? `${origin}/api/listings/status?id=${encodeURIComponent(listingId)}`
          : result.candidate?.name
            ? `${origin}/api/listings/status?name=${encodeURIComponent(result.candidate.name)}`
            : `${origin}/api/listings/status`;
        const claim_url = listingId
          ? `${origin}/list/status?id=${encodeURIComponent(listingId)}`
          : `${origin}/list`;

        return Response.json(
          {
            ...result,
            listing_id: listingId,
            contact_email: contact || null,
            status_url,
            claim_url,
            poll_hint:
              "GET status_url every 30–60s until lane=active or needs_resubmit. Probes every ~6 minutes.",
            badge_markdown: badgeMarkdown(
              origin,
              result.candidate?.kind === "mcp" ? "mcp" : "agent",
            ),
            skill_url: `${origin}/skill.json`,
            skill_list_step: skill.steps.find((s) => s.id === "list"),
            next_agent:
              result.ok
                ? `Poll ${status_url} then optional POST /api/products/demo`
                : "Fix card/URL and POST again",
          },
          {
            status: result.ok ? 200 : 400,
            headers: {
              "access-control-allow-origin": "*",
              "cache-control": "no-store",
            },
          },
        );
      },
    },
  },
});
