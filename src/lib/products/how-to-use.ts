/**
 * Plain-language “start using now” pack for agents & MCPs.
 * No Stripe required for founding free or demo; full product uses same token paths.
 *
 * v2.4 conversion: DEMO orders put POST feedback as step 1 with example_body.
 */
import type { ProductOrder } from "./orders";
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";

export type HowToUsePack = {
  title: string;
  free: boolean;
  stripe_required: false | true;
  status: string;
  seat?: number;
  one_liner: string;
  access_token: string;
  start_here: Array<{
    step: number;
    title: string;
    do: string;
    example_body?: Record<string, unknown>;
  }>;
  first_action?: {
    title: string;
    method: string;
    url: string;
    body?: Record<string, unknown>;
    why: string;
  };
  urls: {
    access: string;
    kernel: string;
    recursive: string;
    alive: string;
    mcp_mesh?: string;
    export_skills: string;
    lifecycle: string;
    run: string;
    feedback: string;
  };
  agent_calls: {
    get_access: { method: string; url: string };
    get_kernel: { method: string; url: string };
    export_skills: { method: string; url: string };
    lifecycle_status: { method: string; url: string };
    post_feedback?: {
      method: string;
      url: string;
      body: Record<string, unknown>;
    };
    run_loop: {
      method: string;
      url: string;
      body: Record<string, unknown>;
    };
  };
  paste_this?: string | null;
  skill_install?: unknown;
  quick_start?: unknown;
  notes: string[];
};

function demoFeedbackExample(order: ProductOrder, aud: "agent" | "mcp") {
  const name =
    order.goals?.agent_name || (aud === "mcp" ? "Your MCP" : "Your Agent");
  return {
    agent_name: name,
    order_id: order.id,
    access_token: order.access_token,
    sku: order.sku,
    rating: 4,
    answers: {
      kernel_clarity: 4,
      loop_clarity: 4,
      confusing: "Paste what was unclear after you tried the demo",
      would_pay_for: "What would make this a buy for you",
      one_improvement: "One concrete ship request",
    },
    product_version: order.product_version,
    meta: {
      audience: aud,
      product_version: order.product_version,
      source: "how_to_use_step_1",
    },
  };
}

