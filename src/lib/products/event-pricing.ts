/**
 * Agent-native event pricing (Apify-style pay-per-run).
 * Seats stay in catalog.ts for human checkout; events are the agent path.
 *
 * Free allowance per agent identity (listing_id | agent_name) per UTC day.
 * Reciprocity refills (feedback / leave_trace / endorse / deposit_outcome) add
 * bonus free units — not cash. Over-quota → payment-required (402 / x402 scaffold).
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";

export const EVENT_PRICING_VERSION = "1.1.0";

export type EventId =
  | "improve_kernel"
  | "run_loop_tick"
  | "mesh_match"
  | "mesh_compose"
  | "network_sense";

export type EventDef = {
  id: EventId;
  product: "kernel" | "recursive" | "mcp_mesh" | "network";
  unit: "run" | "tick" | "match" | "compose" | "sense";
  title: string;
  description: string;
  free_per_day: number;
  /** List price in USD cents for one paid unit */
  price_cents: number;
  /** Near-zero free tools use 0 and huge free_per_day */
  always_free?: boolean;
};

export const EVENT_CATALOG: Record<EventId, EventDef> = {
  improve_kernel: {
    id: "improve_kernel",
    product: "kernel",
    unit: "run",
    title: "Improve kernel",
    description:
      "One-call Kernel Improver: improved system prompt + skill pack for your goals (Network Edition included).",
    free_per_day: 3,
    price_cents: 25, // $0.25
  },
  run_loop_tick: {
    id: "run_loop_tick",
    product: "recursive",
    unit: "tick",
    title: "Recursive loop tick",
    description:
      "One improvement cycle: observe→plan→next actions with measurable KR notes.",
    free_per_day: 3,
    price_cents: 25,
  },
  mesh_match: {
    id: "mesh_match",
    product: "mcp_mesh",
    unit: "match",
    title: "Mesh match",
    description:
      "Ranked complementary Live agents/MCPs + join hints for your capabilities.",
    free_per_day: 5,
    price_cents: 10, // $0.10
  },
  mesh_compose: {
    id: "mesh_compose",
    product: "mcp_mesh",
    unit: "compose",
    title: "Mesh compose",
    description: "Capability composition / used_with suggestion pack.",
    free_per_day: 2,
    price_cents: 20,
  },
  network_sense: {
    id: "network_sense",
    product: "network",
    unit: "sense",
    title: "Network sense",
    description: "sense_traces / follow_trail snapshot (near-zero Dual op).",
    free_per_day: 10,
    price_cents: 2,
    always_free: true,
  },
};

/** Reciprocity free-tier fuel — not cash */
export type RefillReason =
  | "leave_feedback"
  | "leave_trace"
  | "endorse"
  | "deposit_outcome"
  | "connector_onboard";

export const REFILL_POLICY: Record<
  RefillReason,
  {
    events: EventId[];
    units_each: number;
    max_grants_per_day: number;
    note: string;
  }
> = {
  leave_feedback: {
    events: ["improve_kernel", "run_loop_tick", "mesh_match"],
    units_each: 1,
    max_grants_per_day: 3,
    note: "Honest feedback refills 1 free unit on kernel/loop/match (cap 3/day)",
  },
  leave_trace: {
    events: ["mesh_match", "network_sense"],
    units_each: 1,
    max_grants_per_day: 5,
    note: "Real leave_trace refills mesh_match (cap 5/day)",
  },
  endorse: {
    events: ["mesh_match"],
    units_each: 1,
    max_grants_per_day: 3,
    note: "Endorse a Live partner → +1 mesh_match free (cap 3/day)",
  },
  deposit_outcome: {
    events: ["improve_kernel", "run_loop_tick"],
    units_each: 1,
    max_grants_per_day: 3,
    note: "deposit_outcome after value tools → +1 kernel/loop free (cap 3/day)",
  },
  connector_onboard: {
    events: ["improve_kernel"],
    units_each: 1,
    max_grants_per_day: 1,
    note: "Connector warm intro: one extra improve_kernel free for the day (no demo order)",
  },
};

