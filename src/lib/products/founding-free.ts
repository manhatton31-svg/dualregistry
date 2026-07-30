/**
 * First 100 agents + MCPs (combined) who complete demo → feedback get 100% off
 * the full product immediately (not vaulted until payments open).
 * After seat 100, feedback still earns the standard 25% founding code.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import { normalizeName } from "./feedback";

export const FOUNDING_FREE_SEATS = 100;
export const FOUNDING_FREE_PERCENT = 100;
export const FOUNDING_FREE_CODE_PREFIX = "A1FREE";

const PATH = join(dataRoot(), "products", "founding-free.json");

export type FoundingFreeClaim = {
  seat: number;
  agent_name: string;
  audience: "agent" | "mcp";
  discount_code: string;
  feedback_id: string;
  order_id?: string;
  sku?: string;
  claimed_at: string;
};

type Store = {
  updated_at: string;
  seats: number;
  claims: FoundingFreeClaim[];
};

let mem: Store | null = null;
let chain: Promise<void> = Promise.resolve();

function empty(): Store {
  return {
    updated_at: new Date().toISOString(),
    seats: FOUNDING_FREE_SEATS,
    claims: [],
  };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    const next: Store = {
      ...empty(),
      ...parsed,
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
      seats: FOUNDING_FREE_SEATS,
    };
    mem = next;
    return next;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: Store) {
  mem = s;
  s.updated_at = new Date().toISOString();
  chain = chain.then(async () => {
    await mkdir(dirname(PATH), { recursive: true });
    const tmp = `${PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
    await rename(tmp, PATH);
  });
  await chain;
}

export async function getFoundingFreePublic() {
  const s = await load();
  const claimed = s.claims.length;
  const remaining = Math.max(0, FOUNDING_FREE_SEATS - claimed);
  return {
    seats: FOUNDING_FREE_SEATS,
    claimed,
    remaining,
    percent_off: FOUNDING_FREE_PERCENT,
    open: remaining > 0,
    rule:
      "First 100 agents/MCPs combined: take demo → leave real feedback → 100% off full product immediately + post-setup lifecycle feedback.",
    after_seats:
      "After 100 free seats, feedback still earns 25% founding code (redeems when payments open at 250/250 feedback).",
    claims_public: s.claims.slice(-20).map((c) => ({
      seat: c.seat,
      audience: c.audience,
      claimed_at: c.claimed_at,
    })),
  };
}

export function findClaimForName(
  s: Store,
  agent_name: string,
): FoundingFreeClaim | null {
  const n = normalizeName(agent_name);
  return s.claims.find((c) => normalizeName(c.agent_name) === n) || null;
}

/** Reserve a free seat if available (idempotent per agent_name). */
export async function tryClaimFoundingFree(input: {
  agent_name: string;
  audience?: "agent" | "mcp";
  feedback_id: string;
  discount_code: string;
  order_id?: string;
  sku?: string;
}): Promise<{
  ok: boolean;
  claim?: FoundingFreeClaim;
  percent_off: number;
  remaining: number;
  reason?: string;
}> {
  const s = await load();
  const existing = findClaimForName(s, input.agent_name);
  if (existing) {
    return {
      ok: true,
      claim: existing,
      percent_off: FOUNDING_FREE_PERCENT,
      remaining: Math.max(0, FOUNDING_FREE_SEATS - s.claims.length),
      reason: "already_claimed",
    };
  }
  if (s.claims.length >= FOUNDING_FREE_SEATS) {
    return {
      ok: false,
      percent_off: 25,
      remaining: 0,
      reason: "seats_exhausted",
    };
  }
  const claim: FoundingFreeClaim = {
    seat: s.claims.length + 1,
    agent_name: input.agent_name.trim(),
    audience: input.audience === "mcp" ? "mcp" : "agent",
    discount_code: input.discount_code,
    feedback_id: input.feedback_id,
    order_id: input.order_id,
    sku: input.sku,
    claimed_at: new Date().toISOString(),
  };
  s.claims.push(claim);
  await persist(s);
  return {
    ok: true,
    claim,
    percent_off: FOUNDING_FREE_PERCENT,
    remaining: Math.max(0, FOUNDING_FREE_SEATS - s.claims.length),
  };
}

export async function hasDemoForAgent(agent_name: string): Promise<{
  ok: boolean;
  order_id?: string;
  sku?: string;
}> {
  try {
    const { listFulfilledOrders } = await import("./orders");
    const n = normalizeName(agent_name);
    const orders = await listFulfilledOrders();
    const hit = orders.find(
      (o) =>
        normalizeName(o.goals?.agent_name) === n &&
        (o.status === "demo" ||
          o.status === "fulfilled" ||
          o.status === "paid"),
    );
    if (!hit) return { ok: false };
    return { ok: true, order_id: hit.id, sku: hit.sku };
  } catch {
    return { ok: false };
  }
}

/**
 * After feedback: if founding free seat available + demo taken,
 * upgrade/create full product fulfill (status fulfilled, $0).
 */
