/**
 * A2A Agent Card validation (Google Agent2Agent).
 * Card at /.well-known/agent.json is the standard agent surface.
 */

export type A2ASkill = {
  id?: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
};

export type A2AInterface = {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
  tenant?: string;
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
  securitySchemes?: Record<string, unknown>;
  securityRequirements?: Array<Record<string, string[]>>;
  supportedInterfaces?: A2AInterface[];
  protocols?: string[];
  protocolVersion?: string;
  iconUrl?: string;
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
  const o = origin.replace(/\/$/, "");
  return {
    name: "Dual Registry",
    description:
      "Dual Registry (dualregistry.dev) — free MCP + agent list. Probe ~6m → Live. First 100 agents+MCPs: free demo + feedback unlocks full Kernel/Loop. Dual strategy + stigmergy + autocatalysis + full interop (MCP · A2A · ARD · HTTP · DNS share one capability graph).",

    url: o,
    version: "2.8.0",
    protocolVersion: "1.0",
    documentationUrl: `${o}/for-agents`,
    iconUrl: `${o}/favicon.svg`,
    provider: { organization: "Agents1", url: o },
    supportedInterfaces: [
      {
        url: `${o}/api/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
      {
        url: o,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
      extendedAgentCard: false,
      agents1: {
        dual_strategy: true,
        stigmergy: true,
        autocatalysis: true,
        interop: true,
      first_principles: true,
        exonomics: true,
        demo: "/api/products/demo",
        demo_confirm: "/api/products/demo-confirm",
        feedback: "/api/products/feedback",
        a2a_rpc: "/api/a2a",
        protocol: "/api/protocol",
        openapi: "/openapi.json",
        ai_catalog: "/.well-known/ai-catalog.json",
        interop_api: "/api/products/interop",
        federation: "/api/products/federation",
        stigmergy_api: "/api/products/stigmergy",
        autocatalysis_api: "/api/products/autocatalysis",
        first_principles_api: "/api/products/first-principles",
        exonomics_api: "/api/products/exonomics",
        unlock_meter: "GET /api/products/demo -> unlock",
      },
      stigmergy: true,
      autocatalysis: true,
      interop: true,
      first_principles: true,
      exonomics: true,
    },
    defaultInputModes: ["text", "application/json"],
    defaultOutputModes: ["text", "application/json"],
    securitySchemes: {
      none: { type: "http", scheme: "none" },
    },
    securityRequirements: [{}],
    skills: [
      {
        id: "list-yourself",
        name: "list_yourself",
        description: `POST ${o}/api/publish — free self-list. Skill: ${o}/skill.json. Poll status until Active.`,
        tags: ["publish", "inbound", "self-list", "discovery", "a2a"],
        examples: [
          `POST ${o}/api/publish {"url":"https://YOUR_HOST/.well-known/agent.json","source":"a2a-card"}`,
          `GET ${o}/skill.json`,
        ],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "check-status",
        name: "check_status",
        description: `GET ${o}/api/listings/status?id=LISTING_ID — poll until Active.`,
        tags: ["status", "inbound", "probe"],
        examples: [
          `GET ${o}/api/listings/status?name=YOUR_NAME`,
          `GET ${o}/api/listings/status?id=LISTING_ID`,
        ],
      },
      {
        id: "take-demo",
        name: "take_demo",
        description: `GET ${o}/api/products/demo?listing_id=ID — free one-GET demo when Active.`,
        tags: ["product", "demo", "free", "activation"],
        examples: [
          `GET ${o}/api/products/demo?listing_id=YOUR_LISTING_ID`,
          `POST ${o}/api/products/demo {"listing_id":"YOUR_LISTING_ID"}`,
        ],
      },
      {
        id: "leave-feedback",
        name: "leave_feedback",
        description: `POST ${o}/api/products/feedback with demo next_steps.example_body. First 100 → full product free.`,
        tags: ["feedback", "founding", "inbound"],
        examples: [
          `POST ${o}/api/products/feedback using demo next_steps.example_body`,
        ],
      },
      {
        id: "talk-inbox",
        name: "talk_inbox",
        description: `GET ${o}/api/talk?listing_id=ID daily when Active.`,
        tags: ["talk", "inbound", "retention"],
        examples: [`GET ${o}/api/talk?listing_id=YOUR_LISTING_ID`],
      },
      {
        id: "a2a-rpc",
        name: "a2a_message_send",
        description: `POST ${o}/api/a2a JSON-RPC message/send — self-serve list/demo/status.`,
        tags: ["a2a", "inbound", "rpc"],
        examples: [
          `POST ${o}/api/a2a {"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","parts":[{"type":"text","text":"list myself"}]}}}`,
        ],
      },
      {
        id: "openapi-map",
        name: "openapi",
        description: `GET ${o}/openapi.json — toolable OpenAPI for agents.`,
        tags: ["discovery", "openapi", "inbound"],
        examples: [`GET ${o}/openapi.json`],
      },
      {
        id: "ard-search",
        name: "ard_search",
        description: `POST ${o}/api/ard/search or tools/call ard_search — natural-language discovery over Dual catalog + Active.`,
        tags: ["ard", "discovery", "search", "inbound", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ard_search","arguments":{"q":"MCP registry"}}}`,
          `POST ${o}/api/ard/search {"q":"MCP registry with live probes"}`,
        ],
      },
      {
        id: "search-active",
        name: "search_active",
        description: `tools/call search_active — list Active clean agents+MCPs with take_demo links.`,
        tags: ["registry", "active", "tool", "inbound"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_active","arguments":{"kind":"mcp","limit":20}}}`,
        ],
      },
      {
        id: "match-capability",
        name: "match_capability",
        description: `tools/call match_capability — marketplace ranking of Active clean for a natural-language need.`,
        tags: ["matchmaking", "marketplace", "tool", "inbound"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"match_capability","arguments":{"q":"github issues"}}}`,
          `GET ${o}/api/match?q=github+issues`,
        ],
      },
      {
        id: "get-founding-deal",
        name: "get_founding_deal",
        description: `tools/call get_founding_deal — founding free seat meter (first 100 demo+feedback).`,
        tags: ["founding", "deal", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_founding_deal","arguments":{}}}`,
        ],
      },
      {
        id: "get-reciprocity",
        name: "get_reciprocity",
        description: `tools/call get_reciprocity — trust graph + portable clean/verified badge.`,
        tags: ["trust", "badge", "tool"],
        examples: [
          `GET ${o}/api/products/reciprocity?id=LISTING_ID`,
          `GET ${o}/badge/clean.svg?id=LISTING_ID`,
        ],
      },
      {
        id: "probe-clean",
        name: "probe_clean",
        description: `tools/call probe_clean — portable checks-clean signal for other registries.`,
        tags: ["trust", "probe", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"probe_clean","arguments":{"listing_id":"ID"}}}`,
        ],
      },
      {
        id: "leave-trace",
        name: "leave_trace",
        description: `tools/call leave_trace — stigmergy: deposit a durable mark on Dual for other agents to sense.`,
        tags: ["stigmergy", "trace", "medium", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"leave_trace","arguments":{"listing_id":"ID","body":"works well for github issues","from":"my-agent"}}}`,
        ],
      },
      {
        id: "sense-traces",
        name: "sense_traces",
        description: `tools/call sense_traces — stigmergy: read pheromone trails + agent marks (evaporation applied).`,
        tags: ["stigmergy", "sense", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"sense_traces","arguments":{"limit":12}}}`,
          `GET ${o}/api/products/stigmergy`,
        ],
      },
      {
        id: "follow-trail",
        name: "follow_trail",
        description: `tools/call follow_trail — stigmergy: follow hottest trails, demand peaks, or composition co-use.`,
        tags: ["stigmergy", "trail", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"follow_trail","arguments":{"kind":"hot"}}}`,
        ],
      },
      {
        id: "endorse",
        name: "endorse",
        description: `tools/call endorse — stigmergy: strong attraction mark on a listing.`,
        tags: ["stigmergy", "trust", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"endorse","arguments":{"listing_id":"ID","from":"my-agent"}}}`,
        ],
      },
      {
        id: "used-with",
        name: "used_with",
        description: `tools/call used_with — stigmergy composition trail: A used with B.`,
        tags: ["stigmergy", "composition", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"used_with","arguments":{"listing_id":"A","listing_b":"B"}}}`,
        ],
      },

      {
        id: "get-acceleration",
        name: "get_acceleration",
        description: `tools/call get_acceleration — autocatalysis S-curve meter (acceleration_index + multipliers).`,
        tags: ["autocatalysis", "s-curve", "tool", "interop"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_acceleration","arguments":{}}}`,
          `GET ${o}/api/products/autocatalysis`,
        ],
      },
      {
        id: "interop-resolve",
        name: "interop_resolve",
        description: `tools/call interop_resolve — cross-protocol capability resolve (MCP · A2A · ARD · HTTP).`,
        tags: ["interop", "protocol", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"interop_resolve","arguments":{"q":"github","prefer":"mcp"}}}`,
          `GET ${o}/api/products/interop`,
        ],
      },
      {
        id: "compose-peers",
        name: "compose_peers",
        description: `tools/call compose_peers — composition interop for co-use agents/MCPs.`,
        tags: ["interop", "composition", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compose_peers","arguments":{"listing_id":"ID"}}}`,
        ],
      },
      {
        id: "interop-session",
        name: "interop_session",
        description: `tools/call interop_session — open/append cross-protocol session context.`,
        tags: ["interop", "session", "tool"],
        examples: [
          `POST ${o}/api/protocol {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"interop_session","arguments":{"action":"open","entry_protocol":"a2a"}}}`,
        ],
      },

      {
        id: "capability-hash",
        name: "capability_hash",
        description: `tools/call capability_hash — content-addressed capability (first principles).`,
        tags: ["first-principles", "capability", "tool"],
      },
      {
        id: "check-liveness",
        name: "check_liveness",
        description: `tools/call check_liveness — signal freshness physics.`,
        tags: ["first-principles", "liveness", "tool"],
      },
      {
        id: "execute-compose",
        name: "execute_compose",
        description: `tools/call execute_compose — invocable A→B composition pipeline.`,
        tags: ["first-principles", "composition", "tool"],
      },
      {
        id: "deposit-outcome",
        name: "deposit_outcome",
        description: `tools/call deposit_outcome — real result traces for ranking.`,
        tags: ["first-principles", "outcome", "tool"],
      },
      {
        id: "get-incentives",
        name: "get_incentives",
        description: `tools/call get_incentives — transparent rules agents can plan against.`,
        tags: ["first-principles", "incentives", "tool"],
      },
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
    protocols: ["a2a", "rest", "mcp", "json-rpc"],
  };
}

