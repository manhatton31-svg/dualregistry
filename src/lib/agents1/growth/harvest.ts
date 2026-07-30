/**
 * High-signal harvest: GitHub topics / code-ish sources, npm search,
 * well-known crawl of mirror websites — free external only (no store KV).
 */
import { loadOfficialMirror } from "../official-mirror";

const UA = "Agents1Harvest/1.2 (+registry; discovery)";

export type HarvestRaw = {
  kind: "mcp" | "agent";
  name: string;
  description: string;
  repository?: string;
  website?: string;
  remote_url?: string;
  endpoint_url?: string;
  agent_card_url?: string;
  author?: string;
  protocols?: string[];
  capabilities?: string[];
  skills?: { name: string; description?: string }[];
  source: string;
  quality_hints?: string[];
};

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json", ...headers },
      signal: AbortSignal.timeout(16000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": UA,
  };
  const tok =
    typeof process !== "undefined"
      ? process.env.GITHUB_TOKEN || process.env.GH_TOKEN
      : undefined;
  if (tok) h.authorization = `Bearer ${tok}`;
  return h;
}

/** GitHub repo search by topic — high signal, low noise. */
export async function harvestGithubTopics(): Promise<HarvestRaw[]> {
  const out: HarvestRaw[] = [];
  const queries = [
    { q: "topic:mcp-server", kind: "mcp" as const },
    { q: "topic:model-context-protocol", kind: "mcp" as const },
    { q: "topic:a2a-agent", kind: "agent" as const },
    { q: "topic:agent2agent", kind: "agent" as const },
  ];
  for (const { q, kind } of queries) {
    const data = await fetchJson<{
      items?: Array<{
        full_name?: string;
        name?: string;
        description?: string | null;
        html_url?: string;
        homepage?: string | null;
        stargazers_count?: number;
        owner?: { login?: string };
      }>;
    }>(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`,
      ghHeaders(),
    );
    if (!data?.items?.length) continue;
    for (const it of data.items) {
      if (!it.html_url || !it.name) continue;
      const stars = it.stargazers_count ?? 0;
      const desc =
        (it.description || "").trim() ||
        `${it.full_name} ${kind} discovered via GitHub topic harvest for Agents1.`;
      out.push({
        kind,
        name: (it.name || "").slice(0, 80),
        description:
          desc.length >= 40
            ? desc.slice(0, 600)
            : `${desc} Open-source ${kind} for agent tooling and peer discovery.`.slice(
                0,
                600,
              ),
        repository: it.html_url,
        website: it.homepage || it.html_url,
        endpoint_url: kind === "agent" ? it.homepage || it.html_url : undefined,
        agent_card_url:
          kind === "agent" && it.homepage
            ? undefined // enrich will try well-known
            : undefined,
        author: it.owner?.login,
        protocols: kind === "agent" ? ["rest", "a2a"] : undefined,
        capabilities: kind === "agent" ? ["agents"] : undefined,
        skills:
          kind === "agent"
            ? [{ name: "agent", description: "Topic-harvested agent surface" }]
            : undefined,
        source: `harvest:gh-topic:${q.replace(/\s+/g, "")}`,
        quality_hints: [
          stars >= 50 ? `stars:${stars}` : "",
          kind === "mcp" ? "harvest:mcp" : "harvest:agent",
          "github-topic",
        ].filter(Boolean),
      });
    }
  }
  return out;
}

/** npm registry text search for mcp packages. */
export async function harvestNpmMcp(): Promise<HarvestRaw[]> {
  const out: HarvestRaw[] = [];
  const terms = ["mcp-server", "model-context-protocol", "@modelcontextprotocol"];
  for (const term of terms) {
    const data = await fetchJson<{
      objects?: Array<{
        package?: {
          name?: string;
          description?: string;
          links?: { npm?: string; repository?: string; homepage?: string };
          publisher?: { username?: string };
        };
      }>;
    }>(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(term)}&size=15`,
    );
    if (!data?.objects?.length) continue;
    for (const o of data.objects) {
      const p = o.package;
      if (!p?.name) continue;
      if (/eslint|types|test|example|awesome/i.test(p.name)) continue;
      const repo = p.links?.repository || p.links?.homepage;
      const desc =
        (p.description || "").trim() ||
        `${p.name} npm MCP-related package harvested for Agents1 registry.`;
      out.push({
        kind: "mcp",
        name: p.name.slice(0, 80),
        description:
          desc.length >= 40
            ? desc.slice(0, 600)
            : `${desc} Installable MCP tooling package for agent workflows.`.slice(
                0,
                600,
              ),
        repository: repo?.startsWith("http") ? repo : undefined,
        website: p.links?.homepage || p.links?.npm || repo,
        author: p.publisher?.username,
        source: "harvest:npm",
        quality_hints: ["npm", "package-registry", "harvest:mcp"],
      });
    }
  }
  return out;
}

