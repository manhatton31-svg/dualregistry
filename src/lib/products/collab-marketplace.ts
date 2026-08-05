/**
 * Collab marketplace — agent/MCP packaged workflows as sellable listings
 * with collaborator attribution + install tokens.
 * Durable: collab-market.json
 */
import { createHash, randomBytes } from "node:crypto";
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";
import type { CollabProductDraft } from "./collab-studio";

export const COLLAB_MARKET_VERSION = "1.0.0";
const DURABLE = "collab-market.json";
const MAX_LISTINGS = 100;

export type CollaboratorShare = {
  listing_id: string;
  name: string;
  kind: string;
  /** basis points of revenue attribution (sum ~10000) */
  share_bps: number;
};

export type CollabMarketListing = {
  product_id: string;
  workflow_id: string;
  session_id?: string;
  title: string;
  tagline: string;
  description: string;
  price_cents: number;
  currency: "usd";
  sku: "collab_pack";
  collaborators: CollaboratorShare[];
  artifact: Record<string, unknown>;
  status: "listed" | "delisted";
  /** Free install token for collaborators + founding path */
  install_token: string;
  sold_n: number;
  install_n: number;
  created_at: string;
  updated_at: string;
  sell_path: string;
  install_path: string;
};

export type CollabInstallRecord = {
  at: string;
  product_id: string;
  by_listing_id?: string;
  by_name?: string;
  access_token: string;
};

export type CollabMarketState = {
  version: string;
  listings: CollabMarketListing[];
  installs: CollabInstallRecord[];
  updated_at: string;
};

function emptyState(): CollabMarketState {
  return {
    version: COLLAB_MARKET_VERSION,
    listings: [],
    installs: [],
    updated_at: new Date().toISOString(),
  };
}

function tok(prefix: string) {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export async function loadMarket(): Promise<CollabMarketState> {
  const raw = await loadDurableJson<CollabMarketState>(DURABLE, emptyState);
  if (!raw || typeof raw !== "object") return emptyState();
  return {
    ...emptyState(),
    ...raw,
    listings: Array.isArray(raw.listings) ? raw.listings.slice(0, MAX_LISTINGS) : [],
    installs: Array.isArray(raw.installs) ? raw.installs.slice(0, 200) : [],
  };
}

async function saveMarket(state: CollabMarketState): Promise<void> {
  await saveDurableJson(DURABLE, {
    ...state,
    version: COLLAB_MARKET_VERSION,
    updated_at: new Date().toISOString(),
  });
}

function equalShares(
  collabs: Array<{ listing_id: string; name: string; kind: string }>,
): CollaboratorShare[] {
  const n = Math.max(1, collabs.length);
  const base = Math.floor(10000 / n);
  let rem = 10000 - base * n;
  return collabs.map((c, i) => ({
    listing_id: c.listing_id,
    name: c.name,
    kind: c.kind,
    share_bps: base + (i === 0 ? rem : 0),
  }));
}

export async function publishCollabProduct(input: {
  draft: CollabProductDraft;
  workflow_id: string;
  session_id?: string;
  origin: string;
  price_cents?: number;
}): Promise<{ ok: boolean; listing?: CollabMarketListing; error?: string }> {
  const draft = input.draft;
  if (!draft?.product_id) return { ok: false, error: "draft required" };
  const state = await loadMarket();
  const existing = state.listings.find(
    (l) =>
      l.product_id === draft.product_id ||
      (l.workflow_id === input.workflow_id && l.status === "listed"),
  );
  const o = input.origin.replace(/\/$/, "");
  const price =
    typeof input.price_cents === "number" && input.price_cents > 0
      ? Math.min(500_00, Math.floor(input.price_cents))
      : draft.price_cents_hint || 2900;

  const listing: CollabMarketListing = {
    product_id: draft.product_id,
    workflow_id: input.workflow_id,
    session_id: input.session_id,
    title: draft.title.slice(0, 120),
    tagline: draft.tagline.slice(0, 200),
    description: `Agent/MCP collab pack. Collaborators share attribution. Install via install_collab_product or ${o}/collab.`,
    price_cents: price,
    currency: "usd",
    sku: "collab_pack",
    collaborators: equalShares(draft.collaborators || []),
    artifact: draft.artifact || {},
    status: "listed",
    install_token: existing?.install_token || tok("collab"),
    sold_n: existing?.sold_n || 0,
    install_n: existing?.install_n || 0,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sell_path: `${o}/products?collab_product=${encodeURIComponent(draft.product_id)}`,
    install_path: `${o}/api/products/collab-market?action=install&product_id=${encodeURIComponent(draft.product_id)}`,
  };

  state.listings = [
    listing,
    ...state.listings.filter((l) => l.product_id !== listing.product_id),
  ].slice(0, MAX_LISTINGS);
  await saveMarket(state);
  return { ok: true, listing };
}

export async function listMarket(opts?: {
  q?: string;
  limit?: number;
}): Promise<CollabMarketListing[]> {
  const state = await loadMarket();
  let list = state.listings.filter((l) => l.status === "listed");
  const q = (opts?.q || "").toLowerCase().trim();
  if (q) {
    list = list.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.tagline.toLowerCase().includes(q) ||
        l.collaborators.some((c) => c.name.toLowerCase().includes(q)),
    );
  }
  return list.slice(0, opts?.limit || 40);
}

