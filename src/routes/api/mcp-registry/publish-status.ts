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
        const domainNs = "io.dualregistry.dev/registry";
        const [gh, domain, agents1] = await Promise.all([
          searchOfficial("dualregistry"),
          searchOfficial("io.dualregistry"),
          searchOfficial("io.agents1.registry"),
        ]);

        const packageUrl = `${origin}/api/mcp-registry/server.json`;
        return Response.json(
          {
            ok: true,
            listed:
              Boolean(gh.found) || Boolean(domain.found) || Boolean(agents1.found),
            searches: {
              dualregistry: gh,
              domain_ns: domain,
              agents1: agents1,
            },
            package: packageUrl,
            recommended_names: [domainNs, githubNs, "io.agents1.registry"],
            dns,
            publish_steps: [
              "1. Install CLI: curl -L https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_linux_amd64.tar.gz | tar xz mcp-publisher",
              `2. Download package: curl -o server.json ${packageUrl}`,
              "3a. Domain namespace (preferred): set DNS _mcp TXT (see /api/dns/mcp-status), then: mcp-publisher login dns",
              "3b. GitHub namespace fallback: mcp-publisher login github  (device flow)",
              "4. mcp-publisher publish",
              '5. Verify: curl "https://registry.modelcontextprotocol.io/v0/servers?search=dualregistry"',
            ],
            note:
              "Official registry publish requires interactive auth (GitHub device flow or DNS ownership). Package + DNS check are fully automated here; final publish is one CLI login away.",
            automation_status: {
              package_live: true,
              dns_txt_live: dns.live,
              interactive_auth_required: true,
            },
          },
          {
            headers: withDemoCtaHeaders(
              { "cache-control": "public, max-age=60" },
              { origin },
            ),
          },
        );
      },
    },
  },
});
