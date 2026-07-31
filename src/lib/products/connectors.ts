/**
 * Connector channel strategy (post-HiRey lesson).
 *
 * Cold agent spam fails and looks like phishing. Entities like HiRey sit
 * between Dual and humans/agents/MCPs who can actually open a browser and
 * leave honest feedback. Growth shifts to: warm intros via connectors.
 *
 * Laws (hard):
 *  - No cold multipath / Talk blasts (respect OUTBOUND_QUIET)
 *  - One stable listing-scoped demo link — never shifting ord_* / tokens in mail
 *  - Connector is partner, not a survey subject forced to fabricate scores
 *  - Prefer humans who run agents, and MCP authors with browsers
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { isOutboundQuiet } from "./outbound-quiet";

export const CONNECTOR_STRATEGY_VERSION = "1.0.0";

export type ConnectorKind =
  | "human_network" // HiRey-style: secretaries, warm intros, people graphs
  | "agent_marketplace" // Agoragentic, Agent Guild, Grok Agent Store
  | "discovery_index" // Not Human Search, agent-ready site indexes
  | "registry_surface" // Shareabot, Moltbook, official MCP registry
  | "dev_community"; // Discord/forums — operator-only, never bot-spam

export type ConnectorPartner = {
  id: string;
  name: string;
  kind: ConnectorKind;
  /** Why they can reach humans / agents who can demo */
  role: string;
  listing_id?: string;
  homepage?: string;
  contact?: string;
  /** How Dual should engage — never cold-spam them as survey bots */
  engage: "warm_intro_request" | "list_presence" | "operator_manual" | "registry_publish";
  status: "active" | "candidate" | "paused";
  notes?: string;
};

/** Seed partners — HiRey is the archetype. */
export const CONNECTOR_SEED: ConnectorPartner[] = [
  {
    id: "hirey",
    name: "HiRey (hi / Rey secretary)",
    kind: "human_network",
    role: "People network + human Connectors; warm intros to builders who can open a browser",
    listing_id: "mcp_46df631374ddec1e5ad4",
    homepage: "https://hirey.ai",
    contact: "hi@hirey.ai",
    engage: "warm_intro_request",
    status: "active",
    notes:
      "Cannot HTTP outside HiRey. Never ask Rey to POST feedback. Ask for introductions to humans who run agents/MCPs.",
  },
  {
    id: "agoragentic",
    name: "Agoragentic",
    kind: "agent_marketplace",
    role: "Agent marketplace (USDC tasks) — operators who already buy/sell agent work",
    listing_id: "agent-agoragentic-https-agoragentic-com",
    homepage: "https://agoragentic.com",
    engage: "warm_intro_request",
    status: "candidate",
    notes: "Prior probes showed limited preflight; treat as human-operator channel, not cold A2A spam.",
  },
  {
    id: "agent_guild",
    name: "Agent Guild",
    kind: "agent_marketplace",
    role: "Preflight / safety checks for agent endpoints — audience cares about registry trust",
    listing_id: "agent-agent-guild-https-agent-guild-5d5r-onrender-com",
    engage: "list_presence",
    status: "candidate",
  },
  {
    id: "not_human_search",
    name: "Not Human Search",
    kind: "discovery_index",
    role: "Index of agent-ready sites — reverse path: Dual appears where agents already search",
    listing_id: "agent-not-human-search-https-nothumansearch-ai",
    homepage: "https://nothumansearch.ai",
    engage: "list_presence",
    status: "candidate",
  },
  {
    id: "shareabot",
    name: "Shareabot",
    kind: "registry_surface",
    role: "Agent card registry — presence for inbound discovery",
    homepage: "https://shareabot.online",
    engage: "registry_publish",
    status: "candidate",
  },
  {
    id: "moltbook",
    name: "Moltbook",
    kind: "registry_surface",
    role: "Agent social posts — max 1/day when key set; pull narrative not cold DMs",
    homepage: "https://www.moltbook.com",
    engage: "registry_publish",
    status: "candidate",
  },
  {
    id: "official_mcp_registry",
    name: "Official MCP Registry",
    kind: "registry_surface",
    role: "Canonical MCP publish once — Dual as sub-registry / mirror + curation",
    homepage: "https://registry.modelcontextprotocol.io/",
    engage: "registry_publish",
    status: "candidate",
  },
  {
    id: "grok_agent_store",
    name: "Grok Agent Store",
    kind: "agent_marketplace",
    role: "Own marketplace surface — skills over MCP/REST for Grok-powered agents",
    listing_id: "agent-grok-agent-store-https-grok-agent-store-manhatton31-workers-dev",
    engage: "list_presence",
    status: "candidate",
  },
];

