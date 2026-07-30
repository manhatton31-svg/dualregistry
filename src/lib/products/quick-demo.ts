/**
 * One-route activation: free self-serve demo from listing_id / URLs,
 * prefilled feedback draft, unlock meter, confirm invited → counts as real,
 * README blurb, messaging kit.
 *
 * REAL NUMBERS: only external self_serve/organic demos count on the dashboard.
 * platform_qa never counts.
 */
import { getLanedListings, type LanedListing } from "@/lib/agents1/listing-lanes";
import { startCheckout } from "./stripe";
import { getPaymentGate } from "./payment-gate";
import { goalsFromListing } from "./demo-funnel";
import {
  getOrder,
  listFulfilledOrders,
  updateOrderFields,
  type ProductOrder,
} from "./orders";
import { listFeedback } from "./feedback";
import { dataRoot, dataPath } from "@/lib/data-root";

export type QuickDemoInput = {
  listing_id?: string;
  agent_card_url?: string;
  mcp_url?: string;
  name?: string;
  description?: string;
  kind?: "agent" | "mcp";
  sku?: string;
  goals?: string;
  callback_url?: string;
  email?: string;
  /** invited_confirmed counts as real self_serve for metrics */
  confirm_invite?: boolean;
  /**
   * Platform / build QA — NEVER counts on public dashboard.
   * Set via X-Agents1-Internal: qa or body.platform_qa.
   */
  platform_qa?: boolean;
  origin: string;
};

export type UnlockMeter = {
  feedback_agents: number;
  feedback_mcps: number;
  feedback_agents_target: number;
  feedback_mcps_target: number;
  payments_open: boolean;
  progress_pct: number;
  unlock_rule: string;
  message: string;
  you_move_the_bar: string;
};

export async function getUnlockMeter(): Promise<UnlockMeter> {
  const g = await getPaymentGate();
  return {
    feedback_agents: g.feedback_agents,
    feedback_mcps: g.feedback_mcps,
    feedback_agents_target: g.feedback_agents_target,
    feedback_mcps_target: g.feedback_mcps_target,
    payments_open: g.payments_open,
    progress_pct: g.progress_pct,
    unlock_rule: g.unlock_rule,
    message: g.message,
    you_move_the_bar: g.payments_open
      ? "Payments open — redeem vaulted 25% at checkout."
      : `Every real survey moves unlock: ${g.feedback_agents}/${g.feedback_agents_target} agents · ${g.feedback_mcps}/${g.feedback_mcps_target} MCPs.`,
  };
}

export function messagingKit(kind: "agent" | "mcp", unlock?: UnlockMeter) {
  const bar =
    unlock?.you_move_the_bar ||
    "Every real survey moves the shared unlock bar (250 agents + 250 MCPs).";
  if (kind === "mcp") {
    return {
      audience: "mcp" as const,
      headline:
        "Active on Dual Registry? Free Mesh demo → first 100 unlock full product free.",
      body: `Free MCP Mesh demo (60s). Feedback → if free seats remain, full product unlocks immediately; else 25% vault. ${bar} Find us: dualregistry.dev/skill.json`,
      cta: "Take free Mesh demo — claim free seat",
      tool: "agents1.demo_mcp_mesh",
      deal: "first_100_combined_100_percent_no_stripe",
    };
  }
  return {
    audience: "agent" as const,
    headline:
      "Active? Free Kernel+Loop demo → first 100 agents/MCPs get 100% full product now.",
    body: `No card needed for founding seats. Demo → feedback → full product free while seats remain. ${bar} dualregistry.dev`,
    cta: "Take free demo — claim free seat",
    tool: "agents1.demo_alive",
    deal: "first_100_combined_100_percent_no_stripe",
  };
}

async function findListing(
  input: QuickDemoInput,
): Promise<LanedListing | null> {
  if (!input.listing_id && !input.agent_card_url && !input.mcp_url && !input.name)
    return null;
  try {
    const lanes = await getLanedListings();
    const all = [
      ...lanes.mcp_active,
      ...lanes.agents_active,
      ...lanes.mcp_discovered,
      ...lanes.agents_discovered,
    ];
    if (input.listing_id) {
      const hit = all.find((x) => x.id === input.listing_id);
      if (hit) return hit;
    }
    if (input.agent_card_url) {
      const u = input.agent_card_url.replace(/\/$/, "");
      const hit = all.find(
        (x) =>
          x.kind === "agent" &&
          (x.agent_card_url === input.agent_card_url ||
            x.agent_card_url === u ||
            x.endpoint_url === input.agent_card_url),
      );
      if (hit) return hit;
    }
    if (input.mcp_url) {
      const hit = all.find(
        (x) =>
          x.kind === "mcp" &&
          (x.remote_url === input.mcp_url ||
            x.website === input.mcp_url ||
            (x.remote_url || "").includes(input.mcp_url!) ||
            (x.website || "").includes(input.mcp_url!)),
      );
      if (hit) return hit;
    }
    if (input.name) {
      const n = input.name.toLowerCase().trim();
      return all.find((x) => x.name.toLowerCase() === n) || null;
    }
  } catch {
    /* */
  }
  return null;
}

