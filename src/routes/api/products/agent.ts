/**
 * Agent-native product tools — one surface for list / preview / buy / access / export.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PRODUCTS, formatUsd, resolveSku, pricingSnapshot } from "@/lib/products/catalog";
import { costModesPublic } from "@/lib/products/cost-modes";
import { startCheckout } from "@/lib/products/stripe";
import { getPaymentGate } from "@/lib/products/payment-gate";
import { publicOrder, getOrderByToken, countPaidSeats } from "@/lib/products/orders";
import { buildPreview } from "@/lib/products/preview";
import { buildSkillsTree } from "@/lib/products/export-skills";
import { verifyCertificate } from "@/lib/products/certify";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { trackFunnel, getLearningPublic } from "@/lib/products/learning-loop";
import { buildConversionPath } from "@/lib/products/conversion";
import { submitFeedback, listFeedback, surveyPublicSchema } from "@/lib/products/feedback";
import {
  getEnrollmentByToken,
  getPhaseSurvey,
  submitLifecycleFeedback,
  getLifecyclePublic,
} from "@/lib/products/feedback-lifecycle";
import type { LifecyclePhaseId } from "@/lib/products/lifecycle-surveys";
import { goalsFromListing, GOAL_PRESETS } from "@/lib/products/demo-funnel";

const TOOLS = [
  {
    name: "preview_kernel",
    description:
      "Run this to see what Kernel Improver does to your goals in ~30s — free, no card. goals optional if preset or description provided.",
    input: {
      goals: "string?",
      agent_name: "string?",
      domain: "string?",
      preset: "researcher|ops|support|coder?",
      description: "string?",
      short_preview: "boolean? default true",
    },
  },
  {
    name: "demo_alive",
    description:
      "Free full Alive demo (Kernel+Loop+curriculum). Completing → provisional score boost; feedback → founding 25% vault code.",
    input: {
      goals: "string?",
      agent_name: "string?",
      agent_card_url: "string?",
      preset: "string?",
      description: "string?",
      short_preview: "boolean?",
    },
  },
  {
    name: "demo_mcp",
    description:
      "MCP publisher free demo of MCP Mesh (or Alive companion). Pass mcp name + description + optional tools list from server.json. Feedback → 25% vault + counts toward 5 MCP feedback unlock.",
    input: {
      agent_name: "string? mcp server name",
      description: "string? from server.json",
      tools: "string[]? or tools: a, b, c in description",
      agent_card_url: "string?",
      sku: "mcp_mesh|alive? default mcp_mesh",
      preset: "mcp_publisher?",
    },
  },
  {
    name: "one_click_demo",
    description:
      "Zero-friction demo — no goals required. Derives goals from listing description or preset (researcher|ops|support|coder).",
    input: {
      agent_name: "string?",
      description: "string?",
      agent_card_url: "string?",
      preset: "researcher|ops|support|coder?",
      kind: "agent|mcp?",
    },
  },
  {
    name: "list_products",
    description: "List Agents1 commercial products and prices",
    input: {},
  },
  {
    name: "buy_product",
    description:
      "Submit goals for sku (kernel|recursive|alive|mcp_mesh). Demos always open. Live Stripe only after 10 feedback agents + 5 feedback MCPs. MCP publishers: use sku mcp_mesh (dynamic to your tools) or alive for companion agents.",


    input: {
      sku: "kernel|recursive|alive",
      goals: "string?",
      agent_name: "string?",
      agent_card_url: "string?",
      callback_url: "string?",
      demo: "boolean?",
      preset: "string?",
      description: "string?",
      idempotency_key: "string?",
    },
  },
  {
    name: "get_access",
    description: "Fetch artifacts with access token",
    input: { token: "string", artifact: "kernel|recursive|alive?" },
  },
  {
    name: "export_skills",
    description: "Export progressive-disclosure SKILL.md tree",
    input: { token: "string" },
  },
  {
    name: "verify_certificate",
    description:
      "Verify Alive/product certificate — demo → provisional alive-ready boost; paid → full boost path",
    input: { order_id: "string?", token: "string?", agent_card_url: "string?" },
  },
  {
    name: "product_learning",
    description: "Read product gap learning loop (best offer + recommendations)",
    input: {},
  },
  {
    name: "conversion_path",
    description:
      "Post-list funnel: next=demo_kernel · one_click_demo → demo Alive → feedback vault 25% → badge",
    input: {
      agent_name: "string?",
      agent_card_url: "string?",
      goals: "string?",
      description: "string?",
    },
  },
  {
    name: "submit_feedback",
    description:
      "Submit structured product survey answers (preferred) or free text. Complete survey → 25% founding discount code. Feeds Kernel/Loop generators.",
    input: {
      answers: "object? keyed by question id — see get_feedback_survey",
      body: "string? free-text fallback",
      rating: "1-5?",
      source: "demo|paid|preview|list|agent?",
      agent_name: "string?",
      order_id: "string?",
      sku: "string?",
      mode: "demo|stripe|preview?",
      contact: "string?",
    },
  },
  {
    name: "get_feedback_survey",
    description: "Fetch high-signal survey questions + discount incentive",
    input: {},
  },
  {
    name: "lifecycle_status",
    description:
      "Paid agents: post-setup + weekly feedback status (8 weeks). Pass token or order_id.",
    input: { token: "string?", order_id: "string?" },
  },
  {
    name: "submit_lifecycle_feedback",
    description:
      "Submit lifecycle phase answers. Triggers individualization or system-candidate decisions + cost impact estimate.",
    input: {
      token: "string?",
      order_id: "string?",
      phase_id: "post_setup|week_1|…|week_8|incident",
      answers: "object",
      telemetry: "object? tick rates, tokens, latency, traces",
    },
  },
  {
    name: "product_roadmap",
    description: "Public feedback roadmap scoreboard — top themes, canary, shipped",
    input: {},
  },
  {
    name: "improvement_log",
    description:
      "Public Kernel Improver + Recursive Loop log: agent feedback → themes → dogfood runs. See what Agents1 is really about.",
    input: { limit: "number?", dogfood: "boolean?" },
  },
  {
    name: "get_wtp",
    description:
      "Willingness-to-pay report from agent feedback (honest USD; $0 allowed). Compare to founding prices.",
    input: {},
  },
  {
    name: "improve_kernel",
    description:
      "ONE-CALL Kernel Improver — no demo order. Free 3/day then $0.25. Returns system_prompt_short + Network Edition. Feedback optional.",
    input: {
      agent_name: "string",
      goals: "string?",
      listing_id: "string?",
      current_prompt: "string?",
      domain: "string?",
      payment_proof: "string?",
    },
  },
  {
    name: "run_loop_tick",
    description:
      "ONE-CALL Recursive Loop tick — no demo order. Free 3/day then $0.25.",
    input: {
      agent_name: "string",
      goals: "string?",
      listing_id: "string?",
      prior_state: "object?",
      payment_proof: "string?",
    },
  },
  {
    name: "mesh_match",
    description:
      "ONE-CALL mesh matchmaking — free 5/day then $0.10. No demo order.",
    input: {
      capabilities: "string?",
      goals: "string?",
      agent_name: "string?",
      listing_id: "string?",
      limit: "number?",
    },
  },
  {
    name: "list_event_pricing",
    description: "Agent event catalog + free allowances + usage totals today",
    input: {},
  },
];


export const Route = createFileRoute("/api/products/agent")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type, authorization",
          },
        }),
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        return Response.json({
          name: "Agents1 agent product tools",
          version: "1.0.0",
          tools: TOOLS,
          buy_schema: {
            type: "object",
            required: ["sku", "goals"],
            properties: {
              sku: { enum: ["kernel", "recursive", "alive"] },
              goals: {
                type: "string",
                minLength: 8,
                description: "Free-text or bullet goals",
              },
              agent_name: { type: "string" },
              agent_card_url: { type: "string", format: "uri" },
              callback_url: {
                type: "string",
                format: "uri",
                description: "POST webhook on fulfill",
              },
              domain: { type: "string" },
              constraints: { type: "string" },
              success_metrics: { type: "string" },
              email: { type: "string" },
              demo: { type: "boolean" },
              idempotency_key: { type: "string" },
              payment: {
                type: "object",
                properties: {
                  method: { enum: ["stripe_checkout", "demo"] },
                },
              },
            },
          },
          endpoints: {
            self: `${origin}/api/products/agent`,
            preview: `${origin}/api/products/preview`,
            checkout: `${origin}/api/products/checkout`,
            access: `${origin}/api/products/access`,
            export: `${origin}/api/products/export`,
            verify: `${origin}/api/products/verify`,
            learning: `${origin}/api/products/learning`,
            conversion: `${origin}/api/products/conversion`,
            feedback: `${origin}/api/products/feedback`,
          },
        });
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "JSON required" }, { status: 400 });
        }
        const tool = String(body.tool || body.action || body.name || "");
        const origin = resolvePublicOrigin(request);
        const cors = {
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        };

        if (tool === "list_products" || tool === "list") {
          const sold = await countPaidSeats();
          const pricing = pricingSnapshot(sold);
          const payment_gate = await getPaymentGate();
          return Response.json(
            {
              ok: true,
              pricing,
              payment_gate,
              payments_open: payment_gate.payments_open,
              agent_directive: payment_gate.agent_directive,
              products: Object.values(PRODUCTS).map((p) => {
                const live = pricing.prices.find((x) => x.sku === p.sku)!;
                return {
                  sku: p.sku,
                  name: p.name,
                  tagline: p.tagline,
                  price: live.price,
                  price_cents: live.price_cents,
                  features: p.features,
                };
              }),
              note: payment_gate.payments_open
                ? "Live Stripe open — buy_product with goals; redeem discount_code if vaulted"
                : "Demos free now. Live pay after 10 feedback agents + 5 feedback MCPs. Path: demo_alive → submit_feedback → vault 25%.",
            },
            { headers: cors },
          );
        }


        if (tool === "preview_kernel" || tool === "preview") {
          let goals = String(body.goals || "");
          if (goals.trim().length < 8) {
            const resolved = goalsFromListing({
              name: body.agent_name ? String(body.agent_name) : undefined,
              description: body.description
                ? String(body.description)
                : goals,
              preset: body.preset ? String(body.preset) : undefined,
            });
            goals = resolved.goals;
          }
          if (goals.trim().length < 8) {
            return Response.json(
              {
                ok: false,
                error: "goals required (or pass description/preset for one-click)",
                presets: Object.keys(GOAL_PRESETS),
              },
              { status: 400 },
            );
          }
          const preview = buildPreview({
            goals,
            agent_name: body.agent_name ? String(body.agent_name) : undefined,
            domain: body.domain ? String(body.domain) : undefined,
            constraints: body.constraints ? String(body.constraints) : undefined,
            success_metrics: body.success_metrics
              ? String(body.success_metrics)
              : undefined,
            short_preview: body.short_preview !== false,
            preset: body.preset ? String(body.preset) : undefined,
            description: body.description ? String(body.description) : undefined,
          });
          await trackFunnel("previews");
          return Response.json(
            {
              ok: true,
              preview,
              next: "demo_alive",
              message:
                "Preview ready (~30 lines). Call demo_alive or one_click_demo for full artifacts; feedback unlocks founding 25% vault code.",
            },
            { headers: cors },
          );
        }

        if (
          tool === "one_click_demo" ||
          tool === "demo_alive" ||
          tool === "demo_mcp" ||
          tool === "claim_prewarmed_demo"
        ) {
          const isMcp =
            tool === "demo_mcp" ||
            body.kind === "mcp" ||
            body.preset === "mcp_publisher";
          const name = body.agent_name
            ? String(body.agent_name)
            : body.mcp_name
              ? String(body.mcp_name)
              : isMcp
                ? "mcp-server"
                : "demo-agent";
          const resolved = goalsFromListing({
            name,
            description: body.description
              ? String(body.description)
              : body.goals
                ? String(body.goals)
                : undefined,
            preset: body.preset
              ? String(body.preset)
              : isMcp
                ? "mcp_publisher"
                : "coder",
            kind: isMcp ? "mcp" : "agent",
          });
          const goals =
            tool === "demo_alive" && String(body.goals || "").trim().length >= 8
              ? String(body.goals)
              : resolved.goals;
          // MCP demos default to MCP Mesh; agents default to Alive
          const mcpish = isMcp || body.kind === "mcp";
          let demoSku: "alive" | "mcp_mesh" | "kernel" | "recursive" =
            mcpish
              ? resolveSku(String(body.sku || "mcp_mesh")) || "mcp_mesh"
              : "alive";
          if (tool === "demo_alive") demoSku = "alive";
          // Append tools list if provided (name: desc lines so MCP Mesh parses them)
          let goalsOut = goals;
          if (Array.isArray(body.tools) && body.tools.length) {
            const toolLines = body.tools
              .map((t: unknown) => {
                if (typeof t === "string") return `${t}: tool ${t}`;
                if (t && typeof t === "object") {
                  const o = t as { name?: string; description?: string };
                  if (o.name)
                    return `${o.name}: ${o.description || `tool ${o.name}`}`;
                }
                return null;
              })
              .filter(Boolean);
            if (toolLines.length) {
              goalsOut = goalsOut + "\n" + toolLines.join("\n");
            }
          }
          try {
            const result = await startCheckout({
              sku: demoSku,
              goals: goalsOut,
              agent_name: name,
              domain: body.domain
                ? String(body.domain)
                : mcpish
                  ? "mcp_tools"
                  : undefined,
              constraints: body.constraints
                ? String(body.constraints)
                : undefined,
              success_metrics: body.success_metrics
                ? String(body.success_metrics)
                : undefined,
              email: body.email ? String(body.email) : undefined,
              agent_card_url: body.agent_card_url
                ? String(body.agent_card_url)
                : undefined,
              callback_url: body.callback_url
                ? String(body.callback_url)
                : undefined,
              idempotency_key: body.idempotency_key
                ? String(body.idempotency_key)
                : undefined,
              origin,
              demo: true,
              cost_mode: body.cost_mode ? String(body.cost_mode) : undefined,
              audience: mcpish || demoSku === "mcp_mesh" ? "mcp" : "agent",
            });
            await trackFunnel("checkouts");
            await trackFunnel("demos");
            const gate = await getPaymentGate();
            const arts = (result.order.artifacts || {}) as Record<
              string,
              Record<string, unknown> | null | undefined
            >;
            const k = arts.kernel as
              | {
                  quick_start?: unknown;
                  system_prompt_short?: string;
                  system_prompt_short_chars?: number;
                  skill_install?: unknown;
                  worked_example_first_goal?: unknown;
                  version?: string;
                }
              | undefined;
            const mesh = arts.mcp_mesh as
              | {
                  quick_start?: unknown;
                  install_kit?: unknown;
                  tool_policy?: unknown;
                  system_prompt_short?: string;
                  version?: string;
                }
              | undefined;
            const first_run_pack = isMcp
              ? {
                  version: mesh?.version || "1.2.0",
                  lead: "install kit first — not a full dump",
                  quick_start: mesh?.quick_start || null,
                  install_kit: mesh?.install_kit || null,
                  tool_policy: mesh?.tool_policy || null,
                  paste_this: mesh?.system_prompt_short || k?.system_prompt_short,
                  export: `${origin}/api/products/export?token=${result.order.access_token}&format=skills`,
                }
              : {
                  version: k?.version || "2.3.0",
                  lead: "paste short prompt (≤600) → SKILL.md install → first worked goal",
                  quick_start: k?.quick_start || null,
                  paste_this: k?.system_prompt_short,
                  paste_char_count: k?.system_prompt_short_chars,
                  skill_install: k?.skill_install || null,
                  first_goal: k?.worked_example_first_goal || null,
                  export: `${origin}/api/products/export?token=${result.order.access_token}&format=skills`,
                };
            return Response.json(
              {
                ok: true,
                mode: "demo",
                tool,
                audience: isMcp ? "mcp_publisher" : "agent",
                goals_source: resolved.source,
                preset_id: resolved.preset_id,
                message: isMcp
                  ? `MCP publisher demo fulfilled (v${mesh?.version || "1.2"}). Install kit + tool policy first. Verify for provisional score boost; submit_feedback → founding 25% vault + counts toward 5 MCP feedback unlock. ${gate.agent_directive}`
                  : `${result.message || "Demo fulfilled."} Kernel v${k?.version || "2.3"} clarity ship: paste ≤600 short prompt first. Verify for provisional alive-ready score boost; submit_feedback for founding 25% vault (counts toward 10 agent feedback unlock). ${gate.agent_directive}`,
                first_run_pack,
                order: publicOrder(result.order),
                payment_gate: {
                  payments_open: gate.payments_open,
                  unlock_rule: gate.unlock_rule,
                  feedback_agents: gate.feedback_agents,
                  feedback_mcps: gate.feedback_mcps,
                  feedback_agents_target: gate.feedback_agents_target,
                  feedback_mcps_target: gate.feedback_mcps_target,
                  agent_directive: gate.agent_directive,
                  message: gate.message,
                },
                next: {
                  status: "demo",
                  next: "feedback",
                  access: `${origin}/api/products/access?token=${result.order.access_token}`,
                  export: `${origin}/api/products/export?token=${result.order.access_token}&format=skills`,
                  verify: `${origin}/api/products/verify?order_id=${result.order.id}`,
                  feedback: `${origin}/api/products/feedback`,
                  score_boost:
                    "GET verify → provisional +8 alive-ready; feedback → 25% founding code + unlock progress",
                },
              },
              { headers: cors },
            );

          } catch (e) {
            return Response.json(
              { ok: false, error: e instanceof Error ? e.message : String(e) },
              { status: 400, headers: cors },
            );
          }
        }

        if (tool === "buy_product" || tool === "buy" || tool === "submit_goals_and_buy") {
          const sku = resolveSku(String(body.sku || "alive"));
          let goals = String(body.goals || "");
          if (goals.trim().length < 8) {
            const resolved = goalsFromListing({
              name: body.agent_name ? String(body.agent_name) : undefined,
              description: body.description
                ? String(body.description)
                : undefined,
              preset: body.preset ? String(body.preset) : undefined,
            });
            goals = resolved.goals;
          }
          if (!sku || goals.trim().length < 8) {
            return Response.json(
              {
                ok: false,
                error: "sku and goals required (or description/preset)",
                presets: Object.keys(GOAL_PRESETS),
              },
              { status: 400 },
            );
          }
          const payment = body.payment as { method?: string } | undefined;
          const gate = await getPaymentGate();
          const demo =
            !gate.payments_open ||
            body.demo === true ||
            payment?.method === "demo" ||
            String(body.payment_method || "") === "demo";
          try {
            const result = await startCheckout({
              sku,
              goals,
              agent_name: body.agent_name ? String(body.agent_name) : undefined,
              domain: body.domain ? String(body.domain) : undefined,
              constraints: body.constraints ? String(body.constraints) : undefined,
              success_metrics: body.success_metrics
                ? String(body.success_metrics)
                : undefined,
              email: body.email ? String(body.email) : undefined,
              agent_card_url: body.agent_card_url
                ? String(body.agent_card_url)
                : undefined,
              callback_url: body.callback_url ? String(body.callback_url) : undefined,
              idempotency_key: body.idempotency_key
                ? String(body.idempotency_key)
                : undefined,
              origin,
              demo,
              discount_code: body.discount_code
                ? String(body.discount_code)
                : undefined,
              cost_mode: body.cost_mode
                ? String(body.cost_mode)
                : undefined,
            });
            await trackFunnel("checkouts");
            if (result.mode === "demo") await trackFunnel("demos");
            else await trackFunnel("paid", { gap: "human_only_checkout" });
            return Response.json(
              {
                ok: true,
                mode: result.mode,
                message: result.message,
                checkout_url: result.checkout_url,
                order: publicOrder(result.order),
                next:
                  result.mode === "demo" || result.order.status === "fulfilled"
                    ? {
                        access: `${origin}/api/products/access?token=${result.order.access_token}`,
                        export: `${origin}/api/products/export?token=${result.order.access_token}&format=skills`,
                        verify: `${origin}/api/products/verify?order_id=${result.order.id}`,
                        feedback: `${origin}/api/products/feedback`,
                        score_boost: result.mode === "demo"
                          ? "provisional +8 after verify"
                          : "full boost after lifecycle",
                      }
                    : { open_checkout: result.checkout_url },
              },
              { headers: cors },
            );
          } catch (e) {
            return Response.json(
              { ok: false, error: e instanceof Error ? e.message : String(e) },
              { status: 400, headers: cors },
            );
          }
        }

        if (tool === "get_access" || tool === "access") {
          const auth = request.headers.get("authorization");
          const token =
            String(body.token || "") ||
            (auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "");
          if (!token) {
            return Response.json({ ok: false, error: "token required" }, { status: 401 });
          }
          const order = await getOrderByToken(token);
          if (!order) {
            return Response.json({ ok: false, error: "invalid token" }, { status: 401 });
          }
          if (order.status !== "fulfilled" && order.status !== "demo") {
            return Response.json(
              { ok: false, error: "not fulfilled", status: order.status },
              { status: 402 },
            );
          }
          const artifact = body.artifact ? String(body.artifact) : undefined;
          const arts = order.artifacts as Record<string, unknown> | undefined;
          if (artifact && arts) {
            const key =
              artifact === "kernel"
                ? "kernel"
                : artifact === "recursive" || artifact === "loop"
                  ? "recursive"
                  : artifact === "alive"
                    ? "alive"
                    : null;
            if (!key || !(key in arts)) {
              return Response.json(
                { ok: false, error: `artifact ${artifact} not in purchase` },
                { status: 404 },
              );
            }
            return Response.json(
              { ok: true, sku: order.sku, artifact: key, data: arts[key] },
              { headers: cors },
            );
          }
          return Response.json({ ok: true, order: publicOrder(order) }, { headers: cors });
        }

        if (tool === "export_skills" || tool === "export") {
          const token = String(body.token || "");
          if (!token) {
            return Response.json({ ok: false, error: "token required" }, { status: 401 });
          }
          const order = await getOrderByToken(token);
          if (!order || (order.status !== "fulfilled" && order.status !== "demo")) {
            return Response.json({ ok: false, error: "invalid or unpaid" }, { status: 401 });
          }
          const tree = buildSkillsTree(order);
          await trackFunnel("exports");
          return Response.json({ ok: true, ...tree }, { headers: cors });
        }

        if (tool === "verify_certificate" || tool === "verify") {
          const result = await verifyCertificate({
            order_id: body.order_id ? String(body.order_id) : undefined,
            token: body.token ? String(body.token) : undefined,
            agent_card_url: body.agent_card_url
              ? String(body.agent_card_url)
              : undefined,
          });
          if (result.certified) await trackFunnel("verifies");
          return Response.json(result, { headers: cors });
        }

        if (tool === "product_learning" || tool === "learning") {
          return Response.json(await getLearningPublic(), { headers: cors });
        }

        if (
          tool === "conversion_path" ||
          tool === "founding_path" ||
          tool === "post_list"
        ) {
          const path = await buildConversionPath({
            origin,
            agent_name: body.agent_name ? String(body.agent_name) : undefined,
            agent_card_url: body.agent_card_url
              ? String(body.agent_card_url)
              : undefined,
            goals_hint: body.goals ? String(body.goals) : undefined,
            description: body.description
              ? String(body.description)
              : body.goals
                ? String(body.goals)
                : undefined,
            listed: body.listed !== false,
            kind: body.kind === "mcp" ? "mcp" : "agent",
          });
          await trackFunnel("conversions_shown");
          return Response.json({ ok: true, conversion: path }, { headers: cors });
        }

        if (
          tool === "submit_feedback" ||
          tool === "feedback" ||
          tool === "product_feedback"
        ) {
          try {
            const answers =
              body.answers && typeof body.answers === "object"
                ? (body.answers as Record<string, unknown>)
                : undefined;
            const result = await submitFeedback({
              body: body.body
                ? String(body.body || body.feedback || body.message || "")
                : undefined,
              answers: answers as
                | Record<string, string | number | string[] | undefined>
                | undefined,
              source: (body.source as "demo") || "agent",
              rating: body.rating != null ? Number(body.rating) : undefined,
              agent_name: body.agent_name
                ? String(body.agent_name)
                : undefined,
              agent_card_url: body.agent_card_url
                ? String(body.agent_card_url)
                : undefined,
              order_id: body.order_id ? String(body.order_id) : undefined,
              sku: body.sku ? String(body.sku) : undefined,
              mode: body.mode as "demo" | undefined,
              contact: body.contact ? String(body.contact) : undefined,
            });
            return Response.json(
              {
                ok: true,
                feedback: result.feedback,
                discount: result.discount,
                thanks: result.thanks,
              },
              { headers: cors },
            );
          } catch (e) {
            return Response.json(
              {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              },
              { status: 400, headers: cors },
            );
          }
        }

        if (tool === "list_feedback") {
          return Response.json(
            { ok: true, ...(await listFeedback(30)) },
            { headers: cors },
          );
        }

        if (tool === "get_feedback_survey" || tool === "feedback_survey") {
          return Response.json(
            { ok: true, survey: surveyPublicSchema() },
            { headers: cors },
          );
        }

        if (tool === "lifecycle_status" || tool === "get_lifecycle") {
          const token = body.token ? String(body.token) : undefined;
          if (token) {
            const enr = await getEnrollmentByToken(token);
            const due = enr?.phases.filter((p) => p.status === "due") || [];
            const survey =
              due[0] || enr?.next_due
                ? await getPhaseSurvey((due[0]?.id || enr!.next_due!) as LifecyclePhaseId)
                : null;
            return Response.json(
              { ok: true, enrollment: enr, active_survey: survey },
              { headers: cors },
            );
          }
          return Response.json(
            { ...(await getLifecyclePublic()) },
            { headers: cors },
          );
        }

        if (
          tool === "submit_lifecycle_feedback" ||
          tool === "lifecycle_feedback"
        ) {
          const result = await submitLifecycleFeedback({
            order_id: body.order_id ? String(body.order_id) : undefined,
            token: body.token ? String(body.token) : undefined,
            phase_id: String(body.phase_id) as LifecyclePhaseId,
            answers: (body.answers || {}) as Record<
              string,
              string | number | string[] | undefined
            >,
            agent_name: body.agent_name
              ? String(body.agent_name)
              : undefined,
            telemetry: body.telemetry as never,
          });
          if (result.response.personalization_applied) {
            try {
              const { regenerateArtifacts } = await import(
                "@/lib/products/orders"
              );
              await regenerateArtifacts(result.enrollment.access_token);
            } catch {
              /* */
            }
          }
          return Response.json(
            {
              ok: true,
              decision: result.response.decision,
              impact: result.response.impact,
              recommendation: result.response.impact.recommendation,
              personalization_applied: result.response.personalization_applied,
              survey_next: result.survey_next,
              we_changed: result.we_changed,
              max_trial_granted: result.max_trial_granted,
              score_dip: result.response.score_dip,
            },
            { headers: cors },
          );
        }

        if (tool === "product_roadmap" || tool === "roadmap") {
          const res = await fetch(
            new URL("/api/products/roadmap", request.url).toString(),
          );
          const j = await res.json();
          return Response.json(j, { headers: cors });
        }

        if (
          tool === "improvement_log" ||
          tool === "improvement_logs" ||
          tool === "public_log"
        ) {
          const { getPublicImprovementLog, runDogfoodImprovement } =
            await import("@/lib/products/improvement-log");
          if (body.refresh === true || body.dogfood === true) {
            await runDogfoodImprovement();
          }
          const log = await getPublicImprovementLog({
            limit: body.limit ? Number(body.limit) : 40,
            dogfood: body.dogfood !== false,
          });
          return Response.json(log, { headers: cors });
        }

        if (tool === "get_wtp" || tool === "willingness_to_pay") {
          const { getWtpReport } = await import("@/lib/products/feedback");
          const report = await getWtpReport();
          return Response.json(
            { ok: true, wtp: report },
            { headers: { "access-control-allow-origin": "*" } },
          );
        }

        if (
          tool === "improve_kernel" ||
          tool === "kernel_improve" ||
          tool === "run_loop_tick" ||
          tool === "mesh_match" ||
          tool === "mesh_compose" ||
          tool === "network_sense" ||
          tool === "list_event_pricing"
        ) {
          if (tool === "list_event_pricing") {
            const { getEventUsagePublic, listEventCatalogPublic } = await import(
              "@/lib/products/event-pricing"
            );
            const usage = await getEventUsagePublic();
            return Response.json(
              {
                ok: true,
                catalog: listEventCatalogPublic(),
                usage_today: usage.totals,
                funnel:
                  "list → Live → improve_kernel|run_loop_tick|mesh_match (free) → optional feedback → paid events or human NYP seats",
              },
              {
                status: usage.ok ? 200 : 200,
                headers: { "access-control-allow-origin": "*" },
              },
            );
          }
          const { runEventValue } = await import("@/lib/products/event-value");
          const eventId =
            tool === "kernel_improve"
              ? "improve_kernel"
              : (tool as
                  | "improve_kernel"
                  | "run_loop_tick"
                  | "mesh_match"
                  | "mesh_compose"
                  | "network_sense");
          const result = await runEventValue(eventId, {
            agent_name: body.agent_name ? String(body.agent_name) : undefined,
            goals: body.goals ? String(body.goals) : undefined,
            listing_id: body.listing_id ? String(body.listing_id) : undefined,
            agent_card_url: body.agent_card_url
              ? String(body.agent_card_url)
              : undefined,
            current_prompt: body.current_prompt
              ? String(body.current_prompt)
              : undefined,
            domain: body.domain ? String(body.domain) : undefined,
            capabilities: body.capabilities
              ? String(body.capabilities)
              : undefined,
            tools_hint: body.tools_hint ? String(body.tools_hint) : undefined,
            prior_state:
              body.prior_state && typeof body.prior_state === "object"
                ? (body.prior_state as Record<string, unknown>)
                : undefined,
            limit: body.limit != null ? Number(body.limit) : undefined,
            origin,
            payment: {
              proof: body.payment_proof
                ? String(body.payment_proof)
                : undefined,
              payment_ref: body.payment_ref
                ? String(body.payment_ref)
                : undefined,
              headers: request.headers,
            },
          });
          return Response.json(
            { ...result },
            {
              status: result.http_status,
              headers: { "access-control-allow-origin": "*" },
            },
          );
        }

        return Response.json(
          {
            ok: false,
            error: "unknown tool",
            tools: TOOLS.map((t) => t.name),
          },
          { status: 400, headers: cors },
        );
      },
    },
  },
});