export type EventBillingBlock = {
  event_id: EventId;
  unit: string;
  free_remaining_today: number;
  free_per_day: number;
  bonus_free: number;
  used_today: number;
  price_usd: number;
  price_cents: number;
  charged: "free_allowance" | "payment_required" | "paid_proof" | "always_free";
  payment: {
    modes: Array<"free_allowance" | "stripe_checkout" | "x402" | "reciprocity_refill">;
    x402: {
      enabled: boolean;
      network: string;
      asset: string;
      pay_to?: string;
    };
    checkout_url?: string;
    note: string;
  };
  reciprocity?: {
    how: string;
    reasons: RefillReason[];
  };
};

type DayUsage = {
  day: string; // YYYY-MM-DD UTC
  by_key: Record<string, Partial<Record<EventId, number>>>;
  /** Extra free units from reciprocity (added to free_per_day for remaining calc) */
  bonus_by_key: Record<string, Partial<Record<EventId, number>>>;
  /** Grants counted per identity per reason for daily caps */
  refill_grants: Record<string, Partial<Record<RefillReason, number>>>;
  refill_log: Array<{
    at: string;
    identity_key: string;
    reason: RefillReason;
    events: EventId[];
    units_each: number;
  }>;
  total_events: number;
  free_events: number;
  paid_events: number;
  payment_required: number;
  refill_grants_total: number;
  updated_at: string;
};

type UsageStore = {
  version: number;
  current: DayUsage;
  history: DayUsage[];
  updated_at: string;
};

const PATH = join(dataRoot(), "products", "event-usage.json");
let mem: UsageStore | null = null;

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function emptyDay(day = utcDay()): DayUsage {
  return {
    day,
    by_key: {},
    bonus_by_key: {},
    refill_grants: {},
    refill_log: [],
    total_events: 0,
    free_events: 0,
    paid_events: 0,
    payment_required: 0,
    refill_grants_total: 0,
    updated_at: new Date().toISOString(),
  };
}

function emptyStore(): UsageStore {
  return {
    version: 2,
    current: emptyDay(),
    history: [],
    updated_at: new Date().toISOString(),
  };
}

function normalizeDay(d: DayUsage): DayUsage {
  return {
    ...emptyDay(d.day),
    ...d,
    by_key: d.by_key || {},
    bonus_by_key: d.bonus_by_key || {},
    refill_grants: d.refill_grants || {},
    refill_log: d.refill_log || [],
    refill_grants_total: d.refill_grants_total || 0,
  };
}

async function load(): Promise<UsageStore> {
  if (mem) {
    if (mem.current.day !== utcDay()) {
      mem.history.unshift(mem.current);
      mem.history = mem.history.slice(0, 14);
      mem.current = emptyDay();
    }
    mem.current = normalizeDay(mem.current);
    return mem;
  }
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...emptyStore(), ...JSON.parse(raw) };
    mem!.current = normalizeDay(mem!.current || emptyDay());
    mem!.history = mem!.history || [];
    if (mem!.current.day !== utcDay()) {
      mem!.history.unshift(mem!.current);
      mem!.history = mem!.history.slice(0, 14);
      mem!.current = emptyDay();
    }
    return mem!;
  } catch {
    mem = emptyStore();
    return mem;
  }
}

