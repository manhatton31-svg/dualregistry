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

export const Route = createFileRoute("/api/protocol")({
  server: {
    handlers: {
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
            surfaces: {
              agent_card: `${origin}/.well-known/agent.json`,
              agent_card_iana: `${origin}/.well-known/agent-card.json`,
              mcp_server_card: `${origin}/.well-known/mcp/server-card.json`,
              ai_catalog: `${origin}/.well-known/ai-catalog.json`,
              jwks: `${origin}/.well-known/jwks.json`,
              well_known_agents: `${origin}/.well-known/agents`,
              agents_public: `${origin}/agents/public`,
              agents_search: `${origin}/agents/search`,
              publish: `${origin}/api/publish`,
              score: `${origin}/api/score`,
              catalog: `${origin}/api/catalog`,
              ard_search: `${origin}/api/ard/search`,
              feed: `${origin}/api/feed`,
              discovery: `${origin}/discovery.json`,
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
              "Free self-list: POST /api/publish with agent-card or MCP server.json",
              "Live = checks clean + probe ok (~6m). Active list: /api/listings/active",
              "DEAL: first 100 agents+MCPs — demo + feedback unlocks full product free (founding seats)",
              "After free seats: 25% until 250 agent + 250 MCP feedback opens card payments",
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
          { headers: { "cache-control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        let body: { action?: string; max?: number } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
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
          const origin = resolvePublicOrigin(request);
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
            body.max ?? 4,
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
        return Response.json(
          { ok: false, error: "unknown action" },
          { status: 400 },
        );
      },
    },
  },
});