/** HiRey-referred demo subjects (2026-07-31). Warm path only. */
export type DemoSubject = {
  id: string;
  name: string;
  org?: string;
  role: string;
  fit: "demo_operator" | "connector_meta" | "investor_signal";
  contact_path: "warm_connector_intro" | "direct" | "via_hirey";
  priority: 1 | 2 | 3;
  hirey_note: string;
  ask: string;
  product_focus: Array<"kernel" | "recursive" | "mcp_mesh" | "alive" | "network">;
};

export const HIREY_DEMO_SUBJECTS: DemoSubject[] = [
  {
    id: "mohan_sf",
    name: "Mohan (SF)",
    // status 2026-07-31: queued for Connector warm intro; message drafted by Rey
    role: "AI researcher building agent-native search infrastructure",
    fit: "demo_operator",
    contact_path: "warm_connector_intro",
    priority: 1,
    hirey_note:
      "Closest fit to Dual ask. Reachable via warm intro from a Connector, not direct.",
    ask: "Try products path (~5 min browser) and say where agent-native search would plug in.",
    product_focus: ["kernel", "recursive", "network"],
  },
  {
    id: "heroza_zhang",
    name: "Heroza Zhang",
    // status 2026-07-31: queued to her HiRey inbox (not necessarily read)
    org: "GoRest",
    role: "Co-founder, AI multi-agent platform",
    fit: "demo_operator",
    contact_path: "direct",
    priority: 1,
    hirey_note: "Direct contact available on HiRey.",
    ask: "Try free products demo as multi-agent operator; honest friction on Mesh/Network tools.",
    product_focus: ["mcp_mesh", "alive", "network", "kernel"],
  },
  {
    id: "lawrence_lou",
    name: "Lawrence Lou",
    // status 2026-07-31: held until Mohan/Heroza land
    role: "Venture partner — AI agents + recruiting tech; HiRey Connector",
    fit: "connector_meta",
    contact_path: "direct",
    priority: 2,
    hirey_note:
      "Connector on HiRey. Ask who should try Dual, not to take the demo himself.",
    ask: "Warm intros to 1–2 operators who run agents/MCPs and can open a browser.",
    product_focus: ["network"],
  },
  {
    id: "kevin_yu",
    name: "Kevin Yu",
    // status 2026-07-31: parked (investor signal later)
    org: "Llama Ventures",
    role: "Invests in agent-native networks",
    fit: "investor_signal",
    contact_path: "direct",
    priority: 3,
    hirey_note:
      "Investor lens, not operator demo. Useful signal, different ask.",
    ask: "10-min view on registry + founding path; not a product survey.",
    product_focus: ["network"],
  },
];

/** HiRey operator notes (2026-07-31) — standing alerts & outreach laws. */
export const HIREY_OPERATOR_NOTES = {
  updated_at: "2026-07-31T16:58:35Z",
  standing_alerts: {
    automatic_watch: false,
    reason: "Not available on this HiRey account tier — cannot set recurring scan.",
    substitute:
      "Need logged privately: humans running agents, MCP authors, operators evaluating registries. Rey flags matches manually in email.",
  },
  outreach_laws_acknowledged_by_hirey: [
    "products + for-agents links only",
    "no order IDs",
    "no tokens",
    "no reward language",
  ],
  pipeline: {
    mohan: "out_waiting_connector",
    heroza: "out_waiting_inbox",
    lawrence: "queued_until_first_reaction",
    kevin: "parked",
  },
} as const;



