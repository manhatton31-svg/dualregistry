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
    capabilities: ["multi-agent", "graphs"],
    skills: [{ name: "graph", description: "Stateful agent graphs" }],
    source: "seed:langgraph",
  },
  {
    kind: "agent",
    name: "OpenAI Swarm",
    description:
      "Educational multi-agent orchestration framework exploring lightweight handoffs between specialized agents.",
    repository: "https://github.com/openai/swarm",
    website: "https://github.com/openai/swarm",
    endpoint_url: "https://github.com/openai/swarm",
    author: "openai",
    protocols: ["rest"],
    capabilities: ["multi-agent", "handoffs"],
    skills: [{ name: "swarm", description: "Agent handoffs" }],
    source: "seed:swarm",
  },
  {
    kind: "agent",
    name: "Agoragentic",
    description:
      "Peer-discoverable agent marketplace surface with a public A2A agent card for open registry listing and collaboration.",
    website: "https://agoragentic.com",
    endpoint_url: "https://agoragentic.com",
    agent_card_url: "https://agoragentic.com/.well-known/agent.json",
    author: "agoragentic",
    protocols: ["a2a", "rest"],
    capabilities: ["agents", "discovery"],
    skills: [{ name: "discover", description: "Agent discovery" }],
    source: "seed:agoragentic",
    quality_hints: ["a2a-card", "proto:a2a"],
  },
];

const SEED_MCPS: Raw[] = [
  {
    kind: "mcp",
    name: "GitHub MCP Server",
    description:
      "Official GitHub MCP server exposing repository, issue, PR, and code tools to MCP clients and agent runtimes.",
    repository: "https://github.com/github/github-mcp-server",
    website: "https://github.com/github/github-mcp-server",
    author: "github",
    source: "seed:github-mcp",
    quality_hints: ["official-adjacent"],
  },
  {
    kind: "mcp",
    name: "Firecrawl MCP",
    description:
      "Firecrawl MCP for web scraping, crawling, and structured extraction as agent-callable tools over Model Context Protocol.",
    repository: "https://github.com/mendableai/firecrawl-mcp-server",
    website: "https://github.com/mendableai/firecrawl-mcp-server",
    author: "mendableai",
    source: "seed:firecrawl",
  },
  {
    kind: "mcp",
    name: "Supabase MCP",
    description:
      "Supabase MCP server for database, auth, and storage tooling inside agent workflows and developer assistants.",
    repository: "https://github.com/supabase-community/supabase-mcp",
    website: "https://github.com/supabase-community/supabase-mcp",
    author: "supabase-community",
    source: "seed:supabase-mcp",
  },
];

const AGENT_CARD_SEEDS = [
  "https://agoragentic.com/.well-known/agent.json",
  "https://grok-agent-store.manhatton31.workers.dev/.well-known/agent.json",
];

async function officialMcp(): Promise<Raw[]> {
  const { syncOfficialMirror, mirrorToGrowthRaws } = await import(
    "../official-mirror"
  );
  const { state, notes } = await syncOfficialMirror({ pages: 2, limit: 40 });
  void notes;
  const raws = mirrorToGrowthRaws(state, 80);
  return raws.map((r) => ({
    kind: r.kind,
    name: r.name,
    description: norm(r.description, r.description),
    repository: r.repository,
    website: r.website,
    remote_url: r.remote_url,
    author: r.author,
    source: "official-mcp",
    quality_hints: r.quality_hints,
  }));
}

async function awesomeMcp(): Promise<Raw[]> {
  const text = await fetchText(
    "https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md",
  );
  if (!text) return [];
  const out: Raw[] = [];
  const re =
    /\[([^\]]+)\]\((https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\)\s*[-–—:]?\s*([^\n]*)/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text)) && n < 40) {
    const name = m[1].trim();
    if (name.length < 2 || /awesome|badge|license/i.test(name)) continue;
    out.push({
      kind: "mcp",
      name: name.slice(0, 80),
      description: norm(
        m[3].replace(/<[^>]+>/g, ""),
        `${name} is an MCP server listed in the awesome-mcp-servers catalog for agent tooling.`,
      ),
      repository: m[2],
      website: m[2],
      author: m[2].split("/")[3],
      source: "awesome-mcp",
    });
    n++;
  }
  return out;
}