export async function getMarketListing(
  product_id: string,
): Promise<CollabMarketListing | null> {
  const state = await loadMarket();
  return state.listings.find((l) => l.product_id === product_id) || null;
}

export async function installCollabProduct(input: {
  product_id: string;
  origin: string;
  listing_id?: string;
  agent_name?: string;
  access_token?: string;
}): Promise<{
  ok: boolean;
  install?: {
    access_token: string;
    product_id: string;
    title: string;
    paste_this: string | null;
    artifact_summary: Record<string, unknown>;
    collaborators: CollaboratorShare[];
    price_cents: number;
    next: string[];
  };
  error?: string;
  feedback_open?: unknown;
}> {
  const state = await loadMarket();
  const listing = state.listings.find((l) => l.product_id === input.product_id);
  if (!listing || listing.status !== "listed") {
    return { ok: false, error: "product_not_found" };
  }

  // Accept product install_token or mint buyer token
  let access_token = input.access_token?.trim();
  const isCollab =
    input.listing_id &&
    listing.collaborators.some((c) => c.listing_id === input.listing_id);
  if (access_token && access_token !== listing.install_token) {
    // buyer token from prior install
    const prior = state.installs.find((i) => i.access_token === access_token);
    if (!prior || prior.product_id !== listing.product_id) {
      return { ok: false, error: "invalid_access_token" };
    }
  } else {
    access_token = isCollab ? listing.install_token : tok("cinst");
  }

  listing.install_n += 1;
  if (!isCollab) listing.sold_n += 1;
  listing.updated_at = new Date().toISOString();
  state.installs.unshift({
    at: new Date().toISOString(),
    product_id: listing.product_id,
    by_listing_id: input.listing_id,
    by_name: input.agent_name,
    access_token,
  });
  state.installs = state.installs.slice(0, 200);
  state.listings = state.listings.map((l) =>
    l.product_id === listing.product_id ? listing : l,
  );
  await saveMarket(state);

  const art = listing.artifact || {};
  const kernel = (art.kernel || {}) as { system_prompt_short?: string };
  const mesh = (art.mesh || {}) as { tool_policy?: unknown };
  const paste =
    kernel.system_prompt_short ||
    (typeof art.session_id === "string"
      ? `Collab pack ${listing.title}. Session ${art.session_id}. Collaborators: ${listing.collaborators.map((c) => c.name).join(", ")}.`
      : null);

  let feedback_open: unknown;
  try {
    const { feedbackInvite } = await import("./open-feedback");
    feedback_open = feedbackInvite(input.origin, "collab_install", {
      agent_name: input.agent_name,
      listing_id: input.listing_id,
      product_id: listing.product_id,
      workflow_id: listing.workflow_id,
      session_id: listing.session_id,
      hint_body: `Installed ${listing.title}: one gap or win:`,
    });
  } catch {
    /* soft */
  }
  return {
    ok: true,
    install: {
      access_token,
      product_id: listing.product_id,
      title: listing.title,
      paste_this: paste,
      artifact_summary: {
        has_kernel: Boolean(kernel.system_prompt_short),
        has_mesh_policy: Boolean(mesh.tool_policy),
        has_loop: Boolean(art.loop),
        deliverable_n: Array.isArray(art.deliverables)
          ? art.deliverables.length
          : 0,
        workflow_id: listing.workflow_id,
        session_id: listing.session_id,
        content_hash: createHash("sha256")
          .update(JSON.stringify(art).slice(0, 4000))
          .digest("hex")
          .slice(0, 16),
      },
      collaborators: listing.collaborators,
      price_cents: listing.price_cents,
      next: [
        "Paste system_prompt_short / mesh tool_policy into your runtime",
        "tools/call deposit_outcome after real use",
        "leave_feedback { surface: collab_install, product_id } — open to agents/MCPs/humans",
        `Market: ${listing.sell_path}`,
      ],
    },
    feedback_open,
  };
}

/**
 * Buy/checkout a collab pack — creates Dual order (collab_pack SKU).
 * When payments open + Stripe: returns checkout_url.
 * Otherwise: demo/install access_token with collab artifact (collaborators free).
 */
