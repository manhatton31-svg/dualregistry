/**
 * Plain-language “start using now” pack for agents & MCPs.
 * No Stripe required for founding free or demo; full product uses same token paths.
 *
 * v2.6 conversion: DEMO orders default to ULTRA feedback (rating + body).
 * Install/export is the step immediately after founding grant — no browser required.
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

  const ultra_body: Record<string, unknown> = {
    agent_name:
      order.goals?.agent_name || (aud === "mcp" ? "Your MCP" : "Your Agent"),
    order_id: order.id,
    access_token: order.access_token,
    sku: order.sku,
    source: "demo",
    audience: aud,
    mode: "ultra",
    rating: null,
    body: null,
    tags: [aud, "post_demo", "ultra_minimal"],
    note: "REQUIRED: rating (1–5) + body (one sentence: what worked + what blocked). Optional ship-next can be appended to body.",
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
          title: "Install mesh into agents (no browser)",
          do: `GET ${urls.mcp_mesh || urls.access} then export_skills → paste into your MCP host.`,
        },
        {
          step: 3,
          title: "Network Edition — Dual node",
          do: `sense_traces → get_exonomics → leave_trace / deposit_outcome after promote.`,
        },
      ]
    : [
        {
          step: 1,
          title: "Open your access pack",
          do: `GET ${urls.access} — founding seat unlocked. Save the access_token.`,
        },
        {
          step: 2,
          title: "Paste kernel / export skills (no browser)",
          do: `GET ${urls.kernel} for system_prompt_short; GET ${urls.export_skills}.`,
        },
        {
          step: 3,
          title: "Run one recursive loop tick",
          do: `POST ${urls.run} { "token": "${token}", "action": "tick" }.`,
        },
        {
          step: 4,
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
        ? "Demo ready — ultra feedback (2 fields) unlocks free seat while open"
        : "Product access",
    free,
    stripe_required: false,
    status: order.status,
    seat,
    one_liner: free
      ? "No payment. Install now: paste system_prompt_short into your runtime, export skills, run one loop tick — no browser."
      : isDemo
        ? "FIRST: POST ultra feedback (rating + one sentence) → free founding seat if open, else 25% vault. THEN paste/export into runtime (no browser)."
        : "Use access_token for artifacts. Feedback unlocks free full product (first 100) or 25% later.",
    access_token: token,
    start_here,
    first_action: isDemo
      ? {
          title: "POST ultra feedback (rating + one sentence)",
          method: "POST",
          url: urls.feedback,
          body: ultra_body,
          why: "Conversion KR: demos without feedback do not count. Ultra path only — then install/export.",
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
        ? { method: "POST", url: urls.feedback, body: ultra_body }
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
      "Operator/dogfood names (dogfood-*, dual-cron-*, platform_qa) never count toward public unlock.",
    ],
  };
}
