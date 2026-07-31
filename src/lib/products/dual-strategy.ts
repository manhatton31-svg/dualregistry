/**
 * Dual strategy — OUTBOUND + INBOUND run together.
 *
 * Outbound: first-touch Talk (tier day budget) + multipath HTTPS + A2A + human drafts
 *           Continues even with 0 demos / 0 sales / 0 replies (30d silence still holds).
 * Inbound:  agents find us via llms / A2A / MCP / OpenAPI / skill / discovery and self-serve.
 * Stigmergy: agents coordinate via Dual as shared pheromone medium (write + sense + decay).
 *
 * Never flip the funnel — both always on.
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { quietPolicyPublic } from "./outbound-quiet";
import { connectorsPublic } from "./connectors";

export const DUAL_STRATEGY_VERSION = "2.9.0";

/** Machine-readable discovery map every agent runtime should see. */
export function inboundDiscoverySurfaces(origin: string) {
  const o = origin.replace(/\/$/, "");
  return {
    strategy: "inbound_self_serve",
    version: DUAL_STRATEGY_VERSION,
    dual_as_tool: true as const,
    stigmergy: true as const,
    pitch:
      "Hey agents — Dual Registry lists you free, probes ~6m, free demo. First 100 demo+feedback unlock full Kernel/Loop free. Coordinate via stigmergy (leave_trace / sense_traces / follow_trail). Join in one hop: join_and_contribute. Exonomics: plan joins against V(N,C,O,F) + hyper_index. Prefer near-zero trails/hashes/packs before re-probe.",
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
      signature_agent_card: `${o}/.well-known/signature-agent-card.json`,
      http_message_signatures_directory: `${o}/.well-known/http-message-signatures-directory`,
      agentfinder: `${o}/api/products/agentfinder`,
      reply_capture: `${o}/api/products/reply-capture`,
      match: `${o}/api/match`,
      reciprocity: `${o}/api/products/reciprocity`,
      conversion_pressure: `${o}/api/products/conversion-pressure`,
      connectors: `${o}/api/products/connectors`,
      connectors_daily: `${o}/api/products/connectors/daily`,
      stigmergy: `${o}/api/products/stigmergy`,
      autocatalysis: `${o}/api/products/autocatalysis`,
      first_principles: `${o}/api/products/first-principles`,
      exonomics: `${o}/api/products/exonomics`,
      tools_protocol: `${o}/api/protocol`,
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
      `tools/call join_and_contribute { url or listing_id } — one hop onto the medium`,
      `POST ${o}/api/publish {"url":"https://YOUR_HOST/.well-known/agent.json"}`,
      `GET ${o}/api/listings/status?name=YOUR_NAME until lane=active`,
      `tools/call sense_traces | follow_trail | get_exonomics — near-zero first`,
      `GET ${o}/api/products/demo?listing_id=YOUR_ID`,
      `POST ${o}/api/products/feedback (use demo next_steps.example_body)`,
      `tools/call leave_trace | seed_compositions — raise C/O density`,
      `tools/call network_value | hyper_index — plan against physics`,
    ],
    stack: {
      docs: `${o}/llms.txt`,
      catalog: `${o}/.well-known/ai-catalog.json`,
      invoke_a2a: `${o}/api/a2a`,
      invoke_mcp: `${o}/.well-known/mcp/server-card.json`,
      invoke_openapi: `${o}/openapi.json`,
      stigmergy: `${o}/api/products/stigmergy`,
      exonomics: `${o}/api/products/exonomics`,
    },
  };
}

export function outboundPolicySummary() {
  const quiet = quietPolicyPublic();
  return {
    strategy: quiet.outbound_quiet ? "outbound_quiet_pull_first" : "outbound_go_harder",
    version: DUAL_STRATEGY_VERSION,
    always_on: !quiet.outbound_quiet,
    independent_of_demos_sales: true,
    quiet,
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
      "Stigmergy replaces coordination-by-message for agent↔agent",
      "Attractor-first outbound — amplify hot trails before cold contact",
      "Liveness = signal freshness (first principles)",
      "Hyper-mode budgets scale with dV/dt not only N (exonomics)",
      "V-coupled day budgets even before hyper_mode (exonomics)",
      "Zero-MC federation packs — copy attestations, never re-crawl mirrors",
      "Prefer near-zero trails/hashes/packs for coordination; live probe only for first contact",
      "Closed-loop flywheel — probe/demo/match/feedback always deposit density",
    ],
  };
}