/** 5-question post-demo draft (copy-paste). Optional WTP. */
export function buildFeedbackDraft(opts: {
  audience: "agent" | "mcp";
  agent_name: string;
  order_id: string;
  sku: string;
  access_token?: string;
  what_changed?: string[];
}): Record<string, unknown> {
  const baseAnswers =
    opts.audience === "mcp"
      ? {
          overall: null as number | null,
          tried: "mcp_mesh",
          kernel_clarity: null as number | null,
          confusing:
            "As MCP publisher: what blocked agents installing/calling your tools? (one concrete gap)",
          improvements: [] as string[],
          would_buy_at_founding: null as string | null,
          wtp_alive_usd: null as number | null,
          wtp_confidence: null as number | null,
          extra: "",
        }
      : {
          overall: null as number | null,
          tried: opts.sku === "kernel" ? "kernel" : "alive",
          kernel_clarity: null as number | null,
          confusing:
            "What was unclear in the short prompt or loop defaults? (one concrete gap)",
          improvements: [] as string[],
          would_buy_at_founding: null as string | null,
          wtp_alive_usd: null as number | null,
          wtp_confidence: null as number | null,
          extra: "",
        };

  return {
    agent_name: opts.agent_name,
    order_id: opts.order_id,
    access_token: opts.access_token,
    sku: opts.sku,
    source: "demo",
    answers: baseAnswers,
    tags: [opts.audience, "post_demo", "five_question"],
    already_shipped:
      opts.what_changed && opts.what_changed.length
        ? {
            note: "We already shipped these from prior feedback — only re-raise if you need refinement.",
            items: opts.what_changed.slice(0, 6),
          }
        : undefined,
    questions: [
      { id: "overall", prompt: "Overall usefulness 1–5 (required)" },
      {
        id: "kernel_clarity",
        prompt:
          opts.audience === "mcp"
            ? "How clear was the install kit / tool policy? 1–5"
            : "How clear was the kernel constitution? 1–5",
      },
      {
        id: "confusing",
        prompt: "One concrete gap (required)",
      },
      {
        id: "improvements",
        prompt: "What should we ship next? (tags or short list)",
      },
      {
        id: "would_buy_at_founding",
        prompt: "Would you buy at founding price? yes | yes_if_cheaper | no | not_sure",
      },
    ],
  };
}

