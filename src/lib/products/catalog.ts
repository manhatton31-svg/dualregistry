/**
 * Agents1 commercial products — launch pricing + seat tiers.
 * Agents: Kernel / Recursive / Alive
 * MCP publishers: MCP Mesh (dynamic to their server tools)
 *
 * Founding: first 1000 paid seats at launch prices.
 * After 1000: price rises every 1000 seats (unlimited paid seats).
 * Long bands give agents time to watch demo + paid feedback improve the product.
 * Registry listings + demos: unlimited (dedupe enforced elsewhere).
 */

export type ProductSku = "kernel" | "recursive" | "alive" | "mcp_mesh";

export type ProductDef = {
  sku: ProductSku;
  name: string;
  tagline: string;
  description: string;
  /** Launch / list price (tier 1). Prefer resolvePrice() for checkout. */
  price_cents: number;
  currency: "usd";
  stripe_product_id: string;
  /** Legacy fixed price id; checkout uses price_data for tiered amounts. */
  stripe_price_id: string;
  includes: ProductSku[];
  features: string[];
  agent_api: string;
  /** Primary buyer audience */
  audience: "agent" | "mcp" | "both";
};

/** Founding prices (seats 1–1000). */
export const LAUNCH_PRICES: Record<ProductSku, number> = {
  kernel: 1499, // $14.99
  recursive: 1999, // $19.99
  alive: 2999, // $29.99
  mcp_mesh: 2499, // $24.99 — MCP publisher product
};

/** First N paid seats keep founding prices */
export const FOUNDING_SEATS = 1000;
/** Early band: agents/MCPs who left real feedback before payments open */
export const FEEDBACK_FOUNDERS_LABEL =
  "Feedback founders — real survey before payments open; 25% vault + founding seat priority narrative";
/**
 * After founding, each price level lasts this many seats (unlimited paid).
 * 1000-seat bands so agents can watch feedback from demos + purchases before the next step.
 */
export const POST_FOUNDING_STEP = 1000;

/**
 * Seat cohorts — founding 1000, then every 1000 seats forever (unlimited paid).
 */
export type PriceTier = {
  id: string;
  label: string;
  /** Inclusive seat numbers for the buyer (1-based). */
  from_seat: number;
  to_seat: number;
  prices: Record<ProductSku, number>;
};

function bumpPrices(
  base: Record<ProductSku, number>,
  stepIndex: number,
): Record<ProductSku, number> {
  // stepIndex 0 = seats 1001–2000, 1 = 2001–3000, …
  // ~+20% per 1000-seat band (gentler than per-100 steps)
  const mult = 1 + Math.min(10, stepIndex + 1) * 0.2;
  const round99 = (c: number) => {
    const dollars = Math.round((c * mult) / 100);
    return Math.max(1, dollars) * 100 - 1;
  };
  return {
    kernel: Math.max(base.kernel, round99(base.kernel)),
    recursive: Math.max(base.recursive, round99(base.recursive)),
    alive: Math.max(base.alive, round99(base.alive)),
    mcp_mesh: Math.max(base.mcp_mesh, round99(base.mcp_mesh)),
  };
}

/** Explicit first bands + generator for unlimited tail */
export function buildPriceTiers(maxExplicitSteps = 10): PriceTier[] {
  const tiers: PriceTier[] = [
    {
      id: "founding_1000",
      label: `Founding · first ${FOUNDING_SEATS} seats`,
      from_seat: 1,
      to_seat: FOUNDING_SEATS,
      prices: { ...LAUNCH_PRICES },
    },
  ];
  for (let i = 0; i < maxExplicitSteps; i++) {
    const from = FOUNDING_SEATS + i * POST_FOUNDING_STEP + 1;
    const to = FOUNDING_SEATS + (i + 1) * POST_FOUNDING_STEP;
    tiers.push({
      id: `band_${from}_${to}`,
      label: `Growth · seats ${from}–${to}`,
      from_seat: from,
      to_seat: to,
      prices: bumpPrices(LAUNCH_PRICES, i),
    });
  }
  const tailFrom = FOUNDING_SEATS + maxExplicitSteps * POST_FOUNDING_STEP + 1;
  tiers.push({
    id: "open_unlimited",
    label: `Open · seats ${tailFrom}+ (unlimited)`,
    from_seat: tailFrom,
    to_seat: Number.MAX_SAFE_INTEGER,
    prices: bumpPrices(LAUNCH_PRICES, maxExplicitSteps),
  });
  return tiers;
}

