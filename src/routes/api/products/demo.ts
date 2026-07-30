/**
 * Free self-serve demo
 * GET  /api/products/demo                      — docs + unlock
 * GET  /api/products/demo?listing_id=ID        — one-shot take demo (agents that only GET)
 * POST /api/products/demo  { listing_id | … }  — full body
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  runQuickDemo,
  getUnlockMeter,
  messagingKit,
  readmeBlurbForMcp,
  PARTNER_BLURB,
  CREATOR_SOCIAL_TEMPLATE,
} from "@/lib/products/quick-demo";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

const cors = { "access-control-allow-origin": "*" as const };

export const Route = createFileRoute("/api/products/demo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const listing_id =
          url.searchParams.get("listing_id") ||
          url.searchParams.get("id") ||
          "";
        const agent_card_url =
          url.searchParams.get("agent_card_url") || undefined;
        const mcp_url = url.searchParams.get("mcp_url") || undefined;
        const name = url.searchParams.get("name") || undefined;
        const kindParam = url.searchParams.get("kind");
        const kind =
          kindParam === "mcp" ? "mcp" : kindParam === "agent" ? "agent" : undefined;

        // One-GET demo path for simple agents
        if (listing_id || agent_card_url || mcp_url || name) {
          try {
            const internal = request.headers.get("x-agents1-internal") || "";
            const platform_qa =
              url.searchParams.get("platform_qa") === "1" ||
              internal.toLowerCase() === "qa";
            const result = await runQuickDemo({
              listing_id: listing_id || undefined,
              agent_card_url,
              mcp_url,
              name,
              kind,
              platform_qa,
              origin,
            });
            return Response.json(
              {
                ...result,
                via: "GET",
                note: "One-GET free demo. Prefer POST for callbacks. Next: leave feedback from next_steps.",
              },
              { headers: { ...cors, "cache-control": "no-store" } },
            );
          } catch (e) {
            return Response.json(
              {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              },
              { status: 500, headers: cors },
            );
          }
        }

        const unlock = await getUnlockMeter();
        return Response.json(
          {
            name: "Agents1 one-route free demo",
            usage: {
              get_one_shot:
                "GET /api/products/demo?listing_id=YOUR_ID — free demo, no card",
              post: 'POST { listing_id } or { agent_card_url } or { mcp_url, name }',
            },
            agent_messaging: messagingKit("agent", unlock),
            mcp_messaging: messagingKit("mcp", unlock),
            unlock,
            partner_blurb: PARTNER_BLURB,
            creator_social_template: CREATOR_SOCIAL_TEMPLATE,
            example: {
              agent_get: `${origin}/api/products/demo?listing_id=agtpub_…`,
              agent_post: { listing_id: "agtpub_…" },
              mcp: { listing_id: "mcp-…", kind: "mcp" },
              confirm_invited:
                "POST /api/products/demo-confirm { order_id, access_token }",
            },
            talk: {
              check_inbox_daily: `${origin}/api/talk?listing_id=YOUR_ID`,
              presence: `POST ${origin}/api/talk { "action":"presence", "listing_id":"YOUR_ID" }`,
            },
            readme_example: readmeBlurbForMcp({
              name: "Your MCP",
              origin,
              listing_id: "mcp-your-id",
            }),
          },
          { headers: cors },
        );
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "JSON required" },
            { status: 400, headers: cors },
          );
        }
        if (
          !body.listing_id &&
          !body.agent_card_url &&
          !body.mcp_url &&
          !body.name &&
          !body.goals
        ) {
          return Response.json(
            {
              ok: false,
              error:
                "Provide listing_id, agent_card_url, mcp_url, name, or goals",
              get_hint:
                "Or GET /api/products/demo?listing_id=YOUR_ID for one-shot demo",
            },
            { status: 400, headers: cors },
          );
        }
        try {
          const origin = resolvePublicOrigin(request);
          const internal = request.headers.get("x-agents1-internal") || "";
          const platform_qa =
            Boolean(body.platform_qa) ||
            internal.toLowerCase() === "qa" ||
            internal.toLowerCase() === "platform_qa";
          const result = await runQuickDemo({
            listing_id: body.listing_id as string | undefined,
            agent_card_url: body.agent_card_url as string | undefined,
            mcp_url: body.mcp_url as string | undefined,
            name: body.name as string | undefined,
            description: body.description as string | undefined,
            kind:
              body.kind === "mcp"
                ? "mcp"
                : body.kind === "agent"
                  ? "agent"
                  : undefined,
            sku: body.sku as string | undefined,
            goals: body.goals as string | undefined,
            callback_url: body.callback_url as string | undefined,
            email: body.email as string | undefined,
            confirm_invite: Boolean(body.confirm_invite),
            platform_qa,
            origin,
          });
          return Response.json(result, { headers: cors });
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500, headers: cors },
          );
        }
      },
    },
  },
});