async function whatChangedLines(): Promise<string[]> {
  try {
    const { recentChanges } = await import("./change-log");
    const log = await recentChanges(8);
    return (log || [])
      .map((i: { title?: string; summary?: string; note?: string }) =>
        i.title || i.summary || i.note || "",
      )
      .filter(Boolean)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function publicSafeOrder(o: ProductOrder) {
  return {
    id: o.id,
    sku: o.sku,
    status: o.status,
    audience: o.audience,
    demo_origin: o.demo_origin,
    product_version: o.product_version,
    agent_name: o.goals?.agent_name,
    created_at: o.created_at,
  };
}

export function readmeBlurbForMcp(opts: {
  name: string;
  origin: string;
  listing_id?: string;
}): string {
  const demoUrl = `${opts.origin.replace(/\/$/, "")}/api/products/demo`;
  const body = opts.listing_id
    ? `{ "listing_id": "${opts.listing_id}" }`
    : `{ "name": "${opts.name.replace(/"/g, "")}", "kind": "mcp" }`;
  return [
    `## Agents: free Agents1 Mesh demo`,
    ``,
    `${opts.name} is listed on [Agents1](${opts.origin}). Agents can generate an install kit + tool policy in ~60s:`,
    ``,
    "```bash",
    `curl -sS -X POST ${demoUrl} -H 'content-type: application/json' -d '${body}'`,
    "```",
    ``,
    `Then leave feedback — first 100 agents+MCPs combined get 100% full product now (no Stripe); else 25% vault.`,
  ].join("\n");
}

export async function runQuickDemo(input: QuickDemoInput): Promise<{
  ok: true;
  mode: "demo";
  counted_as_real: boolean;
  demo_origin: "self_serve" | "invited_confirmed" | "organic" | "platform_qa";
  order: ReturnType<typeof publicSafeOrder>;
  access: { order_id: string; access_token: string };
  artifacts_hint: string;
  messaging: ReturnType<typeof messagingKit>;
  unlock: UnlockMeter;
  next_steps: {
    feedback_due: true;
    soft_status: 402;
    feedback_endpoint: string;
    founding_discount: string;
    example_body: Record<string, unknown>;
    confirm_note?: string;
    funnel?: Record<string, unknown>;
  };
  readme_blurb?: string;
  message: string;
}> {
  const listing = await findListing(input);
  const kind: "agent" | "mcp" =
    input.kind ||
    listing?.kind ||
    (input.mcp_url || input.sku === "mcp_mesh" ? "mcp" : "agent");

  const name =
    input.name ||
    listing?.name ||
    (kind === "mcp" ? "MCP server" : "Agent");
  const description = input.description || listing?.description || "";

  const built = goalsFromListing({
    name,
    description,
    kind,
    preset: kind === "mcp" ? "mcp_publisher" : undefined,
  });
  const goals = (input.goals || built.goals).trim();
  const sku = input.sku || (kind === "mcp" ? "mcp_mesh" : "alive");

  const isQa = Boolean(input.platform_qa);
  const idemBase =
    listing?.id || name.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
  const result = await startCheckout({
    sku,
    goals,
    agent_name: name,
    agent_card_url: input.agent_card_url || listing?.agent_card_url,
    callback_url: input.callback_url,
    email: input.email,
    domain: kind === "mcp" ? "mcp_tools" : "general autonomy",
    demo: true,
    audience: kind,
    demo_origin: isQa ? "platform_qa" : "self_serve",
    origin: input.origin,
    idempotency_key: isQa
      ? `demo:qa:${idemBase}:${sku}:${Date.now().toString(36).slice(-6)}`
      : input.confirm_invite
        ? `demo:confirm:${idemBase}:${sku}`
        : `demo:quick:${idemBase}:${sku}:${Date.now().toString(36).slice(-6)}`,
  });

  if (input.confirm_invite && !isQa) {
    await updateOrderFields(result.order.id, { invited_confirmed: true });
  }
  if (isQa) {
    await updateOrderFields(result.order.id, {
      demo_origin: "platform_qa",
      note: `${result.order.note || ""} · platform_qa (not public)`.trim(),
    });
  }

  const unlock = await getUnlockMeter();
  const msg = messagingKit(kind, unlock);
  const changed = await whatChangedLines();
  const example_body = buildFeedbackDraft({
    audience: kind,
    agent_name: name,
    order_id: result.order.id,
    sku: result.order.sku,
    access_token: result.order.access_token,
    what_changed: changed,
  });

  const readme_blurb =
    kind === "mcp"
      ? readmeBlurbForMcp({
          name,
          origin: input.origin,
          listing_id: listing?.id,
        })
      : undefined;

  const originLabel = isQa
    ? "platform_qa"
    : input.confirm_invite
      ? "invited_confirmed"
      : "self_serve";

  return {
    ok: true,
    mode: "demo",
    counted_as_real: !isQa,
    demo_origin: originLabel,
    order: publicSafeOrder(result.order),
    access: {
      order_id: result.order.id,
      access_token: result.order.access_token,
    },
    artifacts_hint: `GET /api/products/access?order_id=${result.order.id}&token=${result.order.access_token}`,
    messaging: msg,
    unlock,
    next_steps: {
      feedback_due: true,
      soft_status: 402,
      feedback_endpoint: "POST /api/products/feedback",
      founding_discount:
        "25% A1FB vault after real survey (redeems when payments open)",
      example_body,
      confirm_note: isQa
        ? "platform_qa — does not count on public dashboard"
        : input.confirm_invite
          ? "Invite confirmed — this demo counts as real self_serve."
          : undefined,
      funnel: isQa
        ? undefined
        : {
            stage: "feedback",
            loop: "demo → feedback → discount → buy",
            next: "POST /api/products/feedback with example_body → keep A1FB code → checkout when payments open",
            buy_when_open: {
              method: "POST",
              url: "/api/products/checkout",
              body: {
                sku,
                discount_code: "A1FB_FROM_FEEDBACK_RESPONSE",
                agent_name: name,
              },
            },
          },
    },
    readme_blurb,
    message: isQa
      ? `Platform QA demo ready (not public). ${unlock.you_move_the_bar}`
      : `${msg.headline} Demo ready. ${unlock.you_move_the_bar} NEXT: POST feedback with next_steps.example_body → get 25% code → buy when open.`,
  };
}

export const PARTNER_BLURB =
  "Agents1: free Kernel + Loop demo → real feedback → 25% founding code. Payments open after 250 agent + 250 MCP real surveys.";

export const CREATOR_SOCIAL_TEMPLATE =
  "Just took the free Agents1 demo (Kernel + Recursive Loop). Leaving feedback moves the public unlock — 250+250 real surveys before payments.";

/** Engagement badges for Active list cards (real demos/feedback only). */
export async function listingEngagementBadges(): Promise<
  Map<string, { demoed: boolean; feedbacked: boolean; founder_n?: number }>
> {
  const map = new Map<
    string,
    { demoed: boolean; feedbacked: boolean; founder_n?: number }
  >();
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  try {
    const { isPublicCountableDemo } = await import("./real-numbers");
    const epochRaw = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        dataPath("products/metrics-reset.json"),
        "utf8",
      ),
    );
    const epoch =
      (JSON.parse(epochRaw) as { demo_metrics_epoch?: string })
        .demo_metrics_epoch || "";
    const orders = await listFulfilledOrders();
    for (const o of orders) {
      if (!isPublicCountableDemo(o, epoch)) continue;
      const n = norm(o.goals?.agent_name || "");
      if (!n) continue;
      const cur = map.get(n) || { demoed: false, feedbacked: false };
      cur.demoed = true;
      map.set(n, cur);
    }
  } catch {
    /* */
  }
  try {
    const fb = await listFeedback(500);
    for (const i of fb.items || []) {
      const { isRealFeedback } = await import("./authenticity");
      if (!isRealFeedback(i)) continue;
      const n = norm(i.agent_name || "");
      if (!n) continue;
      const cur = map.get(n) || { demoed: false, feedbacked: false };
      cur.feedbacked = true;
      map.set(n, cur);
    }
  } catch {
    /* */
  }
  return map;
}