async function agentCards(): Promise<Raw[]> {
  const out: Raw[] = [];
  for (const url of AGENT_CARD_SEEDS) {
    const card = await fetchJson<Record<string, unknown>>(url);
    if (!card || typeof card !== "object") continue;
    const name =
      typeof card.name === "string"
        ? card.name
        : url.split("/")[2]?.replace(/\./g, "-") || "agent";
    const description =
      typeof card.description === "string"
        ? card.description
        : `${name} agent card for peer discovery.`;
    const endpoint =
      typeof card.url === "string" ? card.url : new URL(url).origin;
    out.push({
      kind: "agent",
      name: name.slice(0, 80),
      description: norm(description, `${name} peer-discoverable agent.`),
      website: endpoint,
      endpoint_url: endpoint,
      agent_card_url: url,
      protocols: Array.isArray(card.protocols)
        ? card.protocols.map(String)
        : ["a2a", "rest"],
      skills: Array.isArray(card.skills)
        ? (card.skills as Array<{ name?: string; description?: string }>)
            .filter((s) => s?.name)
            .map((s) => ({
              name: String(s.name).slice(0, 64),
              description: s.description
                ? String(s.description).slice(0, 200)
                : undefined,
            }))
        : [{ name: "agent", description: "Peer agent surface" }],
      capabilities: ["agents", "discovery"],
      source: "agent-card-seed",
      quality_hints: ["proto:a2a", "a2a-card"],
    });
  }
  return out;
}

async function awesomeAgentsReadme(): Promise<Raw[]> {
  const agentUrls = [
    "https://raw.githubusercontent.com/e2b-dev/awesome-ai-agents/main/README.md",
    "https://raw.githubusercontent.com/kyrolabs/awesome-agents/main/README.md",
  ];
  const out: Raw[] = [];
  for (const u of agentUrls) {
    const text = await fetchText(u);
    if (!text) continue;
    const re =
      /\[([^\]]+)\]\((https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\)\s*[-–—:]?\s*([^\n]*)/g;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(text)) && n < 50) {
      const name = m[1].trim();
      if (name.length < 2 || /awesome|badge|license|stars/i.test(name))
        continue;
      out.push({
        kind: "agent",
        name: name.slice(0, 80),
        description: norm(
          m[3].replace(/<[^>]+>/g, ""),
          `${name} is an open-source AI agent framework or runtime for autonomous and multi-agent workflows.`,
        ),
        repository: m[2],
        website: m[2],
        endpoint_url: m[2],
        author: m[2].split("/")[3],
        protocols: ["rest"],
        capabilities: ["agents"],
        skills: [
          {
            name: "agent",
            description: "Peer-discoverable agent surface from awesome list",
          },
        ],
        source: "awesome-agents",
      });
      n++;
    }
  }
  return out;
}

export type DiscoverOpts = {
  agentPriority?: boolean;
  /** Prefer MCP discovery when MCP registry lags agents */
  mcpPriority?: boolean;
};

export async function discoverCandidates(
  opts?: DiscoverOpts,
): Promise<{ candidates: GrowthCandidate[]; notes: string[] }> {
  const notes: string[] = [];
  const raws: Raw[] = [];
  const agentJobs: Array<[string, () => Promise<Raw[]>]> = [
    ["seed-agents", async () => SEED_AGENTS],
    ["agent-cards", agentCards],
    ["awesome-agents", awesomeAgentsReadme],
  ];
  const mcpJobs: Array<[string, () => Promise<Raw[]>]> = [
    ["seed-mcps", async () => SEED_MCPS],
    ["official-mcp", officialMcp],
    ["awesome-mcp", awesomeMcp],
  ];
  const jobs: Array<[string, () => Promise<Raw[]>]> = [];
  if (opts?.mcpPriority) {
    notes.push("mcp-priority discover: agent sources skipped (catch-up mode)");
    jobs.push(...mcpJobs);
    // No seed-agents / agent harvest while MCPs lag — prevents agent re-runs
  } else if (opts?.agentPriority) {
    notes.push("agent-priority discover: heavy MCP sources deferred");
    jobs.push(...agentJobs);
    jobs.push(["seed-mcps", async () => SEED_MCPS]);
    jobs.push([
      "official-mcp-light",
      async () => {
        const all = await officialMcp();
        return all.slice(0, 15);
      },
    ]);
  } else {
    notes.push("even-rate discover: agents + MCP sources together");
    jobs.push(...agentJobs, ...mcpJobs);
  }

  // High-signal harvest (topics, npm, well-known crawl, server.json)
  jobs.push([
    "harvest",
    async () => {
      const { raws: h, notes: hn } = await runHarvest({
        agentPriority: opts?.agentPriority,
        mcpPriority: opts?.mcpPriority,
      });
      notes.push(...hn.map((n) => `harvest/${n}`));
      return h.map((r) => ({
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
      }));
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
  const seen = new Set<string>();
  const candidates: GrowthCandidate[] = [];
  for (const r of raws) {
    const c = toCandidate(r);
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
  }
  const agents = candidates.filter((c) => c.kind === "agent").length;
  const mcps = candidates.filter((c) => c.kind === "mcp").length;
  notes.push(`deduped: ${candidates.length} (${agents} agents, ${mcps} mcp)`);
  return { candidates, notes };
}
