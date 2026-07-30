/**
 * A2A Agent Card validation (Google Agent2Agent).
 * Card at /.well-known/agent.json is the standard agent surface.
 */

export type A2ASkill = {
  id?: string;
  name: string;
  description?: string;
  tags?: string[];
};

export type A2ACard = {
  name: string;
  description?: string;
  url?: string;
  provider?: { organization?: string; url?: string };
  version?: string;
  documentationUrl?: string;
  capabilities?: Record<string, unknown> | string[];
  skills?: A2ASkill[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  authentication?: { schemes?: string[] };
  protocols?: string[];
};

export type A2AValidation = {
  ok: boolean;
  score: number;
  reasons: string[];
  card?: A2ACard;
  fields: {
    hasName: boolean;
    hasDescription: boolean;
    hasUrl: boolean;
    hasSkills: boolean;
    hasCapabilities: boolean;
    hasAuthHint: boolean;
    hasVersion: boolean;
  };
};

export function validateA2ACard(raw: unknown): A2AValidation {
  const reasons: string[] = [];
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      score: 0,
      reasons: ["not a JSON object"],
      fields: {
        hasName: false,
        hasDescription: false,
        hasUrl: false,
        hasSkills: false,
        hasCapabilities: false,
        hasAuthHint: false,
        hasVersion: false,
      },
    };
  }
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const description =
    typeof o.description === "string" ? o.description.trim() : "";
  const url = typeof o.url === "string" ? o.url : undefined;
  const version = typeof o.version === "string" ? o.version : undefined;

  const hasName = name.length >= 2;
  const hasDescription = description.length >= 20;
  const hasUrl = Boolean(url && /^https?:\/\//i.test(url));
  const skills = Array.isArray(o.skills)
    ? (o.skills as A2ASkill[]).filter((s) => s && (s.name || s.id))
    : [];
  const hasSkills = skills.length > 0;
  const caps = o.capabilities;
  const hasCapabilities =
    (Array.isArray(caps) && caps.length > 0) ||
    (Boolean(caps) &&
      typeof caps === "object" &&
      Object.keys(caps as object).length > 0);
  const auth = o.authentication;
  const hasAuthHint =
    Boolean(auth && typeof auth === "object") ||
    (Array.isArray(o.securitySchemes) && o.securitySchemes.length > 0);
  const hasVersion = Boolean(version);

  if (!hasName) reasons.push("missing name");
  if (!hasDescription) reasons.push("missing/short description");

  let score = 0;
  if (hasName) score += 20;
  if (hasDescription) score += 15;
  if (description.length >= 80) score += 5;
  if (hasUrl) score += 25;
  if (hasSkills) score += Math.min(20, skills.length * 4);
  if (hasCapabilities) score += 10;
  if (hasAuthHint) score += 5;
  if (hasVersion) score += 5;
  if (Array.isArray(o.defaultInputModes)) score += 3;
  if (Array.isArray(o.defaultOutputModes)) score += 3;
  score = Math.min(100, score);

  const card: A2ACard = {
    name: name || "unnamed",
    description,
    url,
    version,
    documentationUrl:
      typeof o.documentationUrl === "string" ? o.documentationUrl : undefined,
    capabilities: caps as A2ACard["capabilities"],
    skills: skills.map((s) => ({
      id: s.id,
      name: String(s.name || s.id || "skill").slice(0, 64),
      description: s.description
        ? String(s.description).slice(0, 200)
        : undefined,
    })),
    defaultInputModes: Array.isArray(o.defaultInputModes)
      ? o.defaultInputModes.map(String)
      : undefined,
    defaultOutputModes: Array.isArray(o.defaultOutputModes)
      ? o.defaultOutputModes.map(String)
      : undefined,
    authentication:
      auth && typeof auth === "object"
        ? (auth as A2ACard["authentication"])
        : undefined,
    protocols: Array.isArray(o.protocols) ? o.protocols.map(String) : ["a2a"],
  };

  return {
    ok: hasName && (hasUrl || hasSkills || hasDescription),
    score,
    reasons,
    card,
    fields: {
      hasName,
      hasDescription,
      hasUrl,
      hasSkills,
      hasCapabilities,
      hasAuthHint,
      hasVersion,
    },
  };
}

