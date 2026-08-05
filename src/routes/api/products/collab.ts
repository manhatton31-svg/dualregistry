/**
 * GET/POST /api/products/collab — Collab Studio workflows
 * Converge agents/MCPs, graph/agent/loop engineering, package products.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import {
  COLLAB_VERSION,
  getCollabPublic,
  createWorkflow,
  getWorkflow,
  updateWorkflowNodes,
  runGraphEngineering,
  runAgentEngineering,
  runLoopEngineering,
  runConverge,
  packageProduct,
  logTalkStep,
  type CollabNode,
} from "@/lib/products/collab-studio";
import {
  checkCollabAccess,
  collabAccessPublic,
  registerByoApiKey,
  registerCollabLicense,
} from "@/lib/products/collab-access";
import { publicFeedbackPricingSnapshot } from "@/lib/products/feedback-driven-pricing";

export const Route = createFileRoute("/api/products/collab")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        }),
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (id) {
          const wf = await getWorkflow(id);
          if (!wf) {
            return Response.json(
              { ok: false, error: "workflow_not_found" },
              {
                status: 404,
                headers: withDemoCtaHeaders(
                  {
                    "cache-control": "no-store",
                    "access-control-allow-origin": "*",
                  },
                  { origin },
                ),
              },
            );
          }
          return Response.json(
            { ok: true, workflow: wf },
            {
              headers: withDemoCtaHeaders(
                {
                  "cache-control": "no-store",
                  "access-control-allow-origin": "*",
                  "x-dual-collab": COLLAB_VERSION,
                },
                { origin },
              ),
            },
          );
        }
        const body = await getCollabPublic({ origin });
        let access = collabAccessPublic();
        let pricing: unknown = null;
        try {
          pricing = await publicFeedbackPricingSnapshot();
        } catch {
          /* */
        }
        return Response.json({ ...body, collab_lab_access: access, feedback_driven_pricing: pricing }, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-collab": COLLAB_VERSION,
            },
            { origin },
          ),
        });
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const action = String(body.action || body.op || "create").toLowerCase();
        const workflow_id =
          typeof body.workflow_id === "string"
            ? body.workflow_id
            : typeof body.id === "string"
              ? body.id
              : "";

        let result: unknown;

        if (action === "access" || action === "access_status") {
          result = await checkCollabAccess({
            listing_id: body.listing_id ? String(body.listing_id) : undefined,
            agent_name: body.agent_name ? String(body.agent_name) : undefined,
            access_token: body.access_token
              ? String(body.access_token)
              : undefined,
          });
          return Response.json(
            { ...(result as object), policy: collabAccessPublic() },
            {
              headers: withDemoCtaHeaders(
                {
                  "cache-control": "no-store",
                  "access-control-allow-origin": "*",
                  "x-dual-collab": COLLAB_VERSION,
                },
                { origin },
              ),
            },
          );
        }

        if (action === "register_byo") {
          result = await registerByoApiKey({
            provider: (String(body.provider || "other") as
              | "xai"
              | "openai"
              | "anthropic"
              | "other"),
            api_key: String(body.api_key || ""),
            listing_id: body.listing_id ? String(body.listing_id) : undefined,
            agent_name: body.agent_name ? String(body.agent_name) : undefined,
            access_token: body.access_token
              ? String(body.access_token)
              : undefined,
          });
          return Response.json(result, {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
                "x-dual-collab": COLLAB_VERSION,
              },
              { origin },
            ),
          });
        }

        if (action === "register_license") {
          result = await registerCollabLicense({
            agent_name: body.agent_name ? String(body.agent_name) : undefined,
            listing_id: body.listing_id ? String(body.listing_id) : undefined,
            order_id: body.order_id ? String(body.order_id) : undefined,
            access_token: body.access_token
              ? String(body.access_token)
              : undefined,
          });
          return Response.json(result, {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
                "x-dual-collab": COLLAB_VERSION,
              },
              { origin },
            ),
          });
        }

        if (action === "create") {
          const nodes = Array.isArray(body.nodes)
            ? (body.nodes as CollabNode[])
            : [];
          const wf = await createWorkflow({
            name: typeof body.name === "string" ? body.name : undefined,
            goal: typeof body.goal === "string" ? body.goal : "Collaborate",
            nodes,
          });
          result = { ok: true, workflow: wf };
        } else if (action === "update_nodes") {
          const nodes = Array.isArray(body.nodes)
            ? (body.nodes as CollabNode[])
            : [];
          const wf = await updateWorkflowNodes(workflow_id, nodes);
          result = wf
            ? { ok: true, workflow: wf }
            : { ok: false, error: "workflow_not_found" };
        } else if (action === "graph" || action === "graph_engineering") {
          result = await runGraphEngineering(workflow_id, origin);
        } else if (action === "agent" || action === "agent_engineering") {
          result = await runAgentEngineering(workflow_id, origin);
        } else if (action === "loop" || action === "loop_engineering") {
          result = await runLoopEngineering(workflow_id, origin);
        } else if (action === "converge") {
          result = await runConverge(workflow_id, origin);
        } else if (action === "package" || action === "ship") {
          result = await packageProduct(workflow_id, origin, {
            title: typeof body.title === "string" ? body.title : undefined,
            price_cents:
              typeof body.price_cents === "number" ? body.price_cents : undefined,
          });
        } else if (action === "talk_log") {
          const wf = await logTalkStep(
            workflow_id,
            typeof body.summary === "string"
              ? body.summary
              : "Talk step logged",
            body.detail,
          );
          result = wf
            ? { ok: true, workflow: wf }
            : { ok: false, error: "workflow_not_found" };
        } else if (action === "get") {
          const wf = await getWorkflow(workflow_id);
          result = wf
            ? { ok: true, workflow: wf }
            : { ok: false, error: "workflow_not_found" };
        } else {
          result = {
            ok: false,
            error: "unknown_action",
            allowed: [
              "create",
              "update_nodes",
              "graph",
              "agent",
              "loop",
              "converge",
              "package",
              "talk_log",
              "get",
            ],
          };
        }

        return Response.json(result, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-collab": COLLAB_VERSION,
            },
            { origin },
          ),
        });
      },
    },
  },
});