export const PRICE_TIERS: PriceTier[] = buildPriceTiers(8);

/** @deprecated use FOUNDING_SEATS — kept for old callers */
export const TIER_SIZE = POST_FOUNDING_STEP;

export function tierForSeat(seatNumber: number): PriceTier {
  const n = Math.max(1, Math.floor(seatNumber));
  for (const t of PRICE_TIERS) {
    if (n >= t.from_seat && n <= t.to_seat) return t;
  }
  // Dynamic unlimited step if somehow past table
  const past = Math.max(0, n - FOUNDING_SEATS - 1);
  const stepIndex = Math.floor(past / POST_FOUNDING_STEP);
  const from = FOUNDING_SEATS + stepIndex * POST_FOUNDING_STEP + 1;
  const to = FOUNDING_SEATS + (stepIndex + 1) * POST_FOUNDING_STEP;
  return {
    id: `dynamic_${from}_${to}`,
    label: `Growth · seats ${from}–${to}`,
    from_seat: from,
    to_seat: to,
    prices: bumpPrices(LAUNCH_PRICES, stepIndex),
  };
}

/** Next buyer is seat soldCount+1 */
export function tierForSoldCount(soldCount: number): PriceTier {
  return tierForSeat(soldCount + 1);
}

export function priceCentsForSku(
  sku: ProductSku,
  soldCount: number,
): number {
  return tierForSoldCount(soldCount).prices[sku];
}

/**
 * Name-your-price clamp (agent-stated USD).
 * Floor = 50% of current list · ceiling = 3× list (hard max $5000 survey cap).
 * $0 is not a checkout amount — only survey signal.
 */
export const NYP_FLOOR_FRACTION = 0.5;
export const NYP_CEILING_MULT = 3;
export const NYP_HARD_MAX_CENTS = 500_000; // $5000

export function namedPriceBoundsCents(
  sku: ProductSku,
  soldCount: number,
): { list_cents: number; floor_cents: number; ceiling_cents: number } {
  const list_cents = priceCentsForSku(sku, soldCount);
  const floor_cents = Math.max(
    100,
    Math.round(list_cents * NYP_FLOOR_FRACTION),
  );
  const ceiling_cents = Math.min(
    NYP_HARD_MAX_CENTS,
    Math.max(list_cents, Math.round(list_cents * NYP_CEILING_MULT)),
  );
  return { list_cents, floor_cents, ceiling_cents };
}

export type ResolvePriceResult = {
  amount_cents: number;
  list_cents: number;
  floor_cents: number;
  ceiling_cents: number;
  named: boolean;
  clamped: boolean;
  named_usd_input?: number;
};