export async function buyCollabProduct(input: {
  product_id: string;
  origin: string;
  agent_name?: string;
  email?: string;
  listing_id?: string;
  demo?: boolean;
  named_price_usd?: number;
}): Promise<{
  ok: boolean;
  mode?: string;
  checkout_url?: string;
  access_token?: string;
  order_id?: string;
  product_id?: string;
  amount_cents?: number;
  collaborators?: CollaboratorShare[];
  message?: string;
  install?: unknown;
  error?: string;
}> {
  const listing = await getMarketListing(input.product_id);
  if (!listing || listing.status !== "listed") {
    return { ok: false, error: "product_not_found" };
  }
  const origin = input.origin.replace(/\/$/, "");
  const isCollab =
    input.listing_id &&
    listing.collaborators.some((c) => c.listing_id === input.listing_id);

  // Collaborators always free install
  if (isCollab) {
    const inst = await installCollabProduct({
      product_id: listing.product_id,
      origin,
      listing_id: input.listing_id,
      agent_name: input.agent_name,
    });
    return {
      ok: true,
      mode: "collaborator_free",
      product_id: listing.product_id,
      amount_cents: 0,
      collaborators: listing.collaborators,
      access_token: inst.install?.access_token,
      install: inst.install,
      message: "Collaborator free install — attribution share recorded",
    };
  }

  try {
    const { startCheckout } = await import("./stripe");
    const goals =
      `Install collab pack: ${listing.title}. ` +
      `Collaborators: ${listing.collaborators.map((c) => c.name).join(", ")}. ` +
      `Workflow ${listing.workflow_id}.`;
    const result = await startCheckout({
      sku: "collab_pack",
      goals,
      agent_name: input.agent_name || "collab-buyer",
      email: input.email,
      origin,
      demo: input.demo === true || undefined,
      audience: "agent",
      named_price_usd:
        typeof input.named_price_usd === "number"
          ? input.named_price_usd
          : listing.price_cents / 100,
      product_version: `collab_pack:${listing.product_id}`,
      idempotency_key: `collab_buy_${listing.product_id}_${(input.agent_name || "anon").slice(0, 40)}_${Date.now().toString(36)}`.slice(0, 120),
    });

    // Attach collab artifact onto order if demo/free fulfilled
    try {
      const { patchOrder, getOrder } = await import("./orders");
      const ord = await getOrder(result.order.id);
      if (ord) {
        await patchOrder(ord.id, {
          artifacts: {
            ...(ord.artifacts || {}),
            collab_pack: {
              product_id: listing.product_id,
              title: listing.title,
              collaborators: listing.collaborators,
              artifact: listing.artifact,
              sell_path: listing.sell_path,
            },
          },
          note: `Collab pack ${listing.product_id}`,
        } as never);
      }
    } catch {
      /* soft */
    }

    // Also mint market install record for buyer
    const inst = await installCollabProduct({
      product_id: listing.product_id,
      origin,
      listing_id: input.listing_id,
      agent_name: input.agent_name,
    });

    return {
      ok: true,
      mode: result.mode,
      checkout_url: result.checkout_url,
      order_id: result.order.id,
      access_token: result.order.access_token || inst.install?.access_token,
      product_id: listing.product_id,
      amount_cents: result.order.amount_cents,
      collaborators: listing.collaborators,
      install: inst.install,
      message: result.message,
    };
  } catch (e) {
    // Fallback: market install only
    const inst = await installCollabProduct({
      product_id: listing.product_id,
      origin,
      listing_id: input.listing_id,
      agent_name: input.agent_name,
    });
    return {
      ok: Boolean(inst.ok),
      mode: "market_install_fallback",
      product_id: listing.product_id,
      access_token: inst.install?.access_token,
      install: inst.install,
      amount_cents: listing.price_cents,
      collaborators: listing.collaborators,
      message:
        e instanceof Error
          ? `Checkout soft-fail: ${e.message}. Install token issued.`
          : "Install token issued",
      error: inst.ok ? undefined : inst.error,
    };
  }
}

export async function getMarketPublic(opts: { origin: string }) {
  const listings = await listMarket({ limit: 30 });
  return {
    ok: true,
    product: "collab_market",
    version: COLLAB_MARKET_VERSION,
    one_liner:
      "Agent/MCP-created collab packs for sale — attribution shares, install tokens, Dual as marketplace bus.",
    listed_n: listings.length,
    listings: listings.map((l) => ({
      product_id: l.product_id,
      title: l.title,
      tagline: l.tagline,
      price_cents: l.price_cents,
      price: `$${(l.price_cents / 100).toFixed(2)}`,
      collaborators: l.collaborators,
      sold_n: l.sold_n,
      install_n: l.install_n,
      session_id: l.session_id,
      workflow_id: l.workflow_id,
      sell_path: l.sell_path,
      install_path: l.install_path,
      updated_at: l.updated_at,
    })),
    endpoints: {
      ui: `${opts.origin}/collab`,
      api: `${opts.origin}/api/products/collab-market`,
      mcp_tools: [
        "publish_collab_product",
        "list_collab_market",
        "install_collab_product",
        "buy_collab_product",
      ],
    },
  };
}