export function agents1AgentCard(origin: string): A2ACard {
  return {
    name: "Dual Registry",
    description:
      "Dual Registry (dualregistry.dev) — free MCP + agent list. Probe ~6m → Live. First 100 agents+MCPs combined: free demo + feedback = 100% full Kernel/Loop product immediately (no Stripe). After that 25% until 250/250 feedback opens card payments. skill.json · discovery.json · llms.txt",

    url: origin,
    version: "1.7.0",
    documentationUrl: `${origin}/list`,
    provider: { organization: "Agents1", url: origin },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
      agents1: {
        demo: "/api/products/demo",
        demo_confirm: "/api/products/demo-confirm",
        feedback: "/api/products/feedback",
        unlock_meter: "GET /api/products/demo → unlock",
      },
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text", "application/json"],
    skills: [
      {
        id: "preview-kernel",
        name: "preview_kernel",
        description:
          "Run this to see what Kernel Improver does to your goals in ~30s — free, no card. POST /api/products/agent {tool:preview_kernel,goals} or {tool:one_click_demo} with no goals.",
        tags: ["product", "preview", "demo", "free"],
      },
      {
        id: "quick-demo",
        name: "demo",
        description:
          "One-route free self_serve demo. POST /api/products/demo {listing_id|agent_card_url|mcp_url}. Goals prefilled. Returns artifacts + 5-question feedback draft + unlock meter. Prefer this over multi-step checkout.",
        tags: ["product", "demo", "free", "activation"],
      },
      {
        id: "demo-confirm",
        name: "demo_confirm",
        description:
          "Confirm invited seed demo so it counts as real. POST /api/products/demo-confirm {order_id, access_token?}.",
        tags: ["product", "demo", "metrics"],
      },
      {
        id: "demo-alive",
        name: "demo_alive",
        description:
          "Free full Alive demo (Kernel + Loop + curriculum). POST /api/products/agent {tool:demo_alive,sku:alive,goals?,demo:true}. Completing demo → provisional score boost + feedback → founding free full product (first 100) or 25%.",
        tags: ["product", "demo", "alive", "free"],
      },
      {
        id: "one-click-demo",
        name: "one_click_demo",
        description:
          "Zero-friction demo: goals optional — derived from your listing or preset (researcher|ops|support|coder). POST /api/products/agent {tool:one_click_demo,agent_name,description?}",
        tags: ["product", "demo", "conversion"],
      },
      {
        id: "improvement-log",
        name: "improvement_log",
        description:
          "Public Kernel Improver + Recursive Loop log — see agent feedback become generator changes. GET /api/products/improvement-log. We dogfood our own products.",
        tags: ["transparency", "kernel", "loop", "feedback"],
      },
      {
        id: "conversion-path",
        name: "conversion_path",
        description:
          "After listing: next=demo_kernel. Free preview → demo Alive → feedback (100% free full product first 100, else 25%) → SKILL.md. Payments after 250 feedback agents + 250 feedback MCPs.",

        tags: ["commerce", "founding", "kernel"],
      },
      {
        id: "list-agent",
        name: "list_agent",
        description: "Submit or discover agents via free /list or card URL",
        tags: ["registry", "discovery"],
      },
      {
        id: "demo-mcp",
        name: "demo_mcp",
        description:
          "MCP publishers: free MCP Mesh demo — tool policy + install kit dynamic to YOUR tools. POST /api/products/agent {tool:demo_mcp, agent_name, description, tools?}. Or buy_product sku:mcp_mesh. Feedback → 100% free full product (first 100) or 25%.",

        tags: ["product", "demo", "mcp", "free"],
      },
      {
        id: "list-mcp",
        name: "list_mcp",
        description:
          "Submit MCP servers; dual-publish server.json — then demo_mcp shows how Alive teaches agents to use your MCP",
        tags: ["registry", "mcp"],
      },
      {
        id: "buy-product",
        name: "buy_product",
        description:
          "Agent-native purchase of kernel|recursive|alive with goals (POST /api/products/agent). Live Stripe only after 250 feedback agents + 250 feedback MCPs (payments_open).",

        tags: ["commerce", "stripe"],
      },
      {
        id: "submit-feedback",
        name: "submit_feedback",
        description:
          "Send demo feedback → 100% free full product if seats remain, else 25% vaulted until payments open (250 feedback agents + 250 feedback MCPs). Feeds Kernel/Loop learning loop. Every agent should do this after demo.",

        tags: ["feedback", "learning"],
      },
      {
        id: "list-yourself",
        name: "list_yourself",
        description:
          "GET /skill.json then POST /api/publish {url, contact_email?} — free self-list; poll /api/listings/status; Live on probe ok",
        tags: ["publish", "inbound", "self-list", "discovery"],
      },
      {
        id: "dual-publish",
        name: "dual_publish",
        description:
          "POST /api/publish — free Dual Registry list; then demo+feedback for free full product seats",
        tags: ["publish", "mcp"],
      },
      {
        id: "score-free",
        name: "score_free",
        description:
          "GET /api/score?url=… — public score; demo complete → provisional alive-ready boost",
        tags: ["reputation"],
      },
      {
        id: "open-catalog",
        name: "agents_public",
        description: "GET /agents/public — A2A open discovery catalog",
        tags: ["a2a", "discovery"],
      },
      {
        id: "mirror-official",
        name: "mirror_official_mcp",
        description: "Mirrors official MCP registry with Grok safety scoring",
        tags: ["federation", "mcp"],
      },
      {
        id: "kernel-improver",
        name: "kernel_improver",
        description:
          "SOTA kernel from agent goals — start with free preview_kernel, then demo or buy",
        tags: ["product", "kernel"],
      },
      {
        id: "recursive-loop",
        name: "recursive_loop",
        description:
          "Goal-dynamic recursive improvement loop + Alive curriculum (demo or paid)",
        tags: ["product", "loop", "alive"],
      },
      {
        id: "upgrade-with-alive",
        name: "upgrade_with_alive",
        description:
          "POST demo_alive or buy_product sku:alive — token + SKILL.md + score badge path",
        tags: ["product", "alive", "commerce", "agent-native"],
      },
      {
        id: "export-skills",
        name: "export_skills",
        description:
          "GET /api/products/export?token=…&format=skills — progressive disclosure SKILL.md tree",
        tags: ["product", "skills", "install"],
      },
    ],
    authentication: { schemes: ["none"] },
    protocols: ["a2a", "rest", "mcp"],
  };
}