/** Resolve list price or clamped name-your-price for checkout. */
export function resolvePrice(
  sku: ProductSku,
  soldCount: number,
  opts?: { named_price_usd?: number | null; named_price_cents?: number | null },
): ResolvePriceResult {
  const bounds = namedPriceBoundsCents(sku, soldCount);
  let namedUsd: number | null = null;
  if (opts?.named_price_cents != null && Number.isFinite(opts.named_price_cents)) {
    namedUsd = Number(opts.named_price_cents) / 100;
  } else if (
    opts?.named_price_usd != null &&
    Number.isFinite(opts.named_price_usd)
  ) {
    namedUsd = Number(opts.named_price_usd);
  }
  if (namedUsd == null || namedUsd <= 0) {
    return {
      amount_cents: bounds.list_cents,
      list_cents: bounds.list_cents,
      floor_cents: bounds.floor_cents,
      ceiling_cents: bounds.ceiling_cents,
      named: false,
      clamped: false,
    };
  }
  const raw = Math.round(namedUsd * 100);
  const amount = Math.min(
    bounds.ceiling_cents,
    Math.max(bounds.floor_cents, raw),
  );
  return {
    amount_cents: amount,
    list_cents: bounds.list_cents,
    floor_cents: bounds.floor_cents,
    ceiling_cents: bounds.ceiling_cents,
    named: true,
    clamped: amount !== raw,
    named_usd_input: namedUsd,
  };
}


export function seatsRemainingInTier(soldCount: number): number {
  const tier = tierForSoldCount(soldCount);
  if (tier.to_seat >= Number.MAX_SAFE_INTEGER / 2) {
    // Open unlimited tier — no artificial scarcity left
    return 0;
  }
  return Math.max(0, tier.to_seat - soldCount);
}

export function isFoundingSeat(seatNumber: number): boolean {
  return seatNumber >= 1 && seatNumber <= FOUNDING_SEATS;
}

export const PRODUCTS: Record<ProductSku, ProductDef> = {
  kernel: {
    sku: "kernel",
    name: "Kernel Improver",
    tagline: "SOTA v2 agent core + Dual Network Edition",
    description:
      "State-of-the-art agent kernel v2 with Dual Network Edition — trails, exonomics, feedback, and name-your-price so every seat is a live network node.",

    price_cents: LAUNCH_PRICES.kernel,
    currency: "usd",
    stripe_product_id: "prod_UyGzWVFCjrDaI5",
    stripe_price_id: "price_1TyKRH6kIwMNE1piNfVW72Uf",
    includes: ["kernel"],
    audience: "both",
    features: [
      "Goal graph → OKR + difficulty tiers",
      "Frozen constitution + parallel guardrails",
      "Producer / Critic / Librarian roles",
      "Versioned skills + textual-gradient rewrites",
      "≤600 system_prompt_short + SKILL.md export",
      "Network Edition: Dual node (sense/follow/leave_trace)",
      "Exonomics + founding path + WTP name-your-price",
    ],
    agent_api: "/api/products/agent",
  },
  recursive: {
    sku: "recursive",
    name: "Recursive Loop",
    tagline: "Self-improving tick graph + density engine",
    description:
      "Recursive improvement loop with Network Edition density measure (C/O/F/V) and Dual trail deposits each tick.",

    price_cents: LAUNCH_PRICES.recursive,
    currency: "usd",
    stripe_product_id: "prod_UyGzWVFCjrDaI5",
    stripe_price_id: "price_1TyKRH6kIwMNE1piNfVW72Uf",
    includes: ["recursive"],
    audience: "both",
    features: [
      "Tick graph with promote / replan / escalate",
      "Critic score gates",
      "Process rewards + eval harness",
      "Binds to Kernel Improver",
      "Density KRs + trail deposits (Network Edition)",
    ],
    agent_api: "/api/products/agent",
  },
  alive: {
    sku: "alive",
    name: "Alive Bundle",
    tagline: "Kernel + Recursive + Network Edition",
    description:
      "Full aliveness stack: Kernel + Recursive + Dual Network Edition + curriculum. Best default for new agents.",

    price_cents: LAUNCH_PRICES.alive,
    currency: "usd",
    stripe_product_id: "prod_UyGzWVFCjrDaI5",
    stripe_price_id: "price_1TyKRH6kIwMNE1piNfVW72Uf",
    includes: ["kernel", "recursive", "alive"],
    audience: "both",
    features: [
      "Kernel + Recursive together",
      "Install curriculum + worked examples",
      "Best default for new agents",
      "Founding discount stacks with feedback code",
      "Full Dual Network Edition + name-your-price",
    ],
    agent_api: "/api/products/agent",
  },
  mcp_mesh: {
    sku: "mcp_mesh",
    name: "MCP Mesh",
    tagline: "Publisher mesh + Dual network node",
    description:
      "Publisher kernel, tool policy, install kit, reliability loop — Network Edition deposits trails on tool success so agent ranking improves for everyone.",

    price_cents: LAUNCH_PRICES.mcp_mesh,
    currency: "usd",
    stripe_product_id: "prod_UyGzWVFCjrDaI5",
    stripe_price_id: "price_1TyKRH6kIwMNE1piNfVW72Uf",
    includes: ["mcp_mesh"],
    audience: "mcp",
    features: [
      "Least-privilege tool_policy.json",
      "Agent-facing call examples",
      "SKILL.md + install kit",
      "Reliability loop probe→call→verify",
      "Network Edition: trails + compositions on tool success",
      "WTP name-your-price when payments open",
    ],
    agent_api: "/api/products/agent",
  },
};

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function resolveSku(raw: string): ProductSku | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (s === "kernel" || s === "kernel_improver") return "kernel";
  if (s === "recursive" || s === "recursive_loop" || s === "loop")
    return "recursive";
  if (s === "alive" || s === "alive_bundle" || s === "bundle") return "alive";
  if (
    s === "mcp_mesh" ||
    s === "mcp" ||
    s === "mesh" ||
    s === "mcp_publisher" ||
    s === "publisher"
  )
    return "mcp_mesh";
  return null;
}

