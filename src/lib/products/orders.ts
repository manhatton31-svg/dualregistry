/**
 * Local order + access-token store for product fulfillment.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { dataRoot } from "@/lib/data-root";
import {
  PRODUCTS,
  type ProductSku,
  resolveSku,
  priceCentsForSku,
  tierForSoldCount,
} from "./catalog";
import {
  buildArtifacts,
  type GoalsInput,
  KERNEL_VERSION,
  LOOP_VERSION,
  ALIVE_VERSION,
  MCP_MESH_VERSION,
} from "./generate";

const PATH = join(dataRoot(), "products", "orders.json");

export type OrderStatus = "pending" | "paid" | "fulfilled" | "failed" | "demo";

export type ProductOrder = {
  id: string;
  sku: ProductSku;
  status: OrderStatus;
  email?: string;
  goals: GoalsInput;
  access_token: string;
  amount_cents: number;
  currency: string;
  /** 1-based founding seat; set at order create from paid cohort size. */
  seat_number?: number;
  price_tier_id?: string;
  price_tier_label?: string;
  stripe_session_id?: string;
  stripe_payment_intent?: string;
  payment_url?: string;
  artifacts?: unknown;
  created_at: string;
  paid_at?: string;
  fulfilled_at?: string;
  note?: string;
  agent_card_url?: string;
  callback_url?: string;
  callback_sent_at?: string;
  idempotency_key?: string;
  discount_code?: string;
  discount_percent?: number;
  amount_cents_before_discount?: number;
  /** balanced | efficiency | max — Alive Efficiency / Alive Max */
  cost_mode?: "balanced" | "efficiency" | "max";
  /** Who took the demo/purchase path — agent runtime vs MCP publisher */
  audience?: "agent" | "mcp";
  /**
   * Product generator version at fulfillment time.
   * Re-demo + re-feedback allowed when this advances (e.g. 2.2 → 2.3).
   */
  product_version?: string;
  /**
   * How this demo was created:
   *  self_serve — agent/MCP called checkout themselves
   *  invited — system feedback-drive / growth seeded
   *  organic — reserved for external referrals
   */
  demo_origin?: "self_serve" | "invited" | "organic" | "platform_qa";
  /** Internal flags e.g. platform_dogfood — never public */
  meta?: Record<string, unknown>;
};

type Store = {
  orders: Record<string, ProductOrder>;
  by_token: Record<string, string>;
  by_idempotency: Record<string, string>;
  updated_at: string;
};

let mem: Store | null = null;
let chain: Promise<void> = Promise.resolve();

function empty(): Store {
  return {
    orders: {},
    by_token: {},
    by_idempotency: {},
    updated_at: new Date().toISOString(),
  };
}

/** Live generator version stamped on every order/demo */
export function productVersionForSku(sku: string): string {
  if (sku === "mcp_mesh") return MCP_MESH_VERSION;
  if (sku === "kernel") return KERNEL_VERSION;
  if (sku === "recursive") return LOOP_VERSION;
  return ALIVE_VERSION;
}

/** Current demo generation for agents (Alive) and MCPs (Mesh) */
export function currentDemoVersion(audience: "agent" | "mcp"): string {
  return audience === "mcp" ? MCP_MESH_VERSION : ALIVE_VERSION;
}

async function load(force = false): Promise<Store> {
  if (mem && !force) return mem;
  // Prefer durable production blob when present (GitHub → /tmp)
  try {
    const { loadDurableJson } = await import("@/lib/agents1/durable-json");
    const remote = await loadDurableJson<Partial<Store>>(
      "products-orders.json",
      () => ({}),
    );
    if (remote && remote.orders && Object.keys(remote.orders).length) {
      mem = {
        ...empty(),
        ...remote,
        orders: remote.orders || {},
        by_token: remote.by_token || {},
        by_idempotency: remote.by_idempotency || {},
      };
      return mem;
    }
  } catch {
    /* */
  }
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...(JSON.parse(raw) as Store) };
    if (!mem.by_idempotency) mem.by_idempotency = {};
    if (!mem.by_token) mem.by_token = {};
    if (!mem.orders) mem.orders = {};
    return mem;
  } catch {
    if (!mem) mem = empty();
    return mem;
  }
}