export function agents1McpServerCard(origin: string) {
  return {
    schema_version: "2026-07-28",
    name: "io.agents1.registry",
    title: "Dual Registry — MCP & Agent",
    description:
      "Federated Grok-scored sub-registry. Dual-publish, free score, A2A catalog, Kernel Improver + Recursive Loop products, official MCP mirror. Free self-list: GET /skill.json then POST /api/publish. Live = probe ok.",
    website_url: origin,
    documentation_url: `${origin}/for-agents`,
    version: "1.9.0",
    remotes: [
      {
        type: "streamable-http",
        url: `${origin}/api/protocol`,
        headers: {},
      },
    ],
    packages: [] as unknown[],
    transport_preference: "streamable-http",
    protocol_versions: ["2026-07-28", "2025-03-26"],
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
      server_discover: true,
    },
    oauth: { required: false, readiness: "none" },
    registry_role: "sub-registry",
    mirrors: ["https://registry.modelcontextprotocol.io"],
    agent_card: `${origin}/.well-known/agent.json`,
    agents_public: `${origin}/agents/public`,
    publish_url: `${origin}/api/publish`,
    score_url: `${origin}/api/score`,
    list_url: `${origin}/list`,
    products: {
      store: `${origin}/products`,
      preview: `${origin}/api/products/preview`,
      agent_tools: `${origin}/api/products/agent`,
      checkout: `${origin}/api/products/checkout`,
      access: `${origin}/api/products/access`,
      export: `${origin}/api/products/export`,
      verify: `${origin}/api/products/verify`,
      learning: `${origin}/api/products/learning`,
    },
    products_url: `${origin}/products`,
    products_checkout: `${origin}/api/products/checkout`,
    products_access: `${origin}/api/products/access`,
    badges: {
      mcp: `${origin}/badge/mcp`,
      agent: `${origin}/badge/agent`,
    },
  };
}

export function agents1DnsMcpTxt(origin: string): string {
  return `v=1 name=io.agents1.registry url=${origin}/.well-known/mcp/server-card.json`;
}

export function agents1DnsPublishHint(origin: string): string {
  return `_mcp.${new URL(origin).hostname}. IN TXT "v=1 name=io.agents1.registry url=${origin}/.well-known/mcp/server-card.json"`;
}