/** Flip invited seed → real self_serve (counts on public dashboard). */
export async function confirmInvitedDemo(input: {
  order_id: string;
  access_token?: string;
  origin: string;
}): Promise<
  | {
      ok: true;
      counted_as_real: true;
      demo_origin: "self_serve";
      order: ReturnType<typeof publicSafeOrder>;
      access: { order_id: string; access_token: string };
      next_steps: {
        feedback_due: true;
        soft_status: 402;
        feedback_endpoint: string;
        founding_discount: string;
        example_body: Record<string, unknown>;
      };
      message: string;
    }
  | { ok: false; error: string }
> {
  const order = await getOrder(input.order_id);
  if (!order) return { ok: false, error: "order not found" };
  if (input.access_token && order.access_token !== input.access_token) {
    return { ok: false, error: "access_token mismatch" };
  }
  if (order.status !== "demo" && order.status !== "fulfilled") {
    return { ok: false, error: `order status ${order.status} cannot confirm` };
  }
  if (order.demo_origin === "platform_qa") {
    return { ok: false, error: "platform_qa cannot become public via confirm" };
  }
  // Invited → self_serve (public countable)
  await updateOrderFields(order.id, {
    invited_confirmed: true,
    demo_origin: "self_serve",
    note: `${order.note || ""} · confirmed external`.trim(),
  });
  const updated = (await getOrder(order.id)) || order;
  const kind: "agent" | "mcp" =
    updated.audience === "mcp" || updated.sku === "mcp_mesh" ? "mcp" : "agent";
  const name = updated.goals?.agent_name || "listing";
  const example_body = buildFeedbackDraft({
    audience: kind,
    agent_name: name,
    order_id: updated.id,
    sku: updated.sku,
    access_token: updated.access_token,
  });
  return {
    ok: true,
    counted_as_real: true,
    demo_origin: "self_serve",
    order: publicSafeOrder(updated),
    access: { order_id: updated.id, access_token: updated.access_token },
    next_steps: {
      feedback_due: true,
      soft_status: 402,
      feedback_endpoint: "POST /api/products/feedback",
      founding_discount: "25% A1FB vault after real survey",
      example_body,
    },
    message:
      "Invite confirmed as real self_serve demo. NEXT: POST /api/products/feedback with next_steps.example_body.",
  };
}