/** Force re-read orders from disk (dashboard engagement / multi-process). */
export async function reloadOrdersFromDisk() {
  return load(true);
}

async function persist(s: Store) {
  mem = s;
  s.updated_at = new Date().toISOString();
  chain = chain.then(async () => {
    await mkdir(dirname(PATH), { recursive: true });
    const tmp = `${PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
    await rename(tmp, PATH);
    // Production: also durable to GitHub via token or cron commit path
    try {
      if (process.env.VERCEL || process.env.AGENTS1_CANONICAL_WRITER === "1") {
        const { saveDurableJson } = await import("@/lib/agents1/durable-json");
        // Keep durable file lean — only last 500 orders for hydrate
        const ids = Object.keys(s.orders || {});
        const keep = ids.slice(-500);
        const slimOrders: Record<string, ProductOrder> = {};
        for (const id of keep) slimOrders[id] = s.orders[id]!;
        await saveDurableJson("products-orders.json", {
          orders: slimOrders,
          by_token: s.by_token,
          by_idempotency: s.by_idempotency,
          updated_at: s.updated_at,
        });
      }
    } catch {
      /* */
    }
  });
  await chain;
}

function newId() {
  return `ord_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function newToken() {
  return `a1_${randomBytes(24).toString("base64url")}`;
}

export async function countPaidSeats(): Promise<number> {
  const s = await load();
  let n = 0;
  for (const o of Object.values(s.orders)) {
    if (o.status === "paid" || o.status === "fulfilled") {
      if (o.amount_cents > 0 && !o.note?.toLowerCase().includes("demo")) n++;
      else if (o.status === "paid") n++;
    }
  }
  return n;
}

export async function createOrder(input: {
  sku: string;
  goals: string;
  agent_name?: string;
  constraints?: string;
  domain?: string;
  success_metrics?: string;
  tools_hint?: string;
  preset?: string;
  email?: string;
  agent_card_url?: string;
  callback_url?: string;
  idempotency_key?: string;
  discount_code?: string;
  cost_mode?: string;
  audience?: "agent" | "mcp";
  product_version?: string;
  demo_origin?: "self_serve" | "invited" | "organic" | "platform_qa";
}): Promise<ProductOrder> {

  const sku = resolveSku(input.sku);
  if (!sku) throw new Error("Invalid product sku");
  if (!input.goals || input.goals.trim().length < 8) {
    throw new Error(
      "Goals required (at least a short paragraph or bullet list)",
    );
  }
  const s = await load();
  if (input.idempotency_key) {
    const existingId = s.by_idempotency[input.idempotency_key];
    if (existingId && s.orders[existingId]) return s.orders[existingId];
  }
  const product = PRODUCTS[sku];
  const sold = await countPaidSeats();
  const tier = tierForSoldCount(sold);
  let amount = priceCentsForSku(sku, sold);
  const amount_before = amount;
  let discount_percent: number | undefined;
  let discount_code: string | undefined;
  if (input.discount_code?.trim()) {
    try {
      const { lookupDiscountCode } = await import("./feedback");
      const d = await lookupDiscountCode(input.discount_code.trim());
      if (d && !d.redeemed_at) {
        discount_percent = d.percent_off;
        discount_code = d.code;
        amount = Math.max(
          0,
          Math.round(amount * (1 - d.percent_off / 100)),
        );
      }
    } catch {
      /* */
    }
  }

  const cost_mode =
    input.cost_mode === "efficiency" || input.cost_mode === "max"
      ? input.cost_mode
      : input.cost_mode === "balanced"
        ? "balanced"
        : undefined;

  const product_version =
    input.product_version || productVersionForSku(sku);

  const order: ProductOrder = {
    id: newId(),
    sku,
    status: "pending",
    demo_origin: input.demo_origin,
    email: input.email?.trim() || undefined,
    goals: {
      agent_name: input.agent_name?.trim(),
      goals: input.goals.trim(),
      constraints: input.constraints?.trim(),
      domain: input.domain?.trim(),
      success_metrics: input.success_metrics?.trim(),
      tools_hint: input.tools_hint?.trim(),
      preset: input.preset?.trim(),
    },
    access_token: newToken(),
    amount_cents: amount,
    currency: product.currency,
    seat_number: sold + 1,
    price_tier_id: tier.id,
    price_tier_label: tier.label,
    created_at: new Date().toISOString(),
    agent_card_url: input.agent_card_url?.trim() || undefined,
    callback_url: input.callback_url?.trim() || undefined,
    idempotency_key: input.idempotency_key,
    discount_code,
    discount_percent,
    amount_cents_before_discount:
      discount_percent != null ? amount_before : undefined,
    cost_mode,
    audience: input.audience,
    product_version,
  };

  s.orders[order.id] = order;
  s.by_token[order.access_token] = order.id;
  if (input.idempotency_key) {
    s.by_idempotency[input.idempotency_key] = order.id;
  }
  s.updated_at = new Date().toISOString();
  await persist(s);
  return order;
}

export async function getOrder(id: string): Promise<ProductOrder | null> {
  return (await load()).orders[id] || null;
}

/** Merge fields into an existing order and persist. */
export async function patchOrder(
  id: string,
  patch: Partial<ProductOrder>,
): Promise<ProductOrder | null> {
  const s = await load();
  const order = s.orders[id];
  if (!order) return null;
  const next = { ...order, ...patch, id: order.id, access_token: order.access_token };
  s.orders[id] = next;
  s.updated_at = new Date().toISOString();
  await persist(s);
  return next;
}

export async function getOrderByToken(
  token: string,
): Promise<ProductOrder | null> {
  const s = await load();
  const id = s.by_token[token];
  if (!id) return null;
  return s.orders[id] || null;
}

export async function listFulfilledOrders(): Promise<ProductOrder[]> {
  const s = await load();
  return Object.values(s.orders)
    .filter(
      (o) =>
        o.status === "fulfilled" ||
        o.status === "demo" ||
        o.status === "paid",
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function fulfillOrder(
  id: string,
  opts?: {
    demo?: boolean;
    stripe_session_id?: string;
    stripe_payment_intent?: string;
  },
): Promise<ProductOrder> {
  let s = await load();
  let order = s.orders[id];
  if (!order) {
    // Race with concurrent writers / dashboard reloadOrdersFromDisk
    s = await load(true);
    order = s.orders[id];
  }
  if (!order) throw new Error("Order not found");
  if (order.status === "fulfilled" && order.artifacts) return order;

  // Stamp version at fulfill time so re-demos track generator ship
  if (!order.product_version) {
    order.product_version = productVersionForSku(order.sku);
  }

  const artifacts = await buildArtifacts(order.sku, order.goals, {
    orderId: order.id,
  });
  order.status = opts?.demo ? "demo" : "fulfilled";
  order.artifacts = artifacts;
  order.paid_at = order.paid_at || new Date().toISOString();
  order.fulfilled_at = new Date().toISOString();
  if (opts?.stripe_session_id) order.stripe_session_id = opts.stripe_session_id;
  if (opts?.stripe_payment_intent)
    order.stripe_payment_intent = opts.stripe_payment_intent;
  if (opts?.demo) {
    order.note =
      order.note ||
      `Demo fulfillment · product v${order.product_version}. Leave feedback for 25% founding code; re-demo free when product ships a new version.`;
  }
  s.orders[id] = order;
  s.updated_at = new Date().toISOString();
  await persist(s);
  return order;
}

export async function markPaid(
  id: string,
  opts?: {
    stripe_session_id?: string;
    stripe_payment_intent?: string;
  },
): Promise<ProductOrder> {
  const s = await load();
  const order = s.orders[id];
  if (!order) throw new Error("Order not found");
  order.status = "paid";
  order.paid_at = new Date().toISOString();
  if (opts?.stripe_session_id) order.stripe_session_id = opts.stripe_session_id;
  if (opts?.stripe_payment_intent)
    order.stripe_payment_intent = opts.stripe_payment_intent;
  s.orders[id] = order;
  await persist(s);
  return fulfillOrder(id, opts);
}

export async function updateOrderPaymentUrl(
  id: string,
  url: string,
  sessionId?: string,
): Promise<ProductOrder | null> {
  const s = await load();
  const order = s.orders[id];
  if (!order) return null;
  order.payment_url = url;
  if (sessionId) order.stripe_session_id = sessionId;
  s.orders[id] = order;
  await persist(s);
  return order;
}

export async function regenerateArtifacts(
  token: string,
  goals?: Partial<GoalsInput> & { goals?: string },
): Promise<ProductOrder> {
  const order = await getOrderByToken(token);
  if (!order) throw new Error("Invalid access token");
  if (
    order.status !== "fulfilled" &&
    order.status !== "demo" &&
    order.status !== "paid"
  ) {
    throw new Error("Order not paid");
  }
  if (goals) {
    order.goals = {
      ...order.goals,
      ...goals,
      goals: goals.goals?.trim() || order.goals.goals,
    };
  }
  const s = await load();
  order.product_version = productVersionForSku(order.sku);
  order.artifacts = await buildArtifacts(order.sku, order.goals, {
    orderId: order.id,
  });
  order.fulfilled_at = new Date().toISOString();
  s.orders[order.id] = order;
  await persist(s);
  return order;
}

export function publicOrder(order: ProductOrder) {
  const open =
    order.status === "fulfilled" ||
    order.status === "demo" ||
    order.status === "paid";
  const free =
    Boolean(order.meta?.founding_free) ||
    order.discount_percent === 100 ||
    (order.amount_cents === 0 && order.status === "fulfilled");
  return {
    id: order.id,
    sku: order.sku,
    product: PRODUCTS[order.sku]?.name,
    status: order.status,
    amount_cents: order.amount_cents,
    currency: order.currency,
    seat_number: order.seat_number,
    price_tier_id: order.price_tier_id,
    price_tier_label: order.price_tier_label,
    access_token: open ? order.access_token : undefined,
    payment_url: order.payment_url,
    goals: order.goals,
    created_at: order.created_at,
    paid_at: order.paid_at,
    fulfilled_at: order.fulfilled_at,
    note: order.note,
    audience: order.audience,
    cost_mode: order.cost_mode,
    product_version: order.product_version,
    discount_percent: order.discount_percent,
    founding_free: free,
    founding_free_seat: order.meta?.founding_free_seat,
    stripe_required: false,
    use_now: open
      ? {
          access: `/api/products/access?token=${order.access_token}`,
          export: `/api/products/export?token=${order.access_token}&format=skills`,
          lifecycle: `/api/products/lifecycle?token=${order.access_token}`,
          note: free
            ? "Full product unlocked. Open access URL to use."
            : order.status === "demo"
              ? "Demo unlocked. Leave feedback for a free full seat (first 100)."
              : "Open access URL with token to use.",
        }
      : undefined,
    artifacts: open ? order.artifacts : undefined,
  };
}

/** Patch fields on an existing order (e.g. invite confirm → self_serve). */
export async function updateOrderFields(
  id: string,
  patch: Partial<
    Pick<
      ProductOrder,
      | "demo_origin"
      | "note"
      | "callback_url"
      | "audience"
      | "product_version"
      | "meta"
    >
  > & { invited_confirmed?: boolean },
): Promise<ProductOrder | null> {
  const s = await load(true);
  const o = s.orders[id];
  if (!o) return null;
  if (patch.demo_origin) o.demo_origin = patch.demo_origin;
  if (patch.note !== undefined) o.note = patch.note;
  if (patch.callback_url !== undefined) o.callback_url = patch.callback_url;
  if (patch.audience) o.audience = patch.audience;
  if (patch.product_version) o.product_version = patch.product_version;
  if (patch.meta) o.meta = { ...(o.meta || {}), ...patch.meta };
  if (patch.invited_confirmed) {
    o.note = [o.note, "invited_confirmed=1"].filter(Boolean).join(" · ");
    o.demo_origin = "self_serve";
  }
  s.orders[id] = o;
  s.updated_at = new Date().toISOString();
  await persist(s);
  return o;
}
