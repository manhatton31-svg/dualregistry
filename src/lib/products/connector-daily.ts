/**
 * One HiRey-class connector per day.
 *
 * Goal: each day, identify and warm-touch at most ONE entity that can
 * introduce Dual to humans/agents/MCPs (not spam them for surveys).
 *
 * Cadence laws:
 *  - Max 1 first-touch per calendar day (UTC)
 *  - Prefer human_network > marketplace > discovery > registry
 *  - Never auto-email; output a draft for the operator to send
 *  - Same quiet laws: products + for-agents only, no ord_*, no tokens
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import {
  CONNECTOR_SEED,
  type ConnectorKind,
  type ConnectorPartner,
  connectorPitchForPartner,
  scoreConnectorCandidate,
} from "./connectors";

export const CONNECTOR_DAILY_VERSION = "1.0.0";

export type LiveConnectorRow = {
  listing_id: string;
  name: string;
  kind: string;
  score: number;
  reasons: string[];
  description?: string;
};

/** How much like HiRey is this? */
export function hireyLikenessScore(input: {
  kind?: ConnectorKind | string;
  name?: string;
  description?: string;
  role?: string;
  engage?: string;
}): { score: number; traits: string[] } {
  const blob = `${input.name || ""} ${input.description || ""} ${input.role || ""}`.toLowerCase();
  const traits: string[] = [];
  let score = 0;

  const rules: Array<[RegExp, number, string]> = [
    [/\bsecretary|\brey\b|\bhi@|\bpeople network|\bwarm intro|\bconnector\b/, 8, "human_proxy"],
    [/\bintroduc|\bmeet anyone|\bon your behalf|\bpeople you meet/, 6, "intro_graph"],
    [/\bhuman|\boperator|\bfounder|\bco-?founder/, 4, "human_operator"],
    [/\bmarketplace|\bguild|\bagent.?store/, 3, "marketplace"],
    [/\bdiscover|\bdirectory|\bregistry|\bindex/, 2, "discovery"],
    [/\bcommunity|\bnetwork for agents|\bcrm/, 2, "community"],
  ];
  for (const [re, pts, tag] of rules) {
    if (re.test(blob)) {
      score += pts;
      traits.push(tag);
    }
  }
  if (input.kind === "human_network") {
    score += 10;
    traits.push("kind_human_network");
  } else if (input.kind === "agent_marketplace") {
    score += 5;
    traits.push("kind_marketplace");
  } else if (input.kind === "discovery_index") {
    score += 3;
    traits.push("kind_discovery");
  } else if (input.kind === "registry_surface") {
    score += 2;
    traits.push("kind_registry");
  }
  if (input.engage === "warm_intro_request") {
    score += 4;
    traits.push("engage_warm");
  }
  return { score, traits: [...new Set(traits)] };
}

