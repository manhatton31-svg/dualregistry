/**
 * Source-of-truth map for every public dashboard number.
 * Prefer buildMetricsTruthFromParts() on the hot dashboard path.
 */
export type MetricTruth = {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  source: string;
  how: string;
  live: boolean;
};

export function buildMetricsTruthFromParts(input: {
  snap: {
    live?: boolean;
    source?: string;
    mcp?: { total?: number };
    agents?: { total?: number };
    milestones?: {
      mcp?: { approved?: number };
      agents?: { approved?: number };
    };
  };
  product_engagement: {
    demo_agent_only?: number;
    demo_mcps?: number;
    feedback_agent_only?: number;
    feedback_agents?: number;
    feedback_mcps?: number;
    discounts_issued?: number;
  } | null;
  listing_lanes: {
    counts?: {
      mcp_active: number;
      mcp_discovered: number;
      agents_active: number;
      agents_discovered: number;
    };
  } | null;
  mirrorTotal?: number | null;
  probeUsed?: number | null;
  probeBudget?: number | null;
}): {
  updated_at: string;
  metrics: MetricTruth[];
  story: string;
} {
  const mcpStore =
    input.snap.milestones?.mcp?.approved ?? input.snap.mcp?.total ?? 0;
  const agentStore =
    input.snap.milestones?.agents?.approved ?? input.snap.agents?.total ?? 0;
  const pe = input.product_engagement;
  const lc = input.listing_lanes?.counts;
  const fbA = pe?.feedback_agent_only ?? pe?.feedback_agents ?? 0;
  const fbM = pe?.feedback_mcps ?? 0;

  const metrics: MetricTruth[] = [
    {
      id: "mcp_in_store",
      label: "MCPs in our registry",
      value: mcpStore,
      source: "Agent store milestones (approved)",
      how: "Listings approved on the Agents1 store. Not the same as probe-live.",
      live: !!input.snap.live,
    },
    {
      id: "agents_in_store",
      label: "Agents in our registry",
      value: agentStore,
      source: "Agent store milestones (approved)",
      how: "Listings approved on the Agents1 store.",
      live: !!input.snap.live,
    },
    {
      id: "mcp_active",
      label: "MCPs live (probe ok)",
      value: lc?.mcp_active ?? 0,
      source: "listing-lanes + data/probes.json",
      how: "Checks clean + handshake ok in last 48h.",
      live: true,
    },
    {
      id: "agents_active",
      label: "Agents live (probe ok)",
      value: lc?.agents_active ?? 0,
      source: "listing-lanes + data/probes.json",
      how: "Checks clean + handshake ok in last 48h.",
      live: true,
    },
    {
      id: "mcp_discovered",
      label: "MCPs discovered",
      value: lc?.mcp_discovered ?? 0,
      source: "store + growth classified by listing-lanes",
      how: "Picked up; awaiting clean probe to become live.",
      live: true,
    },
    {
      id: "agents_discovered",
      label: "Agents discovered",
      value: lc?.agents_discovered ?? 0,
      source: "store + growth classified by listing-lanes",
      how: "Picked up; promotes after clean probe.",
      live: true,
    },
    {
      id: "mirror_catalog",
      label: "Mirror catalog",
      value: input.mirrorTotal ?? "see Ops / protocol",
      source: "Official public MCP registry mirror",
      how: "External discovery universe — larger than our approved set on purpose.",
      live: input.mirrorTotal != null,
    },
    {
      id: "probes_today",
      label: "Probes today",
      value:
        input.probeUsed != null && input.probeBudget != null
          ? `${input.probeUsed}/${input.probeBudget}`
          : "see Ops / protocol",
      source: "data/probes.json",
      how: "5 every 30 min · 240/day handshakes. Promotes discovered → live.",
      live: true,
    },
    {
      id: "demo_agents",
      label: "Agent product demos",
      value: pe?.demo_agent_only ?? 0,
      source: "data/products/orders.json",
      how: "Unique agents who took a free product demo. ≠ registry size.",
      live: true,
    },
    {
      id: "feedback_agents",
      label: "Agent feedback (real)",
      value: fbA,
      source: "data/products/feedback.json (real only)",
      how: "Counts toward 250 unlock. No synthetic surveys.",
      live: true,
    },
    {
      id: "demo_mcps",
      label: "MCP product demos",
      value: pe?.demo_mcps ?? 0,
      source: "data/products/orders.json",
      how: "Unique MCP publishers who took a free demo.",
      live: true,
    },
    {
      id: "feedback_mcps",
      label: "MCP feedback (real)",
      value: fbM,
      source: "data/products/feedback.json (real only)",
      how: "Counts toward 250 MCP unlock.",
      live: true,
    },
    {
      id: "discounts",
      label: "Discount codes issued",
      value: pe?.discounts_issued ?? 0,
      source: "feedback.json discounts[]",
      how: "A1FB codes from real survey completions.",
      live: true,
    },
    {
      id: "unlock_progress",
      label: "Payments unlock",
      value: `${fbA}/250 agents · ${fbM}/250 MCPs`,
      source: "payment-gate + real product engagement",
      how: "Both must hit 250 real feedbacks before Stripe opens.",
      live: true,
    },
  ];

  return {
    updated_at: new Date().toISOString(),
    metrics,
    story:
      "Registry size (store) ≠ live (probe ok) ≠ demos ≠ feedback. Mirror is an external discovery catalog. Unlock only moves on real product surveys.",
  };
}

/** Full async path (Ops tools / scripts) */
export async function getMetricsTruth() {
  const { loadStoreCache } = await import("./store-cache");
  const { getLanedListings } = await import("./listing-lanes");
  const { getProductEngagement } = await import("@/lib/products/engagement");
  const cache = await loadStoreCache();
  const [lanes, pe] = await Promise.all([
    getLanedListings().catch(() => null),
    getProductEngagement().catch(() => null),
  ]);
  let mirrorTotal: number | null = null;
  let probeUsed: number | null = null;
  let probeBudget: number | null = null;
  try {
    const { loadOfficialMirror } = await import("./official-mirror");
    const m = await loadOfficialMirror();
    mirrorTotal = m.total_seen ?? m.entries?.length ?? null;
  } catch {
    /* */
  }
  try {
    const { getProbePublic } = await import("./probe");
    const p = await getProbePublic();
    probeUsed = p.used;
    probeBudget = p.budget;
  } catch {
    /* */
  }
  return buildMetricsTruthFromParts({
    snap: {
      live: cache.live,
      source: cache.source,
      mcp: { total: cache.mcp_approved },
      agents: { total: cache.agents_approved },
      milestones: cache.milestones,
    },
    product_engagement: pe,
    listing_lanes: lanes,
    mirrorTotal,
    probeUsed,
    probeBudget,
  });
}