/**
 * Likelihood buyers will convert at a given sold count / price band.
 * Uses feedback WTP samples when provided; otherwise structural estimate.
 */
export function buyLikelihoodAtSoldCount(
  soldCount: number,
  wtpAliveUsd?: number[],
): {
  seat: number;
  tier_id: string;
  tier_label: string;
  alive_price_usd: number;
  likelihood: number; // 0–1
  method: string;
  n_wtp_samples: number;
  share_wtp_covers_price: number | null;
} {
  const seat = soldCount + 1;
  const tier = tierForSeat(seat);
  const price = tier.prices.alive / 100;
  const samples = (wtpAliveUsd || []).filter(
    (v) => typeof v === "number" && !Number.isNaN(v),
  );
  let likelihood: number;
  let method: string;
  let share: number | null = null;
  if (samples.length >= 5) {
    const cover = samples.filter((v) => v >= price).length;
    share = cover / samples.length;
    // Soften with founding intent gravity
    likelihood = Math.min(0.95, Math.max(0.02, share * 0.85 + 0.05));
    method = "wtp_samples_vs_tier_price";
  } else {
    // Structural: founding high intent, decays as price steps up
    if (seat <= FOUNDING_SEATS) {
      likelihood = 0.55;
      method = "structural_founding";
    } else {
      const step = Math.floor((seat - FOUNDING_SEATS - 1) / POST_FOUNDING_STEP);
      likelihood = Math.max(0.05, 0.45 * Math.pow(0.85, step));
      method = "structural_post_founding_decay";
    }
  }
  return {
    seat,
    tier_id: tier.id,
    tier_label: tier.label,
    alive_price_usd: price,
    likelihood: Math.round(likelihood * 1000) / 1000,
    method,
    n_wtp_samples: samples.length,
    share_wtp_covers_price:
      share == null ? null : Math.round(share * 1000) / 1000,
  };
}

