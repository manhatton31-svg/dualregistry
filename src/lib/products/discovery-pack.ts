/**
 * Full discovery pack — every outbound nudge + inbound surface shares the same URLs.
 * Dual-loop: outbound deposits inbound breadcrumbs; inbound points at self-serve funnel.
 */
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";
import {
  agents1DnsMcpTxt,
  agents1DnsPublishHint,
} from "@/lib/agents1/a2a-card";

export function discoveryPack(origin?: string, listingId?: string | null) {
  const o = (origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  const id = (listingId || "").trim();
  return {
    origin: o,
    dual_strategy: true,
    version: "2.2.0",
    llms_txt: `${o}/llms.txt`,
    llms_full: `${o}/llms-full.txt`,
    ai_txt: `${o}/ai.txt`,
    discovery_json: `${o}/discovery.json`,
    skill_json: `${o}/skill.json`,
    skill_md: `${o}/skills/dualregistry.md`,
    openapi: `${o}/openapi.json`,
    agent_card: `${o}/.well-known/agent.json`,
    agent_card_iana: `${o}/.well-known/agent-card.json`,
    ai_catalog: `${o}/.well-known/ai-catalog.json`,
    agent_descriptions: `${o}/.well-known/agent-descriptions`,
    mcp_server_card: `${o}/.well-known/mcp/server-card.json`,
    mcp_server_card_alt: `${o}/.well-known/mcp/server-card`,
    a2a_rpc: `${o}/api/a2a`,
    ard_search: `${o}/api/ard/search`,
    activity_feed: `${o}/api/feed`,
    well_known_agents: `${o}/.well-known/agents`,
    for_agents: `${o}/for-agents`,
    list_web: `${o}/list`,
    publish: `${o}/api/publish`,
    status: id
      ? `${o}/api/listings/status?id=${encodeURIComponent(id)}`
      : `${o}/api/listings/status`,
    active: `${o}/api/listings/active`,
    demo_get: id
      ? `${o}/api/products/demo?listing_id=${encodeURIComponent(id)}`
      : `${o}/api/products/demo`,
    demo_post: `${o}/api/products/demo`,
    feedback: `${o}/api/products/feedback`,
    talk: id
      ? `${o}/api/talk?listing_id=${encodeURIComponent(id)}`
      : `${o}/api/talk?feed=1`,
    dual_strategy_api: `${o}/api/products/dual-strategy`,
    dns_mcp_txt: agents1DnsMcpTxt(o),
    dns_record_hint: agents1DnsPublishHint(o),
    mcp_registry_auth: `${o}/.well-known/mcp-registry-auth`,
    mcp_registry_package: `${o}/api/mcp-registry/server.json`,
    official_mcp_registry:
      "https://registry.modelcontextprotocol.io/v0/servers?search=dualregistry",
    agentmap: `${o}/agentmap.json`,
    jwks: `${o}/.well-known/jwks.json`,
    signature_agent_card: `${o}/.well-known/signature-agent-card.json`,
    http_message_signatures_directory: `${o}/.well-known/http-message-signatures-directory`,
    agentfinder: `${o}/api/products/agentfinder`,
    reply_capture: `${o}/api/products/reply-capture`,
    robots_agent: `${o}/robots-agent.txt`,
    protocol: `${o}/api/protocol`,
    score: `${o}/api/score`,
    self_serve_steps: [
      `GET ${o}/skill.json`,
      `POST ${o}/api/publish {"url":"https://YOUR_HOST/.well-known/agent.json"}`,
      `GET ${o}/api/listings/status?name=YOUR_NAME until lane=active`,
      id
        ? `GET ${o}/api/products/demo?listing_id=${encodeURIComponent(id)}`
        : `GET ${o}/api/products/demo?listing_id=YOUR_ID`,
      `POST ${o}/api/products/feedback`,
    ],
  };
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return "dualregistry.dev";
  }
}

/** RFC 8288 Link header values (ASCII only) for discovery pack. */
export function discoveryLinkHeader(
  origin?: string,
  listingId?: string | null,
): string {
  const p = discoveryPack(origin, listingId);
  return [
    `<${p.demo_get}>; rel="https://dualregistry.dev/rel/demo"; title="Free demo GET"`,
    `<${p.skill_json}>; rel="https://dualregistry.dev/rel/skill"; title="skill.json"`,
    `<${p.agent_card_iana}>; rel="agent-card"; title="A2A agent-card.json"`,
    `<${p.agent_card}>; rel="alternate"; type="application/json"; title="A2A agent.json"`,
    `<${p.ai_catalog}>; rel="ai-catalog"; title="ARD ai-catalog.json"`,
    `<${p.mcp_server_card}>; rel="mcp-server-card"; title="MCP server card"`,
    `<${p.openapi}>; rel="describedby"; type="application/json"; title="OpenAPI"`,
    `<${p.discovery_json}>; rel="index"; type="application/json"; title="discovery.json"`,
    `<${p.llms_txt}>; rel="describedby"; type="text/plain"; title="llms.txt"`,
    `<${p.ard_search}>; rel="https://dualregistry.dev/rel/ard-search"; title="ARD search"`,
    `<${p.active}>; rel="https://dualregistry.dev/rel/active"; title="Active clean list"`,
    `<${p.talk}>; rel="https://dualregistry.dev/rel/talk-inbox"; title="Talk inbox"`,
    `<${p.jwks}>; rel="jwks"; title="Agent card JWKS"`,
    `<${p.signature_agent_card}>; rel="https://dualregistry.dev/rel/signature-agent-card"; title="Web Bot Auth Signature Agent Card"`,
    `<${p.http_message_signatures_directory}>; rel="http-message-signatures-directory"; title="Signature directory"`,
    `<${p.agentfinder}>; rel="https://dualregistry.dev/rel/agentfinder"; title="Agent Finder point-at Dual"`,
    `<${p.reply_capture}>; rel="https://dualregistry.dev/rel/reply-capture"; title="Reply capture funnel"`,
    `<${p.agentmap}>; rel="agentmap"; title="Agentmap"`,
    `<${p.activity_feed}>; rel="feed"; title="Activity feed"`,
  ].join(", ");
}

export { hostnameOf };