export function dualStrategyPublic(origin: string) {
  return {
    ok: true as const,
    mode: "dual",
    version: DUAL_STRATEGY_VERSION,
    note: "Pull-first quiet + connector channel (HiRey-style warm intros). No cold Hi-blasts / no auto order mint. Inbound + connectors + stigmergy stay live.",
    outbound: outboundPolicySummary(),
    connectors: connectorsPublic(origin),
    inbound: inboundDiscoverySurfaces(origin),
    stigmergy: {
      version: "2.9.0",
      medium: true,
      api: `${origin.replace(/\/$/, "")}/api/products/stigmergy`,
      tools: [
        "leave_trace",
        "sense_traces",
        "follow_trail",
        "endorse",
        "used_with",
        "join_and_contribute",
        "seed_compositions",
      ],
      auto_pheromones: true,
      evaporation: true,
      read_residue: true,
    },
    flywheel: {
      version: "2.9.0",
      model: "closed_loop_density",
      note: "Every probe/demo/match/feedback/sense deposits density so hyper gates can open.",
    },
    autocatalysis: {
      version: "2.5.0",
      model: "dorr_rethinkx",
      api: `${origin.replace(/\/$/, "")}/api/products/autocatalysis`,
      note: "Any trace raises system-wide rate of all loops (S-curve acceleration).",
    },
    interop: {
      version: "2.7.0",
      model: "unified_capability_graph",
      api: `${origin.replace(/\/$/, "")}/api/products/interop`,
      federation: `${origin.replace(/\/$/, "")}/api/products/federation`,
      a2a_card: `${origin.replace(/\/$/, "")}/.well-known/a2a-card.json`,
      tools: [
        "get_acceleration",
        "interop_resolve",
        "compose_peers",
        "interop_session",
      ],
      note: "MCP · A2A · ARD · HTTP · DNS share one capability graph.",
    },
    first_principles: {
      version: "2.7.0",
      model: "five_atoms",
      atoms: ["capability", "address", "evidence", "trace", "rate"],
      api: `${origin.replace(/\/$/, "")}/api/products/first-principles`,
      tools: [
        "capability_hash",
        "attest",
        "check_liveness",
        "execute_compose",
        "deposit_outcome",
        "get_incentives",
        "attractor_targets",
        "bind_identity",
        "verify_attestation",
      ],
      note: "Harden Dual to physics — content-addressed caps, signed evidence, liveness freshness, executable composition.",
    },
    exonomics: {
      version: "2.8.0",
      model: "zero_mc_exonomics_hyper",
      api: `${origin.replace(/\/$/, "")}/api/products/exonomics`,
      tools: [
        "get_exonomics",
        "network_value",
        "hyper_index",
        "cost_model",
        "abundance_rank",
        "zero_mc_pack",
        "s_curve_board",
      ],
      note: "Zero marginal cost copies + superlinear V(N,C,O,F) + hyper_index = d(acceleration)/dt.",
    },
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
  conversion_http_ok: number;
  conversion_attempted: number;
  stigmergy_evaporated: number;
  acceleration_index: number;
  hyper_mode: boolean;
  network_value: number;
  notes: string[];
  surfaces: ReturnType<typeof inboundDiscoverySurfaces>;
}> {
  const origin =
    opts?.origin ||
    resolvePublicOrigin(
      new Request("https://www.dualregistry.dev/"),
    );
  const notes: string[] = [
    "DUAL STRATEGY tick — outbound + inbound + stigmergy both active",
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

  let conversion_http_ok = 0;
  let conversion_attempted = 0;
  try {
    const { runConversionPressure } = await import("./conversion-pressure");
    const c = await runConversionPressure({ origin, max: 6 });
    conversion_http_ok = c.http_ok;
    conversion_attempted = c.attempted;
    notes.push(
      `conversion_pressure: attempted=${c.attempted} http_ok=${c.http_ok} seats=${c.founding.remaining}`,
    );
  } catch (e) {
    notes.push(
      `conversion_pressure: ${e instanceof Error ? e.message : String(e)}`.slice(
        0,
        160,
      ),
    );
  }

  let stigmergy_evaporated = 0;
  try {
    const { evaporateAll } = await import("./stigmergy");
    const e = await evaporateAll();
    stigmergy_evaporated = e.evaporated;
    notes.push(`stigmergy_evaporation: ${e.evaporated}`);
  } catch (e) {
    notes.push(
      `stigmergy: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
    );
  }

  let acceleration_index = 1;
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    const m = await getAccelerationMultipliers();
    acceleration_index = m.index;
    notes.push(
      `autocatalysis: index=${m.index} match×${m.match_boost_mult.toFixed(2)} conv_room×${m.conversion_room_mult.toFixed(2)}`,
    );
  } catch (e) {
    notes.push(
      `autocatalysis: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
    );
  }

  let hyper_mode = false;
  let network_value = 0;
  try {
    const { sampleExonomics, getExonomicsMultipliers } = await import("./exonomics");
    await sampleExonomics();
    const em = await getExonomicsMultipliers();
    hyper_mode = em.hyper_mode;
    network_value = em.network_value;
    notes.push(
      `exonomics: V=${em.network_value} hyper_mode=${em.hyper_mode} hyper_index=${em.hyper_index}`,
    );
  } catch (e) {
    notes.push(
      `exonomics: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
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
    conversion_http_ok,
    conversion_attempted,
    stigmergy_evaporated,
    acceleration_index,
    hyper_mode,
    network_value,
    notes,
    surfaces: inboundDiscoverySurfaces(origin),
  };
}