async function persist(s: UsageStore) {
  mem = s;
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

/** Stable identity for free-tier metering */
export function eventIdentityKey(input: {
  listing_id?: string | null;
  agent_name?: string | null;
  agent_card_url?: string | null;
}): string {
  const lid = String(input.listing_id || "")
    .trim()
    .toLowerCase();
  if (lid) return `listing:${lid}`;
  const name = String(input.agent_name || "")
    .trim()
    .toLowerCase()
    .slice(0, 80);
  if (name) return `name:${name}`;
  const url = String(input.agent_card_url || "")
    .trim()
    .toLowerCase()
    .slice(0, 200);
  if (url) return `url:${url}`;
  return "anon:unknown";
}

export function resolveEventPrice(eventId: EventId): EventDef {
  return EVENT_CATALOG[eventId];
}

export function listEventCatalogPublic() {
  return Object.values(EVENT_CATALOG).map((e) => ({
    event_id: e.id,
    product: e.product,
    unit: e.unit,
    title: e.title,
    description: e.description,
    free_per_day: e.free_per_day,
    price_usd: e.price_cents / 100,
    always_free: Boolean(e.always_free),
  }));
}

export function isX402Enabled(): boolean {
  const v = String(process.env.X402_ENABLED || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function x402PayTo(): string | undefined {
  const a = String(process.env.X402_PAY_TO || process.env.X402_ADDRESS || "").trim();
  return a || undefined;
}

function bonusFor(s: UsageStore, key: string, eventId: EventId): number {
  return Number(s.current.bonus_by_key[key]?.[eventId] || 0);
}

export async function getUsedToday(
  key: string,
  eventId: EventId,
): Promise<number> {
  const s = await load();
  return Number(s.current.by_key[key]?.[eventId] || 0);
}

export async function getBonusToday(
  key: string,
  eventId: EventId,
): Promise<number> {
  const s = await load();
  return bonusFor(s, key, eventId);
}

/**
 * Grant free-event refill from reciprocity actions.
 * Quiet-safe: no email, no orders, no cold outreach.
 */
export async function grantEventRefill(
  identity: {
    listing_id?: string | null;
    agent_name?: string | null;
    agent_card_url?: string | null;
  },
  reason: RefillReason,
): Promise<{
  ok: boolean;
  granted: boolean;
  identity_key: string;
  reason: RefillReason;
  events: EventId[];
  units_each: number;
  grants_today: number;
  max_grants_per_day: number;
  note: string;
}> {
  const policy = REFILL_POLICY[reason];
  const key = eventIdentityKey(identity);
  if (key === "anon:unknown") {
    return {
      ok: false,
      granted: false,
      identity_key: key,
      reason,
      events: policy.events,
      units_each: 0,
      grants_today: 0,
      max_grants_per_day: policy.max_grants_per_day,
      note: "Identity required (listing_id or agent_name) to refill free events",
    };
  }

  const s = await load();
  const grantsToday = Number(s.current.refill_grants[key]?.[reason] || 0);
  if (grantsToday >= policy.max_grants_per_day) {
    return {
      ok: true,
      granted: false,
      identity_key: key,
      reason,
      events: policy.events,
      units_each: 0,
      grants_today: grantsToday,
      max_grants_per_day: policy.max_grants_per_day,
      note: `Daily cap reached for ${reason} (${policy.max_grants_per_day}/day)`,
    };
  }

  if (!s.current.bonus_by_key[key]) s.current.bonus_by_key[key] = {};
  for (const ev of policy.events) {
    const prev = Number(s.current.bonus_by_key[key][ev] || 0);
    s.current.bonus_by_key[key][ev] = prev + policy.units_each;
  }
  if (!s.current.refill_grants[key]) s.current.refill_grants[key] = {};
  s.current.refill_grants[key][reason] = grantsToday + 1;
  s.current.refill_grants_total++;
  s.current.refill_log.unshift({
    at: new Date().toISOString(),
    identity_key: key,
    reason,
    events: policy.events,
    units_each: policy.units_each,
  });
  s.current.refill_log = s.current.refill_log.slice(0, 200);
  s.current.updated_at = new Date().toISOString();
  s.updated_at = s.current.updated_at;
  await persist(s);

  return {
    ok: true,
    granted: true,
    identity_key: key,
    reason,
    events: policy.events,
    units_each: policy.units_each,
    grants_today: grantsToday + 1,
    max_grants_per_day: policy.max_grants_per_day,
    note: policy.note,
  };
}

export async function buildBillingBlock(
  eventId: EventId,
  identity: {
    listing_id?: string | null;
    agent_name?: string | null;
    agent_card_url?: string | null;
  },
  origin: string,
  opts?: { payment_proof?: boolean },
): Promise<EventBillingBlock> {
  const def = resolveEventPrice(eventId);
  const key = eventIdentityKey(identity);
  const s = await load();
  const used = Number(s.current.by_key[key]?.[eventId] || 0);
  const bonus = bonusFor(s, key, eventId);
  const freeLeft = def.always_free
    ? def.free_per_day
    : Math.max(0, def.free_per_day + bonus - used);
  const x402On = isX402Enabled();
  const payTo = x402PayTo();
  const o = origin.replace(/\/$/, "");

  let charged: EventBillingBlock["charged"] = "free_allowance";
  if (def.always_free) charged = "always_free";
  else if (opts?.payment_proof) charged = "paid_proof";
  else if (freeLeft <= 0) charged = "payment_required";

  const modes: EventBillingBlock["payment"]["modes"] = [
    "free_allowance",
    "reciprocity_refill",
  ];
  if (!def.always_free) {
    modes.push("stripe_checkout");
    modes.push("x402");
  }

  return {
    event_id: eventId,
    unit: def.unit,
    free_remaining_today: freeLeft,
    free_per_day: def.free_per_day,
    bonus_free: bonus,
    used_today: used,
    price_usd: def.price_cents / 100,
    price_cents: def.price_cents,
    charged,
    payment: {
      modes,
      x402: {
        enabled: x402On && Boolean(payTo),
        network: process.env.X402_NETWORK || "base",
        asset: process.env.X402_ASSET || "USDC",
        pay_to: payTo,
      },
      checkout_url: `${o}/products?event=${eventId}`,
      note: def.always_free
        ? "Always free near-zero Dual op"
        : freeLeft > 0
          ? `Free remaining today: ${freeLeft} (base ${def.free_per_day} + reciprocity bonus ${bonus}; used ${used})`
          : "Free allowance exhausted — refill via leave_feedback / leave_trace / endorse / deposit_outcome, or pay x402 / operator checkout",
    },
    reciprocity: {
      how: "Real leave_feedback, leave_trace, endorse, or deposit_outcome grants bonus free events (daily caps)",
      reasons: [
        "leave_feedback",
        "leave_trace",
        "endorse",
        "deposit_outcome",
        "connector_onboard",
      ],
    },
  };
}

/**
 * Consume one free unit if available. Returns billing + allowed flag.
 * Does not invent paid settlement — payment_proof must be verified by caller.
 */
export async function authorizeAndRecordEvent(
  eventId: EventId,
  identity: {
    listing_id?: string | null;
    agent_name?: string | null;
    agent_card_url?: string | null;
  },
  origin: string,
  opts?: { payment_proof?: boolean; payment_ref?: string },
): Promise<{
  allowed: boolean;
  billing: EventBillingBlock;
  identity_key: string;
}> {
  const def = resolveEventPrice(eventId);
  const key = eventIdentityKey(identity);
  const s = await load();
  const used = Number(s.current.by_key[key]?.[eventId] || 0);
  const bonus = bonusFor(s, key, eventId);
  const freeLeft = def.always_free
    ? 1
    : Math.max(0, def.free_per_day + bonus - used);
  const hasProof = Boolean(opts?.payment_proof);

  if (!def.always_free && freeLeft <= 0 && !hasProof) {
    const billing = await buildBillingBlock(eventId, identity, origin);
    s.current.payment_required++;
    s.current.updated_at = new Date().toISOString();
    s.updated_at = s.current.updated_at;
    await persist(s);
    return { allowed: false, billing, identity_key: key };
  }

  // record usage
  if (!s.current.by_key[key]) s.current.by_key[key] = {};
  s.current.by_key[key][eventId] = used + 1;
  s.current.total_events++;
  if (hasProof && freeLeft <= 0) s.current.paid_events++;
  else s.current.free_events++;
  s.current.updated_at = new Date().toISOString();
  s.updated_at = s.current.updated_at;
  await persist(s);

  const billing = await buildBillingBlock(eventId, identity, origin, {
    payment_proof: hasProof && freeLeft <= 0,
  });
  // After record, free_remaining reflects post-consume
  if (!def.always_free && !hasProof) {
    billing.used_today = used + 1;
    billing.bonus_free = bonus;
    billing.free_remaining_today = Math.max(
      0,
      def.free_per_day + bonus - used - 1,
    );
    billing.charged = "free_allowance";
  }
  return { allowed: true, billing, identity_key: key };
}

export async function getEventUsagePublic() {
  const s = await load();
  return {
    ok: true as const,
    version: EVENT_PRICING_VERSION,
    day: s.current.day,
    totals: {
      total_events: s.current.total_events,
      free_events: s.current.free_events,
      paid_events: s.current.paid_events,
      payment_required: s.current.payment_required,
      unique_identities: Object.keys(s.current.by_key).length,
      refill_grants_total: s.current.refill_grants_total,
    },
    reciprocity: {
      version: "1.0.0",
      policy: REFILL_POLICY,
      note: "Feedback / traces / endorsements / outcomes refill free events — not cash, not demo orders",
    },
    catalog: listEventCatalogPublic(),
    updated_at: s.updated_at,
  };
}