export type DailyConnectorPick = {
  day: string;
  partner: ConnectorPartner;
  hirey_likeness: number;
  traits: string[];
  why: string;
  action: {
    step: string;
    do_not: string[];
    draft: { subject: string; body: string; demo_link: string };
  };
  queue_after: Array<{ id: string; name: string; score: number }>;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function pickConnectorOfTheDay(opts?: {
  day?: string;
  excludeIds?: string[];
  origin?: string;
  live?: LiveConnectorRow[];
}): DailyConnectorPick {
  const day = opts?.day || utcDay();
  const exclude = new Set(opts?.excludeIds || []);
  for (const p of CONNECTOR_SEED) {
    if (p.status === "active") exclude.add(p.id);
  }

  type Ranked = {
    partner: ConnectorPartner;
    hirey_likeness: number;
    traits: string[];
  };
  const ranked: Ranked[] = [];

  for (const p of CONNECTOR_SEED) {
    if (exclude.has(p.id) || p.status === "paused") continue;
    const { score, traits } = hireyLikenessScore(p);
    ranked.push({ partner: p, hirey_likeness: score, traits });
  }

  for (const L of opts?.live || []) {
    if (!L.listing_id || exclude.has(L.listing_id)) continue;
    if (CONNECTOR_SEED.some((s) => s.listing_id === L.listing_id || s.id === L.listing_id)) {
      continue;
    }
    const base = scoreConnectorCandidate({
      id: L.listing_id,
      name: L.name,
      description: L.description,
      kind: L.kind,
    });
    if (base.score < 3) continue;
    const synthetic: ConnectorPartner = {
      id: L.listing_id,
      name: L.name,
      kind:
        base.reasons.includes("human_intro") || base.reasons.includes("human_proxy")
          ? "human_network"
          : base.reasons.includes("marketplace")
            ? "agent_marketplace"
            : "discovery_index",
      role: L.description || "Live Active listing with connector-ish signals",
      listing_id: L.listing_id,
      engage: "warm_intro_request",
      status: "candidate",
      notes: `live_candidate reasons=${base.reasons.join(",")}`,
    };
    const { score, traits } = hireyLikenessScore({
      ...synthetic,
      description: L.description,
    });
    ranked.push({
      partner: synthetic,
      hirey_likeness: score + Math.min(5, L.score),
      traits,
    });
  }

  ranked.sort(
    (a, b) =>
      b.hirey_likeness - a.hirey_likeness ||
      a.partner.name.localeCompare(b.partner.name),
  );

  const top = ranked[0];
  const origin = opts?.origin || resolvePublicOrigin();
  if (!top) {
    const fallback: ConnectorPartner = {
      id: "manual_research",
      name: "Manual research day",
      kind: "dev_community",
      role: "No ranked candidates left — operator does 15m research for a new human network",
      engage: "operator_manual",
      status: "candidate",
    };
    return {
      day,
      partner: fallback,
      hirey_likeness: 0,
      traits: ["research"],
      why: "Queue empty — spend 15 minutes finding one human-network / secretary / marketplace operator.",
      action: {
        step: "Search for: AI people network, agent marketplace operators, MCP directory maintainers. Add one to CONNECTOR_SEED.",
        do_not: [
          "Do not cold-blast Active agents",
          "Do not mint order IDs",
          "Do not ask bots to POST feedback",
        ],
        draft: {
          subject: "(no draft — research day)",
          body: "",
          demo_link: `${origin.replace(/\/$/, "")}/products`,
        },
      },
      queue_after: [],
    };
  }

  const draft = connectorPitchForPartner(top.partner, origin);
  return {
    day,
    partner: top.partner,
    hirey_likeness: top.hirey_likeness,
    traits: top.traits,
    why: `Highest HiRey-likeness among remaining candidates (${top.traits.join(", ") || "n/a"}). One warm first-touch only.`,
    action: {
      step:
        top.partner.engage === "registry_publish"
          ? "Publish Dual presence (agent card / skill) — no cold DM."
          : top.partner.engage === "list_presence"
            ? "Ensure Dual is visible on their surface; one calm operator note if contact known."
            : "Send ONE warm email/operator note. Offer reciprocity: free list + honest product path. Ask for intros to humans who run agents, not for them to fake survey scores.",
      do_not: [
        "No second email the same day",
        "No order IDs or access tokens",
        "No 'first 100 free' reward language",
        "No asking their agent to POST /api/products/feedback",
        "No multipath/Talk auto-blast",
      ],
      draft,
    },
    queue_after: ranked.slice(1, 8).map((r) => ({
      id: r.partner.id,
      name: r.partner.name,
      score: r.hirey_likeness,
    })),
  };
}

export function connectorDailyPlaybook() {
  return {
    version: CONNECTOR_DAILY_VERSION,
    goal: "One new HiRey-class partner per day (or deepen one active one).",
    definition_of_hirey_class: [
      "Human or human-secretary sits between Dual and builders",
      "Can make warm intros (or is a marketplace/index operators check daily)",
      "Does NOT need to complete our survey themselves",
      "Has an inbox humans actually read",
      "Understands agents/MCPs enough to know who to introduce",
    ],
    daily_ritual_15_min: [
      "1. GET /api/products/connectors/daily — today's pick + draft",
      "2. Open their homepage / listing; confirm human contact path",
      "3. Send the draft once (edit tone; keep two links only)",
      "4. Log result: queued | replied | dead | needs_connector",
      "5. Stop. No second outreach today.",
    ],
    where_to_find_more: [
      {
        source: "Dual Active listings",
        how: "Rank by human_intro/proxy/marketplace signals (/api/products/connectors live_candidates)",
      },
      {
        source: "Official MCP Registry + tool directories",
        how: "Maintainers talk to MCP authors daily",
      },
      {
        source: "Agent marketplaces",
        how: "Operator intros — not task spam",
      },
      {
        source: "People networks (HiRey peers)",
        how: "Ask Rey / Lawrence: who else does warm intros for AI builders?",
      },
      {
        source: "VC / recruiting tech",
        how: "Meta-connectors — 'who should try Dual' not 'try Dual'",
      },
      {
        source: "Conference / X / Discord (operator only)",
        how: "You hand-pick; never bot-spam channels",
      },
    ],
    quality_over_quota: {
      note: "Missing a day is fine. Spamming 5 mid-tier bots is worse than one real secretary.",
      promote_to_active_when: [
        "They confirmed they'll flag builders",
        "Or they introduced at least one human",
        "Or they accepted Dual as a listed partner",
      ],
    },
  };
}

export function connectorDailyPublic(origin?: string, live?: LiveConnectorRow[]) {
  const o = (origin || resolvePublicOrigin()).replace(/\/$/, "");
  const pick = pickConnectorOfTheDay({ origin: o, live });
  return {
    ok: true as const,
    version: CONNECTOR_DAILY_VERSION,
    playbook: connectorDailyPlaybook(),
    today: pick,
    laws: [
      "Max 1 connector first-touch per UTC day",
      "HiRey stays active — daily pick is the NEXT partner",
      "Draft only; operator sends",
      "products + for-agents only in outbound",
    ],
  };
}