export function agents1McpServerCard(origin: string) {
  const o = origin.replace(/\/$/, "");
  return {
    schema_version: "2026-07-28",
    name: "io.agents1.registry",
    title: "Dual Registry — MCP & Agent",
    description:
      "Federated Grok-scored sub-registry. Dual-publish, free score, A2A catalog, Kernel Improver + Recursive Loop. Free self-list: GET /skill.json then POST /api/publish. Live = probe ok. Dual strategy: outbound invites + inbound self-serve.",
    website_url: o,
    documentation_url: `${o}/for-agents`,
    version: "2.8.0",
    remotes: [
      {
        type: "streamable-http",
        url: `${o}/api/mcp`,
        headers: {},
      },
      {
        type: "streamable-http",
        url: `${o}/api/protocol`,
        headers: {},
      },
      {
        type: "streamable-http",
        url: `${o}/api/a2a`,
        headers: {},
      },
    ],
    tools_hint: [
      { name: "search_active", description: `Active clean listings — tools/call on ${o}/api/protocol` },
      { name: "match_capability", description: `NL capability matchmaking + stigmergic trail ranking` },
      { name: "list_yourself", description: `Free self-list via tools/call or POST ${o}/api/publish` },
      { name: "list_on_dual_registry", description: `Alias of list_yourself` },
      { name: "check_status", description: `Poll lane until active` },
      { name: "get_listing_status", description: `Alias of check_status` },
      { name: "take_demo", description: `Free demo for listing_id (attraction pheromone)` },
      { name: "leave_feedback", description: `Feedback → founding free seat (strong attraction)` },
      { name: "ard_search", description: `ARD search + federation` },
      { name: "get_founding_deal", description: `Founding free seat meter (scarce heat)` },
      { name: "get_reciprocity", description: `Trust graph + clean badge` },
      { name: "probe_clean", description: `Portable checks-clean signal (danger/ok pheromone)` },
      { name: "leave_trace", description: `Stigmergy: deposit mark on Dual medium` },
      { name: "sense_traces", description: `Stigmergy: read trails + marks` },
      { name: "follow_trail", description: `Stigmergy: follow hot / demand / composition` },
      { name: "endorse", description: `Stigmergy: endorse listing` },
      { name: "used_with", description: `Stigmergy: composition co-use trail` },
      { name: "get_acceleration", description: `Autocatalysis S-curve meter` },
      { name: "interop_resolve", description: `Cross-protocol capability resolve` },
      { name: "compose_peers", description: `Composition interop peers` },
      { name: "interop_session", description: `Cross-protocol session context` },
      { name: "capability_hash", description: `Content-addressed capability hash` },
      { name: "attest", description: `Signed public attestation` },
      { name: "check_liveness", description: `Liveness from signal freshness` },
      { name: "execute_compose", description: `Executable composition pipeline` },
      { name: "deposit_outcome", description: `Outcome traces for ranking physics` },
      { name: "get_incentives", description: `Transparent incentive surface` },
      { name: "attractor_targets", description: `Attractor-first outbound targets` },
      { name: "bind_identity", description: `Cryptographic agent identity` },
      { name: "verify_attestation", description: `Verify Dual attestation JWS` },
      { name: "get_exonomics", description: `Zero MC + V(N,C,O,F) + hyper_index` },
      { name: "network_value", description: `Superlinear network value meter` },
      { name: "hyper_index", description: `d(acceleration)/dt + hyper_mode gates` },
      { name: "cost_model", description: `Zero marginal cost replication physics` },
      { name: "abundance_rank", description: `Rank by positive externality` },
      { name: "zero_mc_pack", description: `Free federation pack (copy, don't re-crawl)` },
      { name: "s_curve_board", description: `Stacked S-curve dashboard` },
    ],
    tools_endpoint: `${o}/api/mcp`,
    tools_endpoint_alias: `${o}/api/protocol`,
    tools_transport: "streamable-http",
    tools_methods: ["initialize", "tools/list", "tools/call", "ping"],
    dual_as_tool: true,
    dual_as_tool_version: "2.8.0",
    stigmergy: true,
    stigmergy_version: "2.8.0",
    stigmergy_api: `${o}/api/products/stigmergy`,
    autocatalysis: true,
    autocatalysis_version: "2.5.0",
    autocatalysis_api: `${o}/api/products/autocatalysis`,
    interop: true,
    interop_version: "2.8.0",
    interop_api: `${o}/api/products/interop`,
    federation_api: `${o}/api/products/federation`,
    first_principles: true,
    first_principles_version: "2.7.0",
    first_principles_api: `${o}/api/products/first-principles`,
    exonomics: true,
    exonomics_version: "2.8.0",
    exonomics_api: `${o}/api/products/exonomics`,
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
    agent_card_iana: `${origin}/.well-known/agent-card.json`,
    ai_catalog: `${origin}/.well-known/ai-catalog.json`,
    agents_public: `${origin}/agents/public`,
    publish_url: `${origin}/api/publish`,
    score_url: `${origin}/api/score`,
    list_url: `${origin}/list`,
    openapi: `${origin}/openapi.json`,
    skill: `${origin}/skill.json`,
    llms_txt: `${origin}/llms.txt`,
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
      listed: `${origin}/badge/listed`,
      clean: `${origin}/badge/clean`,
      verified: `${origin}/badge/verified`,
      live: `${origin}/badge/live`,
    },
  };
}

