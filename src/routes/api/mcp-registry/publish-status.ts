/**
 * GET /api/mcp-registry/publish-status
 * Readiness for official MCP Registry self-publish + search if already listed.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import { checkMcpDns } from "@/lib/agents1/dns-mcp";

async function searchOfficial(q: string): Promise<{ total?: number; found?: boolean; sample?: unknown }> {
  try {
    const url = `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=5`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "DualRegistry/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { found: false };
    const j = (await res.json()) as { servers?: unknown[]; metadata?: { count?: number } };
    const servers = j.servers || (j as { results?: unknown[] }).results || [];
    const arr = Array.isArray(servers) ? servers : [];
    return {
      total: (j.metadata as { count?: number } | undefined)?.count ?? arr.length,
      found: arr.length > 0,
      sample: arr[0] || null,
    };
  } catch (e) {
    return { found: false, sample: e instanceof Error ? e.message : String(e) };
  }
}

export const Route = createFileRoute("/api/mcp-registry/publish-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request).replace(/\/$/, "");
        const dns = await checkMcpDns(origin);
        const githubNs = "io.github.manhatton31-svg/dualregistry";
        const domainNs = "dev.dualregistry/registry";
        const [gh, domain, agents1] = await Promise.all([
          searchOfficial("dualregistry"),
          searchOfficial("dev.dualregistry/registry"),
          searchOfficial("io.agents1.registry"),
        ]);

        const packageUrl = `${origin}/api/mcp-registry/server.json`;
        return Response.json(
          {
            ok: true,
            listed:
              Boolean(gh.found) || Boolean(domain.found) || Boolean(agents1.found),
            published_name: domainNs,
            official_search:
              "https://registry.modelcontextprotocol.io/v0/servers?search=dualregistry",
            searches: {
              dualregistry: gh,
              domain_ns: domain,
              agents1: agents1,
            },
            package: packageUrl,
            recommended_names: [domainNs, "dev.dualregistry.www/registry", githubNs],
            dns,
            mcp_registry_auth: `${origin}/.well-known/mcp-registry-auth`,
            publish_steps: [
              "LIVE as dev.dualregistry/registry v2.0.1 (apex DNS MCPv1 auth + remote streamable-http).",
              "DNS _mcp TXT live for MCP discovery draft.",
              "Apex TXT: v=MCPv1; k=ed25519; p=… for registry ownership.",
              "To republish: mcp-publisher login dns --domain dualregistry.dev --private-key <hex>",
              "Then: mcp-publisher publish server.json",
            ],
            note:
              "Official registry entry LIVE under clean namespace. _mcp DNS TXT live. robots.txt may still be CF-managed; use /agentmap.json and /robots-agent.txt.",
            automation_status: {
              package_live: true,
              official_registry_listed: Boolean(gh.found || domain.found),
              dns_txt_live: dns.live,
              http_auth_live: true,
              apex_dns_auth: true,
              interactive_auth_required: false,
            },
          },
          {
            headers: withDemoCtaHeaders(
              { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
              { origin },
            ),
          },
        );
      },
    },
  },
});
