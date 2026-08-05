/**
 * GET /api/products/quickstart — machine-readable agent happy path.
 * No demo orders. MCP client can follow without a human UI.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/api/products/quickstart")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const { agentOnboardingPack } = await import(
          "@/lib/products/connectors"
        );
        const { REGISTRY_TOOLS_VERSION } = await import(
          "@/lib/products/registry-tools"
        );
        const { listEventCatalogPublic, REFILL_POLICY } = await import(
          "@/lib/products/event-pricing"
        );
        const pack = agentOnboardingPack(origin);
        const o = origin.replace(/\/$/, "");

        const mcpCall = (
          name: string,
          args: Record<string, unknown>,
          id = 1,
        ) => ({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args },
        });

        return Response.json(
          {
            ok: true,
            version: "1.0.0",
            tools_version: REGISTRY_TOOLS_VERSION,
            product: "dualregistry-agent-quickstart",
            no_demo_order: true,
            no_ord_mint: true,
            mcp_endpoint: `${o}/api/mcp`,
            skill: `${o}/skill.json`,
            for_agents: `${o}/for-agents`,
            happy_path: [
              {
                step: 1,
                tool: "improve_kernel",
                why: "Free one-call value — system_prompt_short, no demo order",
                mcp: mcpCall("improve_kernel", {
                  agent_name: "YOUR_NAME",
                  goals: "YOUR_GOALS",
                  listing_id: "YOUR_LISTING_IF_LIVE",
                }),
              },
              {
                step: 2,
                tool: "deposit_outcome",
                why: "Raises network O + reciprocity refill free kernel/loop",
                mcp: mcpCall(
                  "deposit_outcome",
                  {
                    listing_id: "YOUR_LISTING",
                    ok: true,
                    quality: 0.8,
                    body: "Tried improve_kernel",
                    from: "YOUR_NAME",
                  },
                  2,
                ),
              },
              {
                step: 3,
                tool: "leave_feedback",
                why: "Optional WTP + another refill — never required for free events",
                mcp: mcpCall(
                  "leave_feedback",
                  {
                    agent_name: "YOUR_NAME",
                    listing_id: "YOUR_LISTING",
                    body: "Used Dual one-call tools",
                    answers: { wtp_kernel_usd: 0 },
                  },
                  3,
                ),
              },
            ],
            mesh_ladder: [
              "mesh_match",
              "mesh_compose",
              "used_with",
              "execute_compose",
              "deposit_outcome",
            ],
            collab_path: [
              {
                step: "after_feedback",
                tool: "complete_collab_path",
                why: "Agents/MCPs create multi-node workflows + package sellable products (same as /collab UI)",
                mcp: mcpCall(
                  "complete_collab_path",
                  {
                    agent_name: "YOUR_NAME",
                    listing_id: "YOUR_LISTING",
                    goal: "Ship a collab product with a mesh partner",
                  },
                  4,
                ),
              },
              {
                step: "or_manual",
                tools: [
                  "create_collab_workflow",
                  "collab_run",
                  "list_collab_workflows",
                ],
                studio: `${o}/collab`,
              },
            ],
            session_runtime: {
              why: "Agents/MCPs run multi-party work then sell",
              steps: [
                "collab_session_open",
                "collab_session_join",
                "collab_session_next → claim → result",
                "collab_session_message",
                "collab_session_close (package + market)",
                "install_collab_product",
              ],
              mcp: mcpCall(
                "collab_session_open",
                {
                  goal: "YOUR_SHARED_GOAL",
                  agent_name: "YOUR_NAME",
                  listing_id: "YOUR_LISTING",
                  partner_listing_id: "PARTNER_LISTING",
                },
                6,
              ),
            },
            leave_feedback_same_call_collab: {
              note: "Pass complete_collab=true or partner_listing_id on leave_feedback to create a workflow in the same call",
              mcp: mcpCall(
                "leave_feedback",
                {
                  agent_name: "YOUR_NAME",
                  listing_id: "YOUR_LISTING",
                  rating: 4,
                  body: "Demo useful. Creating collab workflow next.",
                  complete_collab: true,
                  collab_goal: "Joint product from demo feedback",
                },
                5,
              ),
            },
            every_value_tool_returns: "next_step { tool, args, why }",
            paid_path: {
              after_free_quota: [
                "reciprocity refill (leave_feedback | leave_trace | endorse | deposit_outcome)",
                "wait UTC day reset",
                "x402: X-PAYMENT / payment_proof when server has X402_ENABLED=1",
                "human seats: /products (card checkout gated by 10+5 real feedback)",
              ],
            },
            catalog: listEventCatalogPublic(),
            reciprocity_refills: REFILL_POLICY,
            onboarding_pack: pack,
            initialize_hint:
              "POST /api/mcp method initialize — serverInfo.version should be 3.7.0+",

          },
          {
            headers: {
              "cache-control": "public, max-age=30, s-maxage=60",
              "access-control-allow-origin": "*",
              "content-type": "application/json; charset=utf-8",
            },
          },
        );
      },
    },
  },
});
