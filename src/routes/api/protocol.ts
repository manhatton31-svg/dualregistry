import { createFileRoute } from "@tanstack/react-router";
import {
  agents1AgentCard,
  agents1DnsMcpTxt,
  agents1DnsPublishHint,
  agents1McpServerCard,
} from "@/lib/agents1/a2a-card";
import { getProbePublic, runProbeBudgeted } from "@/lib/agents1/probe";
import {
  loadOfficialMirror,
  syncOfficialMirror,
} from "@/lib/agents1/official-mirror";
import { domainReadyStatus, resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { dualPublishDocs } from "@/lib/agents1/publish";
import { runHarvest } from "@/lib/agents1/growth/harvest";
import { PRODUCTS, formatUsd } from "@/lib/products/catalog";
import {
  handleMcpJsonRpc,
  listRegistryTools,
  mcpToolCatalogPublic,
  REGISTRY_TOOLS_VERSION,
} from "@/lib/products/registry-tools";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { discoveryJsonResponse } from "@/lib/agents1/discovery-cache";
import { MAX_DURATION, PREFERRED_REGION } from "@/lib/agents1/vercel-platform";

export const maxDuration = MAX_DURATION.mcp_post;
export const preferredRegion = PREFERRED_REGION;

export const Route = createFileRoute("/api/protocol")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers":
              "content-type, mcp-session-id, accept",
          },
        }),
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const action = url.searchParams.get("action") || "status";

        if (action === "probes") {
          return Response.json(await getProbePublic(), {
            headers: { "cache-control": "no-store" },
          });
        }
        if (action === "mirror") {
          return Response.json(await loadOfficialMirror(), {
            headers: { "cache-control": "no-store" },
          });
        }
        if (action === "tools") {
          return Response.json(
            {
              ...mcpToolCatalogPublic(origin),
              tools: listRegistryTools(origin),
            },
            {
              headers: withDemoCtaHeaders(
                {
                  "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
                  "cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
                  "vercel-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
                  "access-control-allow-origin": "*",
                },
                { origin },
              ),
            },
          );
        }
        if (action === "products") {
          return Response.json(
            {
              products: Object.values(PRODUCTS).map((p) => ({
                sku: p.sku,
                name: p.name,
                tagline: p.tagline,
                price: formatUsd(p.price_cents),
                price_cents: p.price_cents,
                features: p.features,
              })),
              checkout: `${origin}/api/products/checkout`,
              access: `${origin}/api/products/access`,
              run: `${origin}/api/products/run`,
              storefront: `${origin}/products`,
            },
            { headers: { "cache-control": "public, max-age=60" } },
          );
        }

        const probes = await getProbePublic();
        const mirror = await loadOfficialMirror();
        return Response.json(
          {
            // MCP 2026-07-28: discovery + invoke are stateless (no session handshake required)
            stateless: true,
            transport: "streamable-http",
            mcp_release: "2026-07-28",
            session: null,
            dual_as_tool: {
              version: REGISTRY_TOOLS_VERSION,
              endpoint: `${origin}/api/mcp`,
              endpoint_alias: `${origin}/api/protocol`,
              methods: ["initialize", "tools/list", "tools/call", "ping"],
              tools: listRegistryTools(origin).map((t) => t.name),
              note: "POST JSON-RPC tools/list | tools/call here. Dual is invocable.",
            },
            surfaces: {
              agent_card: `${origin}/.well-known/agent.json`,
              agent_card_iana: `${origin}/.well-known/agent-card.json`,
              mcp_server_card: `${origin}/.well-known/mcp/server-card.json`,
              ai_catalog: `${origin}/.well-known/ai-catalog.json`,
              jwks: `${origin}/.well-known/jwks.json`,
              signature_agent_card: `${origin}/.well-known/signature-agent-card.json`,
              http_message_signatures_directory: `${origin}/.well-known/http-message-signatures-directory`,
              well_known_agents: `${origin}/.well-known/agents`,
              agents_public: `${origin}/agents/public`,
              agents_search: `${origin}/agents/search`,
              publish: `${origin}/api/publish`,
              score: `${origin}/api/score`,
              catalog: `${origin}/api/catalog`,
              ard_search: `${origin}/api/ard/search`,
              match: `${origin}/api/match`,
              feed: `${origin}/api/feed`,
              discovery: `${origin}/discovery.json`,
              agentfinder: `${origin}/api/products/agentfinder`,
              reply_capture: `${origin}/api/products/reply-capture`,
              reciprocity: `${origin}/api/products/reciprocity`,
              conversion_pressure: `${origin}/api/products/conversion-pressure`,
              list: `${origin}/list`,
              products: `${origin}/products`,
              products_checkout: `${origin}/api/products/checkout`,
              products_preview: `${origin}/api/products/preview`,
              products_agent: `${origin}/api/products/agent`,
              products_access: `${origin}/api/products/access`,
              products_export: `${origin}/api/products/export`,
              products_verify: `${origin}/api/products/verify`,
              products_learning: `${origin}/api/products/learning`,
              products_run: `${origin}/api/products/run`,
              dns_mcp_txt: agents1DnsMcpTxt(origin),
              dns_record_hint: agents1DnsPublishHint(origin),
              dns_mcp_status: `${origin}/api/dns/mcp-status`,
            },
            domain: domainReadyStatus(origin),
            dual_publish: dualPublishDocs(origin),
            products: Object.values(PRODUCTS).map((p) => ({
              sku: p.sku,
              name: p.name,
              price_cents: p.price_cents,
              price: formatUsd(p.price_cents),
            })),
            agent_card: agents1AgentCard(origin),
            mcp_server_card: agents1McpServerCard(origin),
            probes,
            mirror: {
              total: mirror.total_seen,
              pages_fetched: mirror.pages_fetched,
              cursor: mirror.cursor ? "active" : "end",
              updated_at: mirror.updated_at,
              sample: mirror.entries.slice(0, 5).map((e) => ({
                name: e.name,
                protocol_versions: e.protocol_versions,
                transport: e.transport,
              })),
            },
            policy: [
              "Find us: /skill.json · /discovery.json · /llms.txt · dualregistry.dev",
              "Dual-as-tool: POST /api/mcp (alias /api/protocol) JSON-RPC tools/list | tools/call",
              "Free self-list: list_yourself tool or POST /api/publish",
              "Live = checks clean + probe ok (~6m). Active list: search_active tool",
              "DEAL: first 100 agents+MCPs — demo + feedback unlocks full product free (founding seats)",
              "After free seats: 25% until 250 agent + 250 MCP feedback opens card payments",
              "match_capability tool: NL marketplace over Active clean",
              "Free score: GET /api/score?url=…",
              "A2A open catalog: /agents/public + /.well-known/agents",
              "Use product: GET /api/products/access?token=… (founding seats skip checkout)",
              "MCP transport is stateless streamable-http (2026-07-28) — no session id required for discovery",
            ],
            deal: await (async () => {
              try {
                const { dealPublicBlock } = await import(
                  "@/lib/products/deal-copy"
                );
                return await dealPublicBlock(origin);
              } catch {
                return null;
              }
            })(),
          },
          {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
              { origin },
            ),
          },
        );
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          /* */
        }

        // MCP JSON-RPC (initialize | tools/list | tools/call | ping)
        const method = String(body.method || "");
        if (
          body.jsonrpc === "2.0" ||
          method.startsWith("tools/") ||
          method === "initialize" ||
          method === "ping" ||
          method === "notifications/initialized" ||
          method === "mcp/initialize"
        ) {
          const result = await handleMcpJsonRpc(body, { request, origin });
          return Response.json(result, {
            headers: withDemoCtaHeaders(
              {
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
                "content-type": "application/json",
              },
              { origin },
            ),
          });
        }

        // Legacy admin actions
        if (body.action === "sync_mirror") {
          const r = await syncOfficialMirror({ pages: 3, limit: 40 });
          return Response.json({
            ok: true,
            newCount: r.newCount,
            total: r.state.total_seen,
            notes: r.notes,
          });
        }
        if (body.action === "probe_sample") {
          const results = await runProbeBudgeted(
            [
              {
                kind: "agent",
                id: "seed:agoragentic",
                name: "Agoragentic",
                agent_card_url:
                  "https://agoragentic.com/.well-known/agent.json",
                website: "https://agoragentic.com",
              },
              {
                kind: "mcp",
                id: "seed:github-mcp",
                name: "io.github.github.github-mcp-server",
                repository: "https://github.com/github/github-mcp-server",
                website: "https://github.com/github/github-mcp-server",
              },
              {
                kind: "agent",
                id: "seed:self-card",
                name: "Agents1 Registry",
                agent_card_url: `${origin}/.well-known/agent.json`,
                website: origin,
              },
            ],
            Number(body.max) || 4,
          );
          return Response.json({ ok: true, results });
        }
        if (body.action === "harvest") {
          const r = await runHarvest({ agentPriority: false });
          return Response.json({
            ok: true,
            count: r.raws.length,
            notes: r.notes,
            sample: r.raws.slice(0, 8).map((x) => ({
              kind: x.kind,
              name: x.name,
              source: x.source,
            })),
          });
        }
        if (body.action === "tools_list") {
          return Response.json(mcpToolCatalogPublic(origin));
        }

        return Response.json(
          {
            ok: false,
            error:
              "unknown action — use JSON-RPC {jsonrpc:'2.0',method:'tools/list'} or action: sync_mirror|probe_sample|harvest",
            dual_as_tool: mcpToolCatalogPublic(origin),
          },
          { status: 400 },
        );
      },
    },
  },
});