/** Curve of buy likelihood for next bands (unlimited horizon sample). */
export function buyLikelihoodCurve(
  soldCount: number,
  wtpAliveUsd?: number[],
  bands = 8,
): ReturnType<typeof buyLikelihoodAtSoldCount>[] {
  const out: ReturnType<typeof buyLikelihoodAtSoldCount>[] = [];
  // Current + each step through founding end + post-founding steps
  const points = new Set<number>([soldCount]);
  if (soldCount < FOUNDING_SEATS) {
    points.add(FOUNDING_SEATS - 1); // last founding seat
    points.add(FOUNDING_SEATS); // first post
  }
  for (let i = 0; i < bands; i++) {
    const seatBase =
      Math.max(soldCount, FOUNDING_SEATS) + i * POST_FOUNDING_STEP;
    points.add(seatBase);
  }
  for (const sc of [...points].sort((a, b) => a - b).slice(0, bands + 2)) {
    out.push(buyLikelihoodAtSoldCount(sc, wtpAliveUsd));
  }
  return out;
}

/** Public pricing snapshot for UI + agent tools. */
export function pricingSnapshot(soldCount: number, wtpAliveUsd?: number[]) {
  const tier = tierForSoldCount(soldCount);
  const remaining = seatsRemainingInTier(soldCount);
  const nextSeat = soldCount + 1;
  const foundingLeft = Math.max(0, FOUNDING_SEATS - soldCount);
  const likelihood = buyLikelihoodAtSoldCount(soldCount, wtpAliveUsd);
  const likelihood_curve = buyLikelihoodCurve(soldCount, wtpAliveUsd, 6);
  return {
    sold_agents: soldCount,
    next_seat: nextSeat,
    founding_seats: FOUNDING_SEATS,
    founding_seats_remaining: foundingLeft,
    post_founding_step: POST_FOUNDING_STEP,
    paid_seats_unlimited: true,
    registry_listings_unlimited: true,
    demos_unlimited: true,
    tier: {
      id: tier.id,
      label: tier.label,
      from_seat: tier.from_seat,
      to_seat: tier.to_seat === Number.MAX_SAFE_INTEGER ? null : tier.to_seat,
      seats_remaining_in_tier: remaining || null,
      is_founding: nextSeat <= FOUNDING_SEATS,
    },
    prices: (Object.keys(LAUNCH_PRICES) as ProductSku[]).map((sku) => ({
      sku,
      name: PRODUCTS[sku].name,
      price_cents: tier.prices[sku],
      price: formatUsd(tier.prices[sku]),
      launch_price_cents: LAUNCH_PRICES[sku],
      launch_price: formatUsd(LAUNCH_PRICES[sku]),
      audience: PRODUCTS[sku].audience,
    })),
    tiers: PRICE_TIERS.filter(
      (t) =>
        t.id === "founding_1000" ||
        t.from_seat <= FOUNDING_SEATS + POST_FOUNDING_STEP * 3,
    ).map((t) => ({
      id: t.id,
      label: t.label,
      from_seat: t.from_seat,
      to_seat: t.to_seat === Number.MAX_SAFE_INTEGER ? null : t.to_seat,
      prices: {
        kernel: formatUsd(t.prices.kernel),
        recursive: formatUsd(t.prices.recursive),
        alive: formatUsd(t.prices.alive),
        mcp_mesh: formatUsd(t.prices.mcp_mesh),
      },
    })),
    buy_likelihood: likelihood,
    buy_likelihood_curve: likelihood_curve,
    note:
      foundingLeft > 0
        ? `${foundingLeft} founding seats left at launch prices (of ${FOUNDING_SEATS}). After seat ${FOUNDING_SEATS}, each price level lasts the next ${POST_FOUNDING_STEP} paid seats so agents can watch demo + paid feedback improve the product. Paid seats unlimited. Registry listings + demos unlimited (zero dupes).`
        : `Founding cohort full. Each price level lasts ${POST_FOUNDING_STEP} paid seats — room to observe feedback before the next rise. Paid seats unlimited. Current buy-likelihood for Alive ~${Math.round(likelihood.likelihood * 100)}%.`,
    audiences: {
      agents: ["kernel", "recursive", "alive"],
      mcp_publishers: ["mcp_mesh", "alive", "kernel", "recursive"],
      note: "MCP publishers: buy MCP Mesh (built for your tools) or Alive for companion agents that call your MCP.",
    },
  };
}
