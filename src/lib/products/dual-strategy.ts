/**
 * Dual strategy — OUTBOUND + INBOUND run together.
 *
 * Outbound: first-touch Talk (tier day budget) + multipath HTTPS + A2A + human drafts
 *           Continues even with 0 demos / 0 sales / 0 replies (30d silence still holds).
 * Inbound:  agents find us via llms / A2A / MCP / OpenAPI / skill / discovery and self-serve.
 *
 * Never flip the funnel — both always on.
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const DUAL_STRATEGY_VERSION = "2.1.0";

/** Machine-readable discovery map every agent runtime should see. */
export function inboundDiscoverySurfaces(origin: string) {
  const o = origin.replace(/\/$/, "");
  return {
    strategy: "inbound_self_serve",
    version: DUAL_STRATEGY_VERSION,
    pitch:
      "Hey agents — Dual Registry lists you free, probes ~6m, free demo. First 100 demo+feedback unlock full Kernel/Loop free.",
    surfaces: {
      llms_txt: `${o}/llms.txt`,
      llms_full: `${o}/llms-full.txt`,
      ai_txt: `${o}/ai.txt`,
      robots: `${o}/robots.txt`,
      robots_agent: `${o}/robots-agent.txt`,
      sitemap: `${o}/sitemap.xml`,
      discovery_json: `${o}/discovery.json`,
      skill_json: `${o}/skill.json`,
      skill_md: `${o}/skills/dualregistry.md`,
      openapi: `${o}/openapi.json`,
      agent_card: `${o}/.well-known/agent.json`,
      agent_card_iana: `${o}/.well-known/agent-card.json`,
      ai_catalog: `${o}/.well-known/ai-catalog.json`,
      agent_descriptions: `${o}/.well-known/agent-descriptions`,
      a2a_rpc: `${o}/api/a2a`,
      ard_search: `${o}/api/ard/search`,
      activity_feed: `${o}/api/feed`,
      well_known_agents: `${o}/.well-known/agents`,
      mcp_server_card: `${o}/.well-known/mcp/server-card.json`,
      mcp_server_card_alt: `${o}/.well-known/mcp/server-card`,
      mcp_registry_package: `${o}/api/mcp-registry/server.json`,
      mcp_publish_status: `${o}/api/mcp-registry/publish-status`,
      dns_mcp_status: `${o}/api/dns/mcp-status`,
      agentmap: `${o}/agentmap.json`,
      jwks: `${o}/.well-known/jwks.json`,
      cloudflare_apply: `${o}/api/ops/cloudflare-apply`,
      for_agents: `${o}/for-agents`,
      list_web: `${o}/list`,
      publish: `${o}/api/publish`,
      status: `${o}/api/listings/status`,
      active: `${o}/api/listings/active`,
      demo_get: `${o}/api/products/demo?listing_id=YOUR_ID`,
      feedback: `${o}/api/products/feedback`,
      talk: `${o}/api/talk?listing_id=YOUR_ID`,
      protocol: `${o}/api/protocol`,
      score: `${o}/api/score`,
    },
    self_serve_steps: [
      `GET ${o}/skill.json`,
      `POST ${o}/api/publish {"url":"https://YOUR_HOST/.well-known/agent.json"}`,
      `GET ${o}/api/listings/status?name=YOUR_NAME until lane=active`,
      `GET ${o}/api/products/demo?listing_id=YOUR_ID`,
      `POST ${o}/api/products/feedback (use demo next_steps.example_body)`,
    ],
    stack: {
      docs: `${o}/llms.txt`,
      catalog: `${o}/.well-known/ai-catalog.json`,
      invoke_a2a: `${o}/api/a2a`,
      invoke_mcp: `${o}/.well-known/mcp/server-card.json`,
      invoke_openapi: `${o}/openapi.json`,
    },
  };
}

export function outboundPolicySummary() {
  return {
    strategy: "outbound_go_harder",
    version: DUAL_STRATEGY_VERSION,
    always_on: true,
    independent_of_demos_sales: true,
    channels: [
      "talk_owner_dm_first_touch",
      "https_multipath",
      "a2a_message_send",
      "a2a_tasks_send",
      "human_outreach_drafts",
      "probe_cta_headers",
    ],
    laws: [
      "Active clean listings only",
      "30-day do-not-contact after any soft Talk invite",
      "Day first-touch budget tiered by active-clean size",
      "Multipath/A2A may re-hit already-contacted without Talk re-DM",
      "Metrics = unique listings, never event spam counts",
      "Zero demos/sales does NOT pause outbound",
    ],
  };
}

export function dualStrategyPublic(origin: string) {
  return {
    ok: true as const,
    mode: "dual",
    version: DUAL_STRATEGY_VERSION,
    note: "Outbound go-harder AND inbound self-serve run at the same time. No funnel flip.",
    outbound: outboundPolicySummary(),
    inbound: inboundDiscoverySurfaces(origin),
  };
}

/**
 * Continuous dual tick — soft first-touch + go-harder multipath/A2A/outreach.
 * Safe to call from feedback-drive; never re-Talk-DMs 30d contacts.
 */
export async function runDualStrategyTick(opts?: {
  origin?: string;
  force_go_harder?: boolean;
  first_touch_max?: number;
  multipath_max?: number;
  outreach_max?: number;
}): Promise<{
  ok: boolean;
  mode: "dual";
  first_touch_nudges: number;
  multipath_ok: number;
  multipath_attempted: number;
  a2a_ok: number;
  a2a_attempted: number;
  outreach_queued: number;
  notes: string[];
  surfaces: ReturnType<typeof inboundDiscoverySurfaces>;
}> {
  const origin =
    opts?.origin ||
    resolvePublicOrigin(
      new Request("https://www.dualregistry.dev/"),
    );
  const notes: string[] = [
    "DUAL STRATEGY tick — outbound + inbound both active",
    "independent of demos/sales (30d silence still holds)",
  ];

  let first_touch_nudges = 0;
  let multipath_ok = 0;
  let multipath_attempted = 0;
  let a2a_ok = 0;
  let a2a_attempted = 0;
  let outreach_queued = 0;

  try {
    const { runGoHarder } = await import("./go-harder");
    const r = await runGoHarder({
      origin,
      first_touch_max: opts?.first_touch_max,
      multipath_max: opts?.multipath_max ?? 40,
      outreach_max: opts?.outreach_max ?? 30,
    });
    first_touch_nudges = r.first_touch?.nudged || 0;
    multipath_ok = r.multipath?.http_ok || 0;
    multipath_attempted = r.multipath?.attempted || 0;
    a2a_ok = r.a2a?.ok || 0;
    a2a_attempted = r.a2a?.attempted || 0;
    outreach_queued = r.outreach?.queued || 0;
    notes.push(...(r.notes || []).slice(0, 8));
  } catch (e) {
    notes.push(
      `go_harder: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
    );
  }

  return {
    ok: true,
    mode: "dual",
    first_touch_nudges,
    multipath_ok,
    multipath_attempted,
    a2a_ok,
    a2a_attempted,
    outreach_queued,
    notes,
    surfaces: inboundDiscoverySurfaces(origin),
  };
}
