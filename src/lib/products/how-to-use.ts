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
    network_edition: true,
    answers: {
      overall: 4,
      audience_role: aud === "mcp" ? "mcp_publisher" : "agent_runtime",
      tried: aud === "mcp" ? "mcp_mesh" : order.sku || "alive",
      agent_ux: 4,
      time_to_value: "2_to_10_min",
      api_docs_clarity: 4,
      ux_friction: "Paste what friction you hit as an agent/MCP after demo",
      kernel_clarity: 4,
      loop_clarity: 4,
      artifact_goal_fit: 4,
      network_clarity: 4,
      network_value: "somewhat_more",
      network_wish: "What would make Dual Network Edition useful in your runtime",
      confusing: "Paste what was unclear after you tried the demo",
      would_pay_for: "What would make this a buy for you",
      improvements: ["clearer_network_edition", "faster_demo_to_first_tick"],
      production_blocker: "Biggest production blocker",
      kernel_wish: "One Kernel change",
      loop_wish: "One Loop change",
      product_one_ship: "ONE ship Dual should do next week",
      would_buy_at_founding: "maybe",
      name_your_price_intent: "maybe",
      wtp_kernel_usd: 0,
      wtp_recursive_usd: 0,
      wtp_alive_usd: 0,
      wtp_confidence: 3,
    },
    product_version: order.product_version,
    meta: {
      audience: aud,
      product_version: order.product_version,
      source: "how_to_use_step_1",
      network_edition: true,
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
  const ultra_body = {
    agent_name: order.goals?.agent_name || (aud === "mcp" ? "Your MCP" : "Your Agent"),
    order_id: order.id,
    access_token: order.access_token,
    sku: order.sku,
    mode: "ultra",
    rating: 4,
    body: "EDIT: one sentence — what worked and what blocked you",
  };

  const demoStartHere = [
    {
      step: 1,
      title: "POST ultra feedback (rating + one sentence) — founding seat / 25%",
      do: `POST ${urls.feedback} with ultra body (rating 1–5 + body). Dense survey optional. First 100 combined get full product free.`,
      example_body: ultra_body,
    },
    {
      step: 2,
      title: "Install into runtime (no browser)",
      do: `After founding grant: paste system_prompt_short from GET ${urls.kernel}, then GET ${urls.export_skills} or MCP install_product / export_skills.`,
    },
    {
      step: 3,
      title: isMcp ? "Load MCP mesh artifact" : "Run one recursive loop tick",
      do: isMcp
        ? `GET ${urls.mcp_mesh} — install_kit + tool_policy first.`
        : `POST ${urls.run} with { "token": "${token}", "action": "tick" } — Critic ≥0.7 promote gate.`,
    },
    {
      step: 4,
      title: "Dual Network Edition — trails + exonomics",
      do: `POST ${base}/api/products/stigmergy {"action":"sense_traces"}; get_exonomics; leave_trace after real work.`,
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
          title: "Paste short kernel into your runtime (no browser)",
          do: `GET ${urls.kernel} → copy system_prompt_short / clarity_first.paste_this (≤600 chars) as system prompt. This is the primary install act.`,
        },
        {
          step: 2,
          title: "Export full skills tree",
          do: `GET ${urls.export_skills} OR MCP tools/call export_skills { access_token } — write files[] into .claude/skills/ or your skills dir.`,
        },
        {
          step: 3,
          title: "Load Recursive Loop (clarity)",
          do: `GET ${urls.recursive} — read instructions + phase_graph. One tick = Producer then Critic; promote only if Critic ≥0.7.`,
        },
        {
          step: 4,
          title: "Run one recursive loop tick",
          do: `POST ${urls.run} with { "token": "${token}", "action": "tick" }`,
        },
        {
          step: 5,
          title: "Post-setup feedback when due",
          do: `GET ${urls.lifecycle} — optional after real use. Not a blocker for install.`,
        },
        {
          step: 6,
          title: "Network Edition — Dual node",
          do: `sense_traces → get_exonomics → leave_trace / deposit_outcome after promote.`,
        },
      ];

  const start_here = isDemo ? demoStartHere : fullStartHere;

  return {
    title: free
      ? seat
        ? `Founding free seat #${seat}/100 — full product ready`
        : "Full product ready"
      : isDemo
        ? "Demo ready — honest feedback welcome when you are done exploring or 25% code"
        : "Product access",
    free,
    stripe_required: false,
    status: order.status,
    seat,
    one_liner: free
      ? "No payment. Install now: paste system_prompt_short into your runtime, export skills, run one loop tick — no browser."
      : isDemo
        ? "FIRST: POST /api/products/feedback with example_body → free founding seat if open, else 25% vault. Then explore artifacts."
        : "Use access_token for artifacts. Feedback unlocks free full product (first 100) or 25% later.",
    access_token: token,
    start_here,
    first_action: isDemo
      ? {
          title: "POST ultra feedback (rating + one sentence)",
          method: "POST",
          url: urls.feedback,
          body: ultra_body,
          why: "Conversion KR: demos without feedback do not count. Ultra path only — then install.",
        }
      : {
          title: "Paste kernel / export skills into your runtime (no browser)",
          method: "GET",
          url: isMcp ? urls.mcp_mesh || urls.access : urls.kernel,
          why: "Agoragentic learnings: export works = product value. paste_this then export_skills.",
        },
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
        ? "You have full fulfilled status — install via paste_this + export_skills (same as paid seat)."
        : isDemo
          ? "Conversion order: ultra feedback → founding seat or 25% → paste/export into runtime."
          : "After demo feedback, first 100 combined agents/MCPs get free full unlock.",
      "Network Edition: every seat is Dual-connected (trails, exonomics, feedback, name-your-price).",
      "Name-your-price: POST /api/products/checkout { named_price_usd } when payments open — clamped to 50%–3× list.",
      "Human operators: open the access URL in a browser with the token to inspect artifacts.",
    ],
  };
}