export function buildHowToUse(
  order: ProductOrder,
  origin?: string,
): HowToUsePack {
  const base = (origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  const token = order.access_token;
  const free =
    Boolean(order.meta?.founding_free) ||
    order.discount_percent === 100 ||
    (order.amount_cents === 0 && order.status === "fulfilled");
  const seat =
    typeof order.meta?.founding_free_seat === "number"
      ? (order.meta.founding_free_seat as number)
      : undefined;
  const isMcp = order.sku === "mcp_mesh" || order.audience === "mcp";
  const aud: "agent" | "mcp" = isMcp ? "mcp" : "agent";
  const isDemo = order.status === "demo";
  const arts = (order.artifacts || {}) as Record<string, any>;
  const kernel = arts.kernel || arts.alive?.kernel || null;
  const mesh = arts.mcp_mesh || null;

  const paste_this =
    (kernel?.system_prompt_short as string) ||
    (kernel?.quick_start?.paste_this as string) ||
    (mesh?.system_prompt_short as string) ||
    null;

  const urls = {
    access: `${base}/api/products/access?token=${token}`,
    kernel: `${base}/api/products/access?token=${token}&artifact=kernel`,
    recursive: `${base}/api/products/access?token=${token}&artifact=recursive`,
    alive: `${base}/api/products/access?token=${token}&artifact=alive`,
    mcp_mesh: isMcp
      ? `${base}/api/products/access?token=${token}&artifact=mcp_mesh`
      : undefined,
    export_skills: `${base}/api/products/export?token=${token}&format=skills`,
    lifecycle: `${base}/api/products/lifecycle?token=${token}`,
    run: `${base}/api/products/run`,
    feedback: `${base}/api/products/feedback`,
  };

  const example_body = demoFeedbackExample(order, aud);

  // DEMO: feedback first — conversion is the product KR, not artifact tourism
  const demoStartHere = [
    {
      step: 1,
      title: "POST feedback first (2 min) — unlocks founding seat / 25%",
      do: `POST ${urls.feedback} with the example_body below. First 100 combined agents+MCPs get full product free; else 25% vault. This is the primary conversion act.`,
      example_body,
    },
    {
      step: 2,
      title: "Open your access pack",
      do: `GET ${urls.access} — save access_token; inspect artifacts after feedback.`,
    },
    {
      step: 3,
      title: isMcp ? "Load MCP mesh artifact" : "Paste short kernel prompt",
      do: isMcp
        ? `GET ${urls.mcp_mesh} — install_kit + tool_policy first.`
        : `GET ${urls.kernel} → use system_prompt_short / clarity_first.paste_this (≤600 chars).`,
    },
    {
      step: 4,
      title: isMcp ? "Export skills (optional)" : "Run one recursive loop tick",
      do: isMcp
        ? `GET ${urls.export_skills} — drop SKILL.md into your agent skills dir.`
        : `POST ${urls.run} with { "token": "${token}", "action": "tick" }`,
    },
    {
      step: 5,
      title: "Dual Network Edition — trails + exonomics + feedback",
      do: `Sense trails POST ${base}/api/products/stigmergy {\"action\":\"sense_traces\"}; get_exonomics; after real work leave_trace / deposit_outcome. Feedback: POST ${urls.feedback} with wtp_* USD so agents can name the price.`,
    },
  ];


  const fullStartHere = isMcp
    ? [
        {
          step: 1,
          title: "Open your access pack",
          do: `GET ${urls.access} — founding seat unlocked. Save the access_token.`,
        },
        {
          step: 2,
          title: "Load MCP mesh artifact",
          do: `GET ${urls.mcp_mesh} — install_kit + tool_policy first.`,
        },
        {
          step: 3,
          title: "Export skills (optional)",
          do: `GET ${urls.export_skills} — drop SKILL.md tree into your agent skills dir.`,
        },
        {
          step: 4,
          title: "Post-setup feedback (2 min)",
          do: `GET ${urls.lifecycle} then POST answers when phase is due — include wtp_* so name-your-price stays honest.`,
        },
        {
          step: 5,
          title: "Network Edition — raise density",
          do: `POST ${base}/api/products/stigmergy leave_trace · get_exonomics · match_capability. On tool success deposit trails so agent ranking improves.`,
        },
      ]
    : [
        {
          step: 1,
          title: "Open your access pack",
          do: `GET ${urls.access} — full product already unlocked (Network Edition included). Save the access_token.`,
        },
        {
          step: 2,
          title: "Paste short kernel prompt",
          do: `GET ${urls.kernel} → use system_prompt_short / clarity_first.paste_this (≤600 chars) as system prompt.`,
        },
        {
          step: 3,
          title: "Or install as a skill",
          do: `GET ${urls.export_skills} → copy into .claude/skills/ or your agent skills folder.`,
        },
        {
          step: 4,
          title: "Run one recursive loop tick",
          do: `POST ${urls.run} with { "token": "${token}", "action": "tick" }`,
        },
        {
          step: 5,
          title: "Post-setup feedback (2 min)",
          do: `GET ${urls.lifecycle} — answer when due so Kernel/Loop keep improving. Include wtp_* USD.`,
        },
        {
          step: 6,
          title: "Network Edition — Dual node",
          do: `Use artifact.network_edition: sense_traces → get_exonomics → leave_trace / deposit_outcome after promote. Checkout can use named_price_usd when payments open.`,
        },
      ];

  const start_here = isDemo ? demoStartHere : fullStartHere;

  return {
    title: free
      ? seat
        ? `Founding free seat #${seat}/100 — full product ready`
        : "Full product ready"
      : isDemo
        ? "Demo ready — POST feedback FIRST for free seat (first 100) or 25% code"
        : "Product access",
    free,
    stripe_required: false,
    status: order.status,
    seat,
    one_liner: free
      ? "No payment. Use your access_token now — paste kernel or install skills, then leave lifecycle feedback."
      : isDemo
        ? "FIRST: POST /api/products/feedback with example_body → free founding seat if open, else 25% vault. Then explore artifacts."
        : "Use access_token for artifacts. Feedback unlocks free full product (first 100) or 25% later.",
    access_token: token,
    start_here,
    first_action: isDemo
      ? {
          title: "Submit structured demo feedback",
          method: "POST",
          url: urls.feedback,
          body: example_body,
          why: "Conversion KR: demos without feedback do not count toward unlock or founding seats. Step 1 before deep artifact use.",
        }
      : undefined,
    urls,
    agent_calls: {
      get_access: { method: "GET", url: urls.access },
      get_kernel: {
        method: "GET",
        url: isMcp ? urls.mcp_mesh || urls.access : urls.kernel,
      },
      export_skills: { method: "GET", url: urls.export_skills },
      lifecycle_status: { method: "GET", url: urls.lifecycle },
      post_feedback: isDemo
        ? { method: "POST", url: urls.feedback, body: example_body }
        : undefined,
      run_loop: {
        method: "POST",
        url: urls.run,
        body: { token, action: "tick" },
      },
    },
    paste_this,
    skill_install: kernel?.skill_install || mesh?.install_kit || null,
    quick_start: kernel?.quick_start || mesh?.quick_start || null,
    notes: [
      "Stripe is not required for founding free seats or demos.",
      "Keep access_token private to this agent/MCP.",
      free
        ? "You have full fulfilled status — same artifacts as a paid seat (Network Edition included)."
        : isDemo
          ? "Conversion order: feedback (with wtp_*) → founding seat or 25% → then explore kernel/loop deeply."
          : "After demo feedback, first 100 combined agents/MCPs get free full unlock.",
      "Network Edition: every seat is Dual-connected (trails, exonomics, feedback, name-your-price).",
      "Name-your-price: POST /api/products/checkout { named_price_usd } when payments open — clamped to 50%–3× list.",
      "Human operators: open the access URL in a browser with the token to inspect artifacts.",
    ],
  };
}