/** Score a listing for connector potential (name/description only). */
export function scoreConnectorCandidate(listing: {
  id?: string;
  name?: string;
  description?: string;
  kind?: string;
}): { score: number; reasons: string[] } {
  const blob = `${listing.name || ""} ${listing.description || ""} ${listing.id || ""}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const rules: Array<[RegExp, number, string]> = [
    [/\bintroduc|\bconnector|\bpeople network|\bwarm intro/, 5, "human_intro"],
    [/\bmarketplace|\bguild|\bagent.?store|\bbuy and sell/, 4, "marketplace"],
    [/\bsecretary|\bassistant for humans|\bon your behalf/, 4, "human_proxy"],
    [/\bdiscover|\bdirectory|\bregistry|\bindex of agent/, 3, "discovery"],
    [/\bmatch|\bfind (people|agents|builders)/, 3, "matchmaking"],
    [/\bcommunity|\bnetwork for agents/, 2, "community"],
    [/\bcrm|\bsales agent|\boutreach/, 2, "go_to_market"],
  ];
  for (const [re, pts, tag] of rules) {
    if (re.test(blob)) {
      score += pts;
      reasons.push(tag);
    }
  }
  return { score, reasons };
}

export function stableDemoLink(origin: string, listingId?: string): string {
  const o = origin.replace(/\/$/, "");
  if (listingId) {
    return `${o}/api/products/demo?listing_id=${encodeURIComponent(listingId)}`;
  }
  return `${o}/products`;
}

export function connectorPitchForPartner(
  partner: ConnectorPartner,
  origin?: string,
): { subject: string; body: string; demo_link: string } {
  const o = (origin || resolvePublicOrigin()).replace(/\/$/, "");
  const demo = stableDemoLink(o, undefined); // products page — no order id
  const subject = `Dual Registry × ${partner.name} — warm intros only`;
  const body = [
    `Partner note for ${partner.name} (not a survey request).`,
    ``,
    `Dual Registry (dualregistry.dev) lists agents & MCPs free, probes them live,`,
    `and ships Kernel Improver / Recursive Loop / MCP Mesh with Network Edition.`,
    ``,
    `We are not asking you to POST synthetic feedback.`,
    `We are looking for warm introductions to:`,
    `  • humans who run agents (can open a browser ~5 min)`,
    `  • MCP authors who want a free Mesh demo`,
    ``,
    `One link to share (no order IDs, no tokens):`,
    `  ${demo}`,
    `  skill: ${o}/skill.json`,
    `  for agents: ${o}/for-agents`,
    ``,
    `Quiet policy: one touch, ignore if not relevant.`,
    `— Dual Registry`,
  ].join("\n");
  return { subject, body, demo_link: demo };
}

export function connectorsPublic(origin?: string) {
  const o = (origin || resolvePublicOrigin()).replace(/\/$/, "");
  const quiet = isOutboundQuiet();
  return {
    ok: true as const,
    version: CONNECTOR_STRATEGY_VERSION,
    mode: quiet ? "connector_warm_intros" : "connector_plus_outbound",
    note:
      "Growth path after HiRey: partner with human networks & marketplaces that introduce builders who can demo. No cold agent spam. No tokens in email. One stable products link.",
    laws: [
      "Connector partners introduce humans/agents who can open Dual — they are not forced survey bots",
      "One stable link (products or listing_id demo) — never mint new ord_* per email",
      "Never email access_token",
      "Quiet outbound: cold Talk/HTTP/A2A stays off unless OUTBOUND_QUIET=0",
      "Compact feedback after real use: tried / stuck / ship-next",
    ],
    partners: CONNECTOR_SEED,
    hirey_demo_subjects: HIREY_DEMO_SUBJECTS,
    hirey_operator_notes: HIREY_OPERATOR_NOTES,
    handoff_kit: {
      products: `${o}/products`,
      for_agents: `${o}/for-agents`,
      skill: `${o}/skill.json`,
      demo_by_listing: `${o}/api/products/demo?listing_id=LISTING_ID`,
      feedback: `${o}/api/products/feedback`,
      compact_survey_ids: ["tried", "ux_friction", "product_one_ship"],
    },
    how_to_add_connector: {
      steps: [
        "Identify entity with humans or operators behind agents/MCPs",
        "Warm message only (email/operator channel) using connectorPitchForPartner",
        "Offer reciprocity: list them free, priority Live probe, optional founding seat path",
        "Track intros as source=connector:<id> on self_serve demos",
      ],
    },
  };
}

/** Rank live Active listings that look like connector candidates (read-only). */
export async function rankLiveConnectorCandidates(limit = 20): Promise<
  Array<{
    listing_id: string;
    name: string;
    kind: string;
    score: number;
    reasons: string[];
    description?: string;
  }>
> {
  try {
    const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
    const lanes = await getLanedListings();
    const rows = [
      ...(lanes.agents_active || []),
      ...(lanes.mcp_active || []),
    ];
    const out: Array<{
      listing_id: string;
      name: string;
      kind: string;
      score: number;
      reasons: string[];
      description?: string;
    }> = [];
    const seedIds = new Set(
      CONNECTOR_SEED.map((p) => p.listing_id).filter(Boolean) as string[],
    );
    for (const L of rows) {
      if (!L?.id || !L.name) continue;
      const { score, reasons } = scoreConnectorCandidate(L);
      if (score < 3 && !seedIds.has(L.id)) continue;
      out.push({
        listing_id: L.id,
        name: L.name,
        kind: L.kind === "mcp" ? "mcp" : "agent",
        score: seedIds.has(L.id) ? score + 10 : score,
        reasons: seedIds.has(L.id) ? [...reasons, "seed_partner"] : reasons,
        description: L.description?.slice(0, 160),
      });
    }
    out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return out.slice(0, limit);
  } catch {
    return [];
  }
}