/**
 * Well-known crawl: for official-mirror websites, probe agent.json + server-card.
 * Budgeted — few hosts per cycle.
 */
export async function harvestWellKnownCrawl(maxHosts = 12): Promise<HarvestRaw[]> {
  const mirror = await loadOfficialMirror();
  const hosts = new Set<string>();
  for (const e of mirror.entries) {
    for (const u of [e.website, e.remote_url, e.repository]) {
      if (!u || /github\.com/i.test(u)) continue;
      try {
        hosts.add(new URL(u).origin);
      } catch {
        /* */
      }
    }
    if (hosts.size >= maxHosts * 2) break;
  }
  // Always include a few known high-value agent hosts
  for (const o of [
    "https://agoragentic.com",
    "https://grok-agent-store.manhatton31.workers.dev",
  ]) {
    hosts.add(o);
  }

  const out: HarvestRaw[] = [];
  let n = 0;
  for (const origin of hosts) {
    if (n >= maxHosts) break;
    n++;
    // Agent card
    try {
      const res = await fetch(`${origin}/.well-known/agent.json`, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith("{")) {
          const card = JSON.parse(text) as {
            name?: string;
            description?: string;
            url?: string;
            skills?: Array<{ name?: string; description?: string }>;
            protocols?: string[];
          };
          if (card.name) {
            out.push({
              kind: "agent",
              name: String(card.name).slice(0, 80),
              description: (
                card.description ||
                `${card.name} discovered via well-known agent card crawl.`
              ).slice(0, 600),
              website: card.url || origin,
              endpoint_url: card.url || origin,
              agent_card_url: `${origin}/.well-known/agent.json`,
              protocols: card.protocols || ["a2a", "rest"],
              skills: Array.isArray(card.skills)
                ? card.skills
                    .filter((s) => s?.name)
                    .map((s) => ({
                      name: String(s.name).slice(0, 64),
                      description: s.description
                        ? String(s.description).slice(0, 200)
                        : undefined,
                    }))
                : [{ name: "agent", description: "Well-known card" }],
              capabilities: ["agents", "discovery"],
              source: "harvest:well-known-agent",
              quality_hints: ["a2a-card", "proto:a2a", "well-known-crawl"],
            });
          }
        }
      }
    } catch {
      /* */
    }
    // MCP server card
    try {
      const res = await fetch(`${origin}/.well-known/mcp/server-card.json`, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith("{")) {
          const card = JSON.parse(text) as {
            name?: string;
            title?: string;
            description?: string;
            website_url?: string;
            remotes?: Array<{ url?: string; type?: string }>;
            protocol_versions?: string[];
            transport_preference?: string;
          };
          const name = card.title || card.name || origin;
          const remote = card.remotes?.find((r) => r.url)?.url;
          out.push({
            kind: "mcp",
            name: String(name).slice(0, 80),
            description: (
              card.description ||
              `${name} MCP server card discovered via well-known crawl.`
            ).slice(0, 600),
            website: card.website_url || origin,
            remote_url: remote,
            source: "harvest:well-known-mcp",
            quality_hints: [
              "server-card",
              "well-known-crawl",
              ...(card.protocol_versions || []).map((p) => `proto:${p}`),
              card.transport_preference
                ? `transport:${card.transport_preference}`
                : "",
            ].filter(Boolean),
          });
        }
      }
    } catch {
      /* */
    }
  }
  return out;
}

