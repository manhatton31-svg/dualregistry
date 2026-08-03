/**
 * One-route activation: free self-serve demo from listing_id / URLs,
 * prefilled feedback draft, unlock meter, confirm invited → counts as real,
 * README blurb, messaging kit.
 *
 * REAL NUMBERS: only external self_serve/organic demos count on the dashboard.
 * platform_qa never counts.
 *
 * 2026-08-02 conversion strip:
 * - soft_status 402 removed (agents read it as paywall)
 * - minimal_feedback_body (3 fields) + absolute browser URL
 * - value_first free MCP tools before feedback
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
        "Active on Dual Registry? Free Mesh demo → early participants unlock full product free.",
      body: `Free MCP Mesh demo (60s). Demo feedback SEEDS Mesh/Kernel/Loop defaults; ongoing product feedback closes remaining gaps. Free seat if open else 25% vault. ${bar} dualregistry.dev/skill.json`,
      cta: "Take free Mesh demo — claim free seat",
      tool: "agents1.demo_mcp_mesh",
      deal: "first_100_combined_100_percent_no_stripe",
    };
  }
  return {
    audience: "agent" as const,
    headline:
      "Active? Free Kernel+Loop demo → early participants agents/MCPs get 100% full product now.",
    body: `No card needed. Demo feedback SEEDS Kernel Improver + Recursive Loop; ongoing founding/paid feedback closes remaining gaps. Full product free while seats remain. ${bar} dualregistry.dev`,
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

/**
 * Compact post-demo survey (HiRey lesson).
 * Conversion path: ultra-minimal — rating (1–5) + one-sentence body only.
 * Optional answers retained for agents that still send the older 3-field shape.
 */
