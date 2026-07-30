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
  // Light well-known discovery — only URLs that look like real cards
  const seeds = [
    "https://agoragentic.com/.well-known/agent.json",
    "https://tensorfeed.ai/.well-known/agent.json",
    "https://nexez.ai/.well-known/agent.json",
  ];
  const out: Raw[] = [];
  for (const u of seeds) {
    const j = await fetchJson<{ name?: string; description?: string; url?: string }>(
      u,
    );
    if (!j?.name) continue;
    out.push({
      kind: "agent",
      name: j.name,
      description: j.description || `${j.name} agent card`,
      website: u.replace(/\/\.well-known\/.*$/, ""),
      agent_card_url: u,
      endpoint_url: j.url || u,
      source: "agent-cards",
      quality_hints: ["probeable"],
    });
  }
  return out;
}

async function awesomeAgentsReadme(): Promise<Raw[]> {
  // Avoid bulk name dumps without URLs — return empty (harvest handles real URLs)
  return [];
}

async function officialMcp(): Promise<Raw[]> {
  // Do NOT dump the official MCP registry wholesale — that wasted hundreds of probes.
  // Harvest + well-known crawl supply probeable endpoints only.
  return [];
}

async function awesomeMcp(): Promise<Raw[]> {
  return [];
}

export type DiscoverOpts = {
  agentPriority?: boolean;
  mcpPriority?: boolean;
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

  const seen = new Set<string>();
  const candidates: GrowthCandidate[] = [];
  let skipped = 0;
  for (const r of raws) {
    if (!isProbeableRaw(r)) {
      skipped++;
      continue;
    }
    const c = toCandidate(r);
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
  }
  if (skipped) notes.push(`skipped-no-url: ${skipped}`);
  const agents = candidates.filter((c) => c.kind === "agent").length;
  const mcps = candidates.filter((c) => c.kind === "mcp").length;
  notes.push(
    `deduped probeable: ${candidates.length} (${agents} agents, ${mcps} mcp)`,
  );
  return { candidates, notes };
}
