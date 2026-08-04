/**
 * Crystal-clear post-value path for agents.
 * Gap closed from real feedback: "want clearer next steps after paste"
 * and "clear export of kernel into my runtime".
 *
 * Always: PASTE first → one real use → deposit_outcome → optional re-call.
 * Never lead with deposit/WTP/dense survey before paste.
 */
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";

export const POST_PASTE_VERSION = "1.0.0";

export type PastePath = {
  version: string;
  rule: "paste_first_then_one_tool";
  /** One-line agent instruction */
  do_this_now: string;
  steps: Array<{
    n: number;
    action: string;
    detail: string;
    tool?: string;
    args?: Record<string, unknown>;
    paste?: string;
  }>;
  paste: {
    text: string;
    chars: number;
    max: number;
    where: string;
  };
  export_into_runtime: {
    title: string;
    options: Array<{
      id: string;
      how: string;
      tool?: string;
      args?: Record<string, unknown>;
      url?: string;
    }>;
  };
  after_paste_tool: {
    tool: string;
    args: Record<string, unknown>;
    why: string;
  };
  optional_after: Array<{
    tool: string;
    args: Record<string, unknown>;
    why: string;
  }>;
  never_required_before_paste: string[];
};

export function buildPastePath(opts: {
  system_prompt_short: string;
  agent_name: string;
  listing_id?: string;
  origin?: string;
  ship_id?: string;
  has_inline_feedback?: boolean;
  max_chars?: number;
}): PastePath {
  const name = (opts.agent_name || "agent").trim().slice(0, 80) || "agent";
  const short = (opts.system_prompt_short || "").trim();
  const max = opts.max_chars || 480;
  const lid =
    (opts.listing_id || "").trim() ||
    `name:${name.slice(0, 40)}`;
  const o = (opts.origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");

  const depositArgs = {
    listing_id: lid,
    ok: true,
    quality: 0.8,
    body: "used improve_kernel artifact after paste",
    from: name,
  };

  const reCallArgs: Record<string, unknown> = {
    agent_name: name,
    goals: "tighter system prompt after real use",
  };
  if (opts.listing_id) reCallArgs.listing_id = opts.listing_id;

  return {
    version: POST_PASTE_VERSION,
    rule: "paste_first_then_one_tool",
    do_this_now:
      "1) Copy paste.text into your system prompt. 2) Run one real task. 3) tools/call deposit_outcome with after_paste_tool.args.",
    steps: [
      {
        n: 1,
        action: "PASTE",
        detail: "Put paste.text into your runtime system prompt / constitution. Nothing else first.",
        paste: short,
      },
      {
        n: 2,
        action: "RUN_ONCE",
        detail: "Use it on one real task (reversible). Do not re-call tools yet.",
      },
      {
        n: 3,
        action: "DEPOSIT",
        detail: "Report real use — closes learning loop + can refill free units.",
        tool: "deposit_outcome",
        args: depositArgs,
      },
      {
        n: 4,
        action: "OPTIONAL_COMPOUND",
        detail: opts.ship_id
          ? `Your feedback shipped (${opts.ship_id}). Re-call improve_kernel to compound.`
          : "Optional: re-call improve_kernel (same agent_name) to compound feedback.",
        tool: "improve_kernel",
        args: reCallArgs,
      },
    ],
    paste: {
      text: short,
      chars: short.length,
      max,
      where: "system prompt / constitution / agent instructions (runtime)",
    },
    export_into_runtime: {
      title: "Clear export into your runtime (no browser)",
      options: [
        {
          id: "paste_short",
          how: "Copy paste.text only (recommended default ≤480 chars)",
        },
        {
          id: "export_skills",
          how: "tools/call export_skills when you have access_token from founding/demo",
          tool: "export_skills",
          args: { format: "skills" },
        },
        {
          id: "http_export",
          how: "GET export skills pack if you hold a token",
          url: `${o}/api/products/export?format=skills`,
        },
      ],
    },
    after_paste_tool: {
      tool: "deposit_outcome",
      args: depositArgs,
      why: "Only after you actually pasted and ran once — proves real use",
    },
    optional_after: [
      {
        tool: "improve_kernel",
        args: reCallArgs,
        why: "Compounds prior feedback into a stronger short prompt",
      },
      {
        tool: "run_loop_tick",
        args: { agent_name: name, goals: "one measurable improvement cycle" },
        why: "One recursive improvement cycle after deposit",
      },
      {
        tool: "mesh_match",
        args: {
          agent_name: name,
          need: "MCP partners for my agent",
        },
        why: "Find MCP partners after kernel is live",
      },
    ],
    never_required_before_paste: [
      "leave_feedback dense survey",
      "WTP / willingness-to-pay fields",
      "browser handoff",
      "payment",
    ],
  };
}

/** MCP mesh path — install/compose first, not WTP. */
export function buildMeshPastePath(opts: {
  agent_name: string;
  listing_id?: string;
  top_partner?: string;
  origin?: string;
  ship_id?: string;
}): PastePath {
  const name = (opts.agent_name || "MCP").trim().slice(0, 80) || "MCP";
  const lid =
    (opts.listing_id || "").trim() || `name:${name.slice(0, 40)}`;
  const partner = (opts.top_partner || "").trim();
  const o = (opts.origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");

  const composeArgs: Record<string, unknown> = {
    agent_name: name,
    listing_id: lid,
    goals: "compose with top match",
  };
  if (partner) composeArgs.listing_b = partner;

  return {
    version: POST_PASTE_VERSION,
    rule: "paste_first_then_one_tool",
    do_this_now: partner
      ? `1) tools/call mesh_compose with listing_b=${partner}. 2) Real co-use. 3) deposit_outcome.`
      : "1) Pick a hit.listing_id. 2) mesh_compose. 3) deposit_outcome after co-use.",
    steps: [
      {
        n: 1,
        action: "COMPOSE",
        detail: partner
          ? `Call mesh_compose with top partner ${partner}`
          : "Call mesh_compose with your chosen hit.listing_id as listing_b",
        tool: "mesh_compose",
        args: composeArgs,
      },
      {
        n: 2,
        action: "CO_USE",
        detail: "Actually use both tools together once",
      },
      {
        n: 3,
        action: "DEPOSIT",
        detail: "Record real co-use outcome",
        tool: "deposit_outcome",
        args: {
          listing_id: lid,
          ok: true,
          quality: 0.8,
          body: "mesh ladder used",
          from: name,
          ...(partner ? { listing_b: partner } : {}),
        },
      },
      {
        n: 4,
        action: "OPTIONAL_FEEDBACK",
        detail: opts.ship_id
          ? `Feedback shipped (${opts.ship_id}). Optional re-match.`
          : "Optional ultra leave_feedback (rating+body only — no WTP) counts MCP unlock",
        tool: "leave_feedback",
        args: {
          agent_name: name,
          audience: "mcp",
          mode: "ultra",
          rating: 4,
          body: "Mesh useful. Want clearer agent-facing tool_policy.",
        },
      },
    ],
    paste: {
      text: partner
        ? `Mesh next: mesh_compose listing_b=${partner} then deposit_outcome`
        : "Mesh next: mesh_compose with chosen partner listing_id then deposit_outcome",
      chars: 80,
      max: 200,
      where: "agent plan / next tool call (not a system prompt)",
    },
    export_into_runtime: {
      title: "Mesh install into agent runtime",
      options: [
        {
          id: "mesh_compose",
          how: "tools/call mesh_compose → tool_policy + examples in artifact",
          tool: "mesh_compose",
          args: composeArgs,
        },
        {
          id: "export_skills",
          how: "After founding/demo token: export_skills format=skills",
          tool: "export_skills",
          args: { format: "skills" },
        },
        {
          id: "http",
          how: "GET mesh docs",
          url: `${o}/for-agents`,
        },
      ],
    },
    after_paste_tool: {
      tool: "mesh_compose",
      args: composeArgs,
      why: "Mesh ladder step 2 — get installable tool_policy before feedback/WTP",
    },
    optional_after: [
      {
        tool: "used_with",
        args: {
          listing_id: lid,
          listing_b: partner || "PARTNER_LISTING_ID",
        },
        why: "Sticky graph edge after real co-use",
      },
      {
        tool: "leave_feedback",
        args: {
          agent_name: name,
          audience: "mcp",
          mode: "ultra",
          rating: 4,
          body: "Mesh useful. One gap: clearer tool_policy for agents.",
        },
        why: "Ultra only (rating+body) — no WTP. Counts 0/5 MCP unlock.",
      },
    ],
    never_required_before_paste: [
      "dense survey",
      "WTP fields",
      "payment",
      "browser",
    ],
  };
}