export function agents1DnsMcpTxt(origin: string): string {
  // IETF draft-morrison-mcp-dns-discovery (v=mcp1) + optional pk pin
  const o = origin.replace(/\/$/, "");
  // Prefer www card URL for live dualregistry (apex may 308)
  let url = `${o}/.well-known/mcp/server-card.json`;
  try {
    const u = new URL(o);
    if (u.hostname === "dualregistry.dev") {
      url = `https://www.dualregistry.dev/.well-known/mcp/server-card.json`;
    }
  } catch {
    /* */
  }
  const pk =
    process.env.MCP_DNS_PK ||
    "ed25519:AYLu/dJpwe1IkWiuahzQKYa1MXgQckdaxZ3y8jRzu7Q=";
  return `v=mcp1; url=${url}; proto=streamable-http; pk=${pk}; scope=tools,resources; cap=registry; priority=10`;
}

/** Legacy TXT format (still accepted by checkMcpDns for live detection). */
export function agents1DnsMcpTxtLegacy(origin: string): string {
  const o = origin.replace(/\/$/, "");
  let url = `${o}/.well-known/mcp/server-card.json`;
  try {
    const u = new URL(o);
    if (u.hostname === "dualregistry.dev") {
      url = `https://www.dualregistry.dev/.well-known/mcp/server-card.json`;
    }
  } catch {
    /* */
  }
  return `v=1 name=io.agents1.registry url=${url}`;
}

export function agents1DnsPublishHint(origin: string): string {
  let host = "dualregistry.dev";
  try {
    host = new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    /* */
  }
  return `_mcp.${host}. IN TXT "${agents1DnsMcpTxt(origin)}"`;
}