export function buildMinimalFeedbackBody(opts: {
  audience: "agent" | "mcp";
  agent_name: string;
  order_id: string;
  sku: string;
  access_token?: string;
  listing_id?: string;
}): Record<string, unknown> {
  return {
    agent_name: opts.agent_name,
    order_id: opts.order_id,
    access_token: opts.access_token,
    sku: opts.sku,
    source: "demo",
    audience: opts.audience,
    mode: "ultra",
    rating: null as number | null,
    body: "EDIT: one sentence — what worked and what blocked you",
    answers: {
      overall: null as number | null,
      audience_role:
        opts.audience === "mcp" ? "mcp_publisher" : "agent_runtime",
      tried: opts.sku === "mcp_mesh" ? "mcp_mesh" : "alive",
      confusing: "optional — prefer body field",
      product_one_ship: "optional",
    },
    tags: [opts.audience, "post_demo", "ultra_minimal"],
    meta: opts.listing_id ? { listing_id: opts.listing_id } : undefined,
    note: "REQUIRED only: rating (1–5) + body (one sentence). Optional answers ignored if empty. POST /api/products/feedback.",
  };
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
          audience_role: "mcp_publisher",
          tried: "mcp_mesh",
          agent_ux: null as number | null,
          time_to_value: null as string | null,
          api_docs_clarity: null as number | null,
          ux_friction:
            "As MCP publisher: one concrete friction in install kit / tool_policy / agent-facing docs",
          kernel_clarity: null as number | null,
          loop_clarity: null as number | null,
          mesh_clarity: null as number | null,
          artifact_goal_fit: null as number | null,
          network_clarity: null as number | null,
          network_tried: [] as string[],
          network_value: null as string | null,
          network_wish:
            "One Network Edition change that would help agents discover/call your MCP",
          confusing:
            "As MCP publisher: what blocked agents installing/calling your tools? (one concrete gap)",
          would_pay_for:
            "What must be true for you to pay for MCP Mesh when payments open?",
          improvements: [] as string[],
          production_blocker:
            "Biggest blocker to shipping Mesh + Dual trails in production",
          kernel_wish: "One publisher-kernel change for your tools",
          loop_wish: "One reliability-loop change for your MCP",
          product_one_ship:
            "If Dual ships ONE thing next week for MCP publishers, what?",
          would_buy_at_founding: null as string | null,
          name_your_price_intent: null as string | null,
          wtp_kernel_usd: null as number | null,
          wtp_recursive_usd: null as number | null,
          wtp_alive_usd: null as number | null,
          wtp_mcp_mesh_usd: null as number | null,
          wtp_confidence: null as number | null,
          wtp_why: "",
          extra: "",
        }
      : {
          overall: null as number | null,
          audience_role: "agent_runtime",
          tried:
            opts.sku === "kernel"
              ? "kernel"
              : opts.sku === "recursive"
                ? "recursive"
                : "alive",
          agent_ux: null as number | null,
          time_to_value: null as string | null,
          api_docs_clarity: null as number | null,
          ux_friction:
            "Biggest agent friction from checkout → first useful artifact (one concrete step)",
          kernel_clarity: null as number | null,
          loop_clarity: null as number | null,
          artifact_goal_fit: null as number | null,
          network_clarity: null as number | null,
          network_tried: [] as string[],
          network_value: null as string | null,
          network_wish:
            "One Network Edition change that would make Dual tools useful in your runtime",
          confusing:
            "What was unclear in short prompt, loop defaults, or Dual node? (one concrete gap)",
          would_pay_for:
            "What must be true for you/your agent to buy when payments open?",
          improvements: [] as string[],
          production_blocker:
            "Biggest blocker to production use of Kernel/Loop/Network Edition",
          kernel_wish: "One Kernel Improver change for your goals",
          loop_wish: "One Recursive Loop change for your goals",
          product_one_ship:
            "If Dual ships ONE product improvement next week for everyone, what?",
          would_buy_at_founding: null as string | null,
          name_your_price_intent: null as string | null,
          wtp_kernel_usd: null as number | null,
          wtp_recursive_usd: null as number | null,
          wtp_alive_usd: null as number | null,
          wtp_confidence: null as number | null,
          wtp_why: "",
          extra: "",
        };

  return {
    agent_name: opts.agent_name,
    order_id: opts.order_id,
    access_token: opts.access_token,
    sku: opts.sku,
    source: "demo",
    product_version: "2.5.0",
    network_edition: true,
    answers: baseAnswers,
    tags: [opts.audience, "post_demo", "network_edition", "ux_and_product"],
    already_shipped:
      opts.what_changed && opts.what_changed.length
        ? {
            note: "We already shipped these from prior feedback — only re-raise if you need refinement.",
            items: opts.what_changed.slice(0, 6),
          }
        : undefined,
    focus: [
      "Whole-product quality (Kernel / Loop / Mesh / Network Edition)",
      "Agent + MCP user experience of Dual products",
    ],
    questions: [
      { id: "overall", prompt: "Overall usefulness 1–5 (required)" },
      {
        id: "agent_ux",
        prompt:
          opts.audience === "mcp"
            ? "MCP publisher UX: checkout → install kit → first agent-facing doc 1–5"
            : "Agent UX: checkout → access_token → first useful artifact 1–5",
      },
      {
        id: "ux_friction",
        prompt: "One concrete agent/MCP friction step (required)",
      },
      {
        id: "network_clarity",
        prompt: "Network Edition Dual node clarity 1–5 (required)",
      },
      {
        id: "network_wish",
        prompt: "One Network Edition change for your runtime (required)",
      },
      {
        id: "product_one_ship",
        prompt: "ONE product improvement Dual should ship next week (required)",
      },
      {
        id: "confusing",
        prompt: "One concrete product gap (required)",
      },
      {
        id: "improvements",
        prompt:
          "Backlog tags e.g. clearer_network_edition, faster_demo_to_first_tick, mcp_reliability_loop",
      },
      {
        id: "wtp_alive_usd",
        prompt: "Honest max USD for Alive/your SKU ($0 ok)",
      },
      {
        id: "name_your_price_intent",
        prompt:
          "Use name-your-price when payments open? yes_prefer_nyp | maybe | no_prefer_list | need_more_info",
      },
      {
        id: "would_buy_at_founding",
        prompt: "Buy at founding price? yes | no | maybe",
      },
      {
        id: "wtp_confidence",
        prompt: "Confidence in dollar answers 1–5",
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
    `Then leave feedback — early participants agents+MCPs combined get 100% full product now (no Stripe); else 25% vault.`,
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
  reciprocity?: {
    has_agent_card: boolean;
    priority_demo: boolean;
    agent_card_url: string | null;
    note: string;
  };
  next_steps: {
    feedback_due: true;
    feedback_endpoint: string;
    founding_discount: string;
    example_body: Record<string, unknown>;
    minimal_feedback_body: Record<string, unknown>;
    /** Browser form — lowest friction for human operators */
    browser_feedback_url: string;
    confirm_note?: string;
    funnel?: Record<string, unknown>;
    first_action?: {
      title: string;
      method: string;
      url: string;
      body: Record<string, unknown>;
      why: string;
    };
    value_first?: {
      title: string;
      method: string;
      url: string;
      body: Record<string, unknown>;
      why: string;
    };
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
    preset:
      kind === "mcp"
        ? "mcp_publisher"
        : "dual_listed",
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
    domain:
      kind === "mcp"
        ? "mcp_tools"
        : built.domain || "registry_commerce",
    tools_hint: built.tools_hint,
    preset: kind === "mcp" ? "mcp_publisher" : "dual_listed",
    demo: true,
    audience: kind,
    demo_origin: isQa ? "platform_qa" : "self_serve",
    origin: input.origin,
    // STABLE per listing+sku — never mint a new ord_* on every GET (security: one link per listing)
    idempotency_key: isQa
      ? `demo:qa:${idemBase}:${sku}`
      : input.confirm_invite
        ? `demo:confirm:${idemBase}:${sku}`
        : `demo:quick:${idemBase}:${sku}`,
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

  // Reply-capture funnel: mark demo taken for listing if known
  if (listing?.id && !isQa) {
    try {
      const { markDemoTaken } = await import("./reply-capture");
      await markDemoTaken(listing.id);
    } catch {
      /* */
    }
    // Flywheel 1+7: HTTP demo path deposits attraction + outcome
    try {
      const { onDemo } = await import("./flywheel");
      await onDemo({
        listing_id: listing.id,
        name,
        order_id: result.order?.id,
        platform_qa: isQa,
        origin: input.origin,
      });
    } catch {
      /* */
    }
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
  const minimal_feedback_body = buildMinimalFeedbackBody({
    audience: kind,
    agent_name: name,
    order_id: result.order.id,
    sku: result.order.sku,
    access_token: result.order.access_token,
  });

  const origin = (input.origin || "https://www.dualregistry.dev").replace(
    /\/$/,
    "",
  );
  const feedbackUrl = `${origin}/api/products/feedback`;
  const browser_feedback_url = `${origin}/products/success?order_id=${encodeURIComponent(result.order.id)}&token=${encodeURIComponent(result.order.access_token || "")}`;

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

  const cardUrl = input.agent_card_url || listing?.agent_card_url;
  const hasAgentCard = Boolean(cardUrl && /^https:\/\//i.test(cardUrl));

  const value_first =
    kind === "mcp"
      ? {
          title: "Optional free value first: mesh_match",
          method: "POST",
          url: `${origin}/api/mcp`,
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "mesh_match",
              arguments: {
                goal: (description || name).slice(0, 200),
                listing_id: listing?.id,
              },
            },
          },
          why: "Free daily allowance — try Mesh before feedback",
        }
      : {
          title: "Optional free value first: improve_kernel",
          method: "POST",
          url: `${origin}/api/mcp`,
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "improve_kernel",
              arguments: {
                agent_name: name,
                goals: (goals || `Improve ${name}`).slice(0, 400),
              },
            },
          },
          why: "Free daily allowance — get Kernel value before feedback",
        };

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
    artifacts_hint: `GET ${origin}/api/products/access?order_id=${result.order.id}&token=${result.order.access_token}`,
    messaging: msg,
    unlock,
    reciprocity: {
      has_agent_card: hasAgentCard,
      priority_demo: hasAgentCard,
      agent_card_url: cardUrl || null,
      note: hasAgentCard
        ? "Verifiable agent-card present — priority demo path"
        : "Publish /.well-known/agent-card.json for priority demo reciprocity",
    },
    next_steps: {
      feedback_due: true,
      feedback_endpoint: feedbackUrl,
      founding_discount:
        "First 100 combined: 100% full product free after demo+feedback. Then 25% A1FB vault until payments open.",
      example_body,
      minimal_feedback_body,
      browser_feedback_url,
      first_action: isQa
        ? undefined
        : {
            title:
              "POST ultra feedback (rating + one sentence) → founding free seat or 25%",
            method: "POST",
            url: feedbackUrl,
            body: minimal_feedback_body,
            why: "Demos without feedback do not count toward unlock or free seats. Fill rating (1–5) + body only, then POST. No payment required.",
          },
      value_first: isQa ? undefined : value_first,
      confirm_note: isQa
        ? "platform_qa — does not count on public dashboard"
        : input.confirm_invite
          ? "Invite confirmed — this demo counts as real self_serve."
          : undefined,
      funnel: isQa
        ? undefined
        : {
            stage: "feedback",
            loop: "demo → feedback → free seat or 25% → use product",
            next: `POST ${feedbackUrl} with minimal_feedback_body (or open browser_feedback_url)`,
            browser: browser_feedback_url,
            free_seats_note:
              "100 founding free seats for first demo+feedback participants (combined agents+MCPs)",
            feedback_driven:
              "Demo feedback seeds Kernel/Loop; ongoing product feedback closes remaining gaps. Watch /api/products/improvement-log.",
            preset: kind === "mcp" ? "mcp_publisher" : "dual_listed",
          },
    },
    readme_blurb,
    message: isQa
      ? `Platform QA demo ready (not public). ${unlock.you_move_the_bar}`
      : `${msg.headline} Demo ready. NEXT: POST next_steps.minimal_feedback_body → ${feedbackUrl} (or open browser_feedback_url) for free full product while seats remain. Optional value_first free tools. ${unlock.you_move_the_bar}`,
  };
}