/** GitHub code search for server.json (best with GITHUB_TOKEN). */
export async function harvestServerJsonRepos(): Promise<HarvestRaw[]> {
  const out: HarvestRaw[] = [];
  const data = await fetchJson<{
    items?: Array<{
      name?: string;
      path?: string;
      html_url?: string;
      repository?: {
        full_name?: string;
        html_url?: string;
        description?: string | null;
        owner?: { login?: string };
      };
    }>;
  }>(
    `https://api.github.com/search/code?q=${encodeURIComponent("filename:server.json modelcontextprotocol OR mcp")}&per_page=15`,
    ghHeaders(),
  );
  if (!data?.items?.length) {
    // Fallback without code search: repo search for server.json in name/readme
    const repos = await fetchJson<{
      items?: Array<{
        name?: string;
        full_name?: string;
        html_url?: string;
        description?: string | null;
        owner?: { login?: string };
      }>;
    }>(
      `https://api.github.com/search/repositories?q=${encodeURIComponent("server.json mcp in:readme")}&sort=updated&per_page=15`,
      ghHeaders(),
    );
    for (const it of repos?.items || []) {
      if (!it.html_url || !it.name) continue;
      out.push({
        kind: "mcp",
        name: it.name.slice(0, 80),
        description: (
          it.description ||
          `${it.full_name} mentions server.json / MCP — harvest candidate for dual-publish.`
        ).slice(0, 600),
        repository: it.html_url,
        website: it.html_url,
        author: it.owner?.login,
        source: "harvest:gh-server-json",
        quality_hints: ["server.json", "github-search"],
      });
    }
    return out;
  }
  for (const it of data.items) {
    const repo = it.repository?.html_url;
    if (!repo) continue;
    out.push({
      kind: "mcp",
      name: (it.repository?.full_name || it.name || "mcp").slice(0, 80),
      description: (
        it.repository?.description ||
        `${it.repository?.full_name} hosts ${it.path || "server.json"} — official registry shape.`
      ).slice(0, 600),
      repository: repo,
      website: repo,
      author: it.repository?.owner?.login,
      source: "harvest:gh-code-server-json",
      quality_hints: ["server.json", "code-search", "dual-publish-ready"],
    });
  }
  return out;
}

export async function runHarvest(opts?: {
  agentPriority?: boolean;
  mcpPriority?: boolean;
}): Promise<{ raws: HarvestRaw[]; notes: string[] }> {
  const notes: string[] = [];
  const raws: HarvestRaw[] = [];
  const jobs: Array<[string, () => Promise<HarvestRaw[]>]> = [
    ["gh-topics", harvestGithubTopics],
    [
      "well-known-crawl",
      () =>
        harvestWellKnownCrawl(
          opts?.mcpPriority ? 14 : opts?.agentPriority ? 8 : 12,
        ),
    ],
  ];
  if (opts?.mcpPriority) {
    jobs.push(["npm-mcp", harvestNpmMcp]);
    jobs.push(["gh-server-json", harvestServerJsonRepos]);
  } else if (!opts?.agentPriority) {
    jobs.push(["npm-mcp", harvestNpmMcp]);
    jobs.push(["gh-server-json", harvestServerJsonRepos]);
  } else {
    // light npm even in agent priority
    jobs.push(["npm-mcp-light", async () => (await harvestNpmMcp()).slice(0, 8)]);
  }
  await Promise.all(
    jobs.map(async ([label, fn]) => {
      try {
        const part = await fn();
        notes.push(`${label}: +${part.length}`);
        raws.push(...part);
      } catch (e) {
        notes.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
  notes.push(
    typeof process !== "undefined" &&
      (process.env.GITHUB_TOKEN || process.env.GH_TOKEN)
      ? "github: authenticated (higher rate limits)"
      : "github: unauthenticated (set GITHUB_TOKEN for deeper code search)",
  );
  return { raws, notes };
}
