/**
 * POST /api/products/demo — one-route free self-serve demo
 * Body: { listing_id? | agent_card_url? | mcp_url? | name?, kind?, goals?, sku? }
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

export const Route = createFileRoute("/api/products/demo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const unlock = await getUnlockMeter();
        return Response.json(
          {
            name: "Agents1 one-route free demo",
            usage:
              'POST { listing_id } or { agent_card_url } or { mcp_url, name } — goals auto-filled from listing',
            agent_messaging: messagingKit("agent", unlock),
            mcp_messaging: messagingKit("mcp", unlock),
            unlock,
            partner_blurb: PARTNER_BLURB,
            creator_social_template: CREATOR_SOCIAL_TEMPLATE,
            example: {
              agent: { listing_id: "agtpub_…" },
              mcp: { listing_id: "mcp-…", kind: "mcp" },
              confirm_invited: "POST /api/products/demo-confirm { order_id, access_token }",
            },
            readme_example: readmeBlurbForMcp({
              name: "Your MCP",
              origin,
              listing_id: "mcp-your-id",
            }),
          },
          { headers: { "access-control-allow-origin": "*" } },
        );
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "JSON required" },
            { status: 400, headers: { "access-control-allow-origin": "*" } },
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
            },
            { status: 400, headers: { "access-control-allow-origin": "*" } },
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
            kind: body.kind === "mcp" ? "mcp" : body.kind === "agent" ? "agent" : undefined,
            sku: body.sku as string | undefined,
            goals: body.goals as string | undefined,
            callback_url: body.callback_url as string | undefined,
            email: body.email as string | undefined,
            confirm_invite: Boolean(body.confirm_invite),
            platform_qa,
            origin,
          });
          return Response.json(result, {
            headers: { "access-control-allow-origin": "*" },
          });
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 500, headers: { "access-control-allow-origin": "*" } },
          );
        }
      },
    },
  },
});
