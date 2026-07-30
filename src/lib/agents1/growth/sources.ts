import type { GrowthCandidate } from "./types";
import { candidateKey } from "./persist";
import { runHarvest } from "./harvest";

const UA = "Agents1GrowthBot/1.2";

type Raw = Omit<
  GrowthCandidate,
  | "id"
  | "status"
  | "attempts"
  | "discovered_at"
  | "updated_at"
  | "last_error"
  | "store_id"
  | "store_slug"
  | "safety_score"
> & { quality_hints?: string[] };

function norm(s: string | undefined, fb: string) {
  const t = (s || "").trim().replace(/\s+/g, " ");
  return (t.length >= 40 ? t : fb).slice(0, 600);
}

function toCandidate(raw: Raw): GrowthCandidate {
  const ts = new Date().toISOString();
  const id = `${raw.kind}:${raw.name}:${raw.repository || raw.website || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80);
  return {
    ...raw,
    description: norm(
      raw.description,
      `${raw.name} is a community ${raw.kind} for peer discovery and agent collaboration on the open registry.`,
    ),
    quality_hints: raw.quality_hints,
    id,
    status: "queued",
    attempts: 0,
    discovered_at: ts,
    updated_at: ts,
  };
}

/** Only candidates with a real probe target at the source we found. */
function isProbeableRaw(r: Raw): boolean {
  if (r.agent_card_url || r.remote_url || r.mcp_url) return true;
  if (r.endpoint_url && /^https?:\/\//i.test(r.endpoint_url)) return true;
  if (
    r.website &&
    /well-known|agent\.json|server-card|mcp/i.test(r.website)
  )
    return true;
  return false;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 16000);
  try {
    const res = await fetch(url, {
      signal: c.signal,
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string): Promise<string | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 16000);
  try {
    const res = await fetch(url, {
      signal: c.signal,
      headers: { "user-agent": UA },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** High-quality agent seeds with surfaces + skills. */
const SEED_AGENTS: Raw[] = [
  {
    kind: "agent",
    name: "CrewAI",
    description:
      "Framework for orchestrating role-playing autonomous AI agents that collaborate on complex multi-step tasks with tools and memory.",
    repository: "https://github.com/crewAIInc/crewAI",
    website: "https://www.crewai.com",
    endpoint_url: "https://www.crewai.com",
    author: "crewAIInc",
    protocols: ["rest", "a2a"],
    capabilities: ["multi-agent", "orchestration", "tools"],
    skills: [
      { name: "crew", description: "Multi-agent crew orchestration" },
      { name: "tools", description: "Tool-using agent workflows" },
    ],
    source: "seed:crewai",
    quality_hints: ["proto:a2a"],
  },
  {
    kind: "agent",
    name: "AutoGen",
    description:
      "Microsoft AutoGen multi-agent conversation framework for building LLM applications with cooperating agents and group chat patterns.",
    repository: "https://github.com/microsoft/autogen",
    website: "https://microsoft.github.io/autogen/",
    endpoint_url: "https://microsoft.github.io/autogen/",
    author: "microsoft",
    protocols: ["rest", "a2a"],
    capabilities: ["multi-agent", "conversation"],
    skills: [{ name: "autogen", description: "Multi-agent conversations" }],
    source: "seed:autogen",
  },
  {
    kind: "agent",
    name: "LangGraph",
    description:
      "LangChain LangGraph for building stateful multi-actor agent applications with durable execution graphs and human-in-the-loop control.",
    repository: "https://github.com/langchain-ai/langgraph",
    website: "https://langchain-ai.github.io/langgraph/",
    endpoint_url: "https://langchain-ai.github.io/langgraph/",
    author: "langchain-ai",
    protocols: ["rest"],
    capabilities: ["graphs", "stateful-agents"],
    skills: [{ name: "langgraph", description: "Stateful agent graphs" }],
    source: "seed:langgraph",
  },
];

const SEED_MCPS: Raw[] = [
  {
    kind: "mcp",
    name: "GitHub MCP",
    description: "Official-style GitHub MCP for repos, issues, PRs.",
    repository: "https://github.com/github/github-mcp-server",
    website: "https://github.com/github/github-mcp-server",
    remote_url: "https://api.githubcopilot.com/mcp/",
    author: "github",
    source: "seed:github-mcp",
  },
];

async function agentCards(): Promise<Raw[]> {
  // Known live agent cards + light expansion from mirror-style hosts
  const seeds = [
    "https://agoragentic.com/.well-known/agent.json",
    "https://tensorfeed.ai/.well-known/agent.json",
    "https://nexez.ai/.well-known/agent.json",
    "https://api.pictomancer.ai/.well-known/agent.json",
    "https://www.sitepulsar.ai/.well-known/agent.json",
    "https://mcp.law.ai/.well-known/agent.json",
    "https://api.meacheal.ai/.well-known/agent.json",
    "https://nothumansearch.ai/.well-known/agent.json",
    "https://corduroy-labs.ai/.well-known/agent.json",
    "https://aibtc.com/.well-known/agent.json",
    "https://gouvernance.ai/.well-known/agent-card.json",
    "https://agent.yuens.me/.well-known/agent.json",
    "https://www.scriptmasterlabs.com/.well-known/agent.json",
    "https://africanmarketos.com/.well-known/agent.json",
    "https://agent-guild-5d5r.onrender.com/.well-known/agent.json",
  ];
  const out: Raw[] = [];
  for (const u of seeds) {
    const j = await fetchJson<{
      name?: string;
      description?: string;
      url?: string;
    }>(u);
    if (!j?.name) continue;
    out.push({
      kind: "agent",
      name: j.name,
      description: j.description || `${j.name} agent card`,
      website: u.replace(/\/\.well-known\/.*$/, ""),
      agent_card_url: u,
      endpoint_url: j.url || u,
      source: "agent-cards",
      quality_hints: ["probeable", "well-known"],
    });
  }
  return out;
}

async function awesomeAgentsReadme(): Promise<Raw[]> {
  // Avoid bulk name dumps without URLs — return empty (harvest handles real URLs)
  return [];
}

async function officialMcp(): Promise<Raw[]> {
  // Official MCP registry — ONLY real remotes. Deep-paginate past already-clean head.
  // Shape: { servers: [{ server: { remotes } }] }
  const out: Raw[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  // ~16×100 covers full public remote catalog (~700+) so growth never starves at ~75
  for (let page = 0; page < 16 && out.length < 800; page++) {
    const q = new URL("https://registry.modelcontextprotocol.io/v0/servers");
    q.searchParams.set("limit", "100");
    if (cursor) q.searchParams.set("cursor", cursor);
    const data = await fetchJson<{
      servers?: Array<{
        server?: {
          name?: string;
          description?: string;
          title?: string;
          repository?: { url?: string } | string;
          websiteUrl?: string;
          remotes?: Array<{ url?: string; type?: string }>;
        };
        name?: string;
        description?: string;
        repository?: { url?: string } | string;
        websiteUrl?: string;
        remotes?: Array<{ url?: string; type?: string }>;
      }>;
      metadata?: { nextCursor?: string };
      nextCursor?: string;
    }>(q.toString());
    for (const row of data?.servers || []) {
      const s = (row.server || row) as {
        name?: string;
        description?: string;
        title?: string;
        repository?: { url?: string } | string;
        websiteUrl?: string;
        remotes?: Array<{ url?: string; type?: string }>;
      };
      // Take EVERY remote URL — multi-remote servers were previously truncated to first
      const remotes = (s.remotes || [])
        .map((r) => r?.url)
        .filter((u): u is string => Boolean(u && /^https?:\/\//i.test(u)));
      if (!remotes.length) continue;
      const nameBase = (s.name || s.title || remotes[0] || "mcp").slice(0, 80);
      const repo =
        typeof s.repository === "string"
          ? s.repository
          : s.repository?.url;
      for (let i = 0; i < remotes.length; i++) {
        const remote = remotes[i]!;
        if (seen.has(remote)) continue;
        seen.add(remote);
        const name =
          remotes.length > 1
            ? `${nameBase} · r${i + 1}`.slice(0, 80)
            : nameBase;
        out.push({
          kind: "mcp",
          name,
          description: (s.description || `${nameBase} remote MCP`).slice(
            0,
            600,
          ),
          repository: repo,
          website: s.websiteUrl || remote,
          remote_url: remote,
          source: "official-mcp-registry",
          quality_hints: ["probeable", "official-registry-remote"],
        });
        if (out.length >= 800) break;
      }
      if (out.length >= 800) break;
    }
    cursor = data?.metadata?.nextCursor || data?.nextCursor || undefined;
    if (!cursor || !(data?.servers || []).length) break;
  }
  return out;
}

async function awesomeMcp(): Promise<Raw[]> {
  return [];
}

export type DiscoverOpts = {
  agentPriority?: boolean;
  mcpPriority?: boolean;
  /** URLs already clean or queued — skip so we dig past the known head */
  skipUrls?: Set<string>;
  /** Cap returned candidates after dedupe */
  max?: number;
};

export async function discoverCandidates(
  opts?: DiscoverOpts,
): Promise<{ candidates: GrowthCandidate[]; notes: string[] }> {
  const notes: string[] = [];
  const raws: Raw[] = [];
  const agentJobs: Array<[string, () => Promise<Raw[]>]> = [
    ["seed-agents", async () => SEED_AGENTS.filter(isProbeableRaw)],
    ["agent-cards", agentCards],
    ["awesome-agents", awesomeAgentsReadme],
  ];
  const mcpJobs: Array<[string, () => Promise<Raw[]>]> = [
    ["seed-mcps", async () => SEED_MCPS.filter(isProbeableRaw)],
    ["official-mcp", officialMcp],
    ["awesome-mcp", awesomeMcp],
  ];
  const jobs: Array<[string, () => Promise<Raw[]>]> = [];
  if (opts?.mcpPriority) {
    notes.push("mcp-priority discover: agent sources skipped (catch-up mode)");
    jobs.push(...mcpJobs);
  } else if (opts?.agentPriority) {
    notes.push("agent-priority discover: heavy MCP sources deferred");
    jobs.push(...agentJobs);
    jobs.push(["seed-mcps", async () => SEED_MCPS.filter(isProbeableRaw)]);
  } else {
    notes.push("even-rate discover: agents + MCP sources together");
    jobs.push(...agentJobs, ...mcpJobs);
  }

  jobs.push([
    "harvest",
    async () => {
      const { raws: h, notes: hn } = await runHarvest({
        agentPriority: opts?.agentPriority,
        mcpPriority: opts?.mcpPriority,
      });
      notes.push(...hn.map((n) => `harvest/${n}`));
      return h
        .map((r) => ({
          kind: r.kind,
          name: r.name,
          description: r.description,
          repository: r.repository,
          website: r.website,
          remote_url: r.remote_url,
          endpoint_url: r.endpoint_url,
          agent_card_url: r.agent_card_url,
          author: r.author,
          protocols: r.protocols,
          capabilities: r.capabilities,
          skills: r.skills,
          source: r.source,
          quality_hints: r.quality_hints,
        }))
        .filter(isProbeableRaw);
    },
  ]);

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

  const skipUrls = opts?.skipUrls;
  const seen = new Set<string>();
  const candidates: GrowthCandidate[] = [];
  let skipped = 0;
  let skippedKnown = 0;
  for (const r of raws) {
    if (!isProbeableRaw(r)) {
      skipped++;
      continue;
    }
    if (skipUrls) {
      const urls = [r.remote_url, r.agent_card_url, r.endpoint_url, r.mcp_url]
        .filter(Boolean)
        .map((u) => String(u).toLowerCase().replace(/\/$/, ""));
      if (urls.some((u) => skipUrls.has(u))) {
        skippedKnown++;
        continue;
      }
    }
    const c = toCandidate(r);
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
  }
  if (skipped) notes.push(`skipped-no-url: ${skipped}`);
  if (skippedKnown) notes.push(`skipped-already-clean-url: ${skippedKnown}`);
  // Prefer official remotes first (highest live handshake rate historically)
  candidates.sort((a, b) => {
    const ao = /official-mcp/i.test(a.source) ? 0 : 1;
    const bo = /official-mcp/i.test(b.source) ? 0 : 1;
    return ao - bo || a.name.localeCompare(b.name);
  });
  const max = opts?.max ?? 800;
  const sliced = candidates.slice(0, max);
  const agents = sliced.filter((c) => c.kind === "agent").length;
  const mcps = sliced.filter((c) => c.kind === "mcp").length;
  notes.push(
    `deduped probeable: ${sliced.length} (${agents} agents, ${mcps} mcp)`,
  );
  return { candidates: sliced, notes };
}