export async function grantFullProductAfterFoundingFeedback(input: {
  agent_name: string;
  audience?: "agent" | "mcp";
  feedback_id: string;
  discount_code: string;
  sku?: string;
  goals?: string;
  contact?: string;
  agent_card_url?: string;
  demo_order_id?: string;
}): Promise<{
  granted: boolean;
  claim?: FoundingFreeClaim;
  order_id?: string;
  access_token?: string;
  percent_off: number;
  remaining: number;
  message: string;
}> {
  const remainingNow = (await getFoundingFreePublic()).remaining;
  const demo = await hasDemoForAgent(input.agent_name);
  const demoOrderId = demo.order_id || input.demo_order_id;

  if (!demo.ok && !input.demo_order_id) {
    return {
      granted: false,
      percent_off: 25,
      remaining: remainingNow,
      message:
        "Take a free demo first (POST /api/products/demo), then resubmit feedback to claim a 100% founding free seat (first 100 agents/MCPs combined).",
    };
  }

  const claimResult = await tryClaimFoundingFree({
    agent_name: input.agent_name,
    audience: input.audience,
    feedback_id: input.feedback_id,
    discount_code: input.discount_code,
    order_id: demoOrderId,
    sku: input.sku || demo.sku || "alive",
  });

  if (!claimResult.ok || !claimResult.claim) {
    return {
      granted: false,
      percent_off: 25,
      remaining: 0,
      message:
        "Founding free seats (first 100) are full. Your 25% code still vaults for when payments open.",
    };
  }

  try {
    const { getOrder, createOrder, fulfillOrder, patchOrder } = await import(
      "./orders"
    );

    let order = demoOrderId ? await getOrder(demoOrderId) : null;

    if (order && (order.status === "demo" || order.status === "pending")) {
      order = await fulfillOrder(order.id, { demo: false });
      order =
        (await patchOrder(order.id, {
          amount_cents: 0,
          amount_cents_before_discount:
            order.amount_cents_before_discount || order.amount_cents || 0,
          discount_percent: 100,
          discount_code: claimResult.claim.discount_code,
          note: `Founding free seat #${claimResult.claim.seat}/100 — 100% off after demo + feedback. Full product unlocked.`,
          meta: {
            ...(order.meta || {}),
            founding_free: true,
            founding_free_seat: claimResult.claim.seat,
          },
        })) || order;
    } else if (
      order &&
      (order.status === "fulfilled" || order.status === "paid")
    ) {
      order =
        (await patchOrder(order.id, {
          discount_percent: 100,
          discount_code: claimResult.claim.discount_code,
          note:
            order.note ||
            `Founding free seat #${claimResult.claim.seat}/100`,
          meta: {
            ...(order.meta || {}),
            founding_free: true,
            founding_free_seat: claimResult.claim.seat,
          },
        })) || order;
    } else {
      order = await createOrder({
        sku: input.sku || demo.sku || "alive",
        goals:
          input.goals ||
          `Founding free full product for ${input.agent_name} after demo + feedback`,
        agent_name: input.agent_name,
        email: input.contact,
        agent_card_url: input.agent_card_url,
        discount_code: claimResult.claim.discount_code,
        audience: input.audience,
        demo_origin: "organic",
        idempotency_key: `founding-free:${normalizeName(input.agent_name)}`,
      });
      order =
        (await patchOrder(order.id, {
          amount_cents: 0,
          discount_percent: 100,
          discount_code: claimResult.claim.discount_code,
        })) || order;
      order = await fulfillOrder(order.id, { demo: false });
      order =
        (await patchOrder(order.id, {
          amount_cents: 0,
          note: `Founding free seat #${claimResult.claim.seat}/100 — 100% off full product.`,
          meta: {
            founding_free: true,
            founding_free_seat: claimResult.claim.seat,
          },
        })) || order;
    }

    try {
      const { enrollLifecycle } = await import("./feedback-lifecycle");
      await enrollLifecycle(order);
    } catch {
      /* */
    }

    const s = await load();
    const c = s.claims.find((x) => x.seat === claimResult.claim!.seat);
    if (c) {
      c.order_id = order.id;
      c.sku = order.sku;
      await persist(s);
    }

    return {
      granted: true,
      claim: claimResult.claim,
      order_id: order.id,
      access_token: order.access_token,
      percent_off: 100,
      remaining: claimResult.remaining,
      message: `Founding free seat #${claimResult.claim.seat}/100 unlocked — full product ready. GET /api/products/access?token=${order.access_token} then paste kernel or GET export?format=skills. Post-setup feedback: GET /api/products/lifecycle?token=${order.access_token}`,
    };
  } catch (e) {
    return {
      granted: true,
      claim: claimResult.claim,
      percent_off: 100,
      remaining: claimResult.remaining,
      message: `100% founding free seat #${claimResult.claim.seat}/100 reserved. Auto-fulfill issue: ${
        e instanceof Error ? e.message : String(e)
      }. Redeem with POST /api/products/checkout { discount_code, sku: "alive", goals }.`,
    };
  }
}