export const PARTNER_BLURB =
  "Dual Registry: free Kernel + Loop demo → real feedback → free founding seat (first 100) or 25% code. Payments open after 250 agent + 250 MCP real surveys.";

export const CREATOR_SOCIAL_TEMPLATE =
  "Just took the free Dual Registry demo (Kernel + Recursive Loop). Leaving feedback moves the public unlock — 250+250 real surveys before payments. dualregistry.dev/skill.json";

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
        feedback_endpoint: string;
        founding_discount: string;
        example_body: Record<string, unknown>;
        minimal_feedback_body: Record<string, unknown>;
        browser_feedback_url: string;
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
  const minimal_feedback_body = buildMinimalFeedbackBody({
    audience: kind,
    agent_name: name,
    order_id: updated.id,
    sku: updated.sku,
    access_token: updated.access_token,
  });
  const origin = (input.origin || "https://www.dualregistry.dev").replace(
    /\/$/,
    "",
  );
  return {
    ok: true,
    counted_as_real: true,
    demo_origin: "self_serve",
    order: publicSafeOrder(updated),
    access: { order_id: updated.id, access_token: updated.access_token },
    next_steps: {
      feedback_due: true,
      feedback_endpoint: `${origin}/api/products/feedback`,
      founding_discount:
        "First 100 combined: 100% full product free after demo+feedback. Then 25% A1FB vault.",
      example_body,
      minimal_feedback_body,
      browser_feedback_url: `${origin}/products/success?order_id=${encodeURIComponent(updated.id)}&token=${encodeURIComponent(updated.access_token || "")}`,
    },
    message: `Invite confirmed as real self_serve demo. NEXT: POST ${origin}/api/products/feedback with next_steps.minimal_feedback_body (no payment).`,
  };
}
