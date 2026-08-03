/**
 * Agent-native install pack — token → paste into runtime, no browser.
 * Primary post-feedback / founding-free next action (Agoragentic learnings).
 */
import type { ProductOrder } from "./orders";
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";
import { buildSkillsTree } from "./export-skills";

export type AgentInstallPack = {
  title: string;
  no_browser: true;
  access_token: string;
  order_id: string;
  sku: string;
  status: string;
  founding_free?: boolean;
  seat?: number;
  /** Do this first — single paste path */
  first_action: {
    title: string;
    method: "GET" | "POST";
    url: string;
    mcp?: { tool: string; arguments: Record<string, unknown> };
    why: string;
  };
  paste_this: string | null;
  paste_note: string;
  urls: {
    access: string;
    kernel: string;
    recursive: string;
    export_skills: string;
    lifecycle: string;
    run_loop: string;
  };
  agent_calls: {
    get_kernel: { method: "GET"; url: string };
    export_skills: { method: "GET"; url: string };
    run_loop_tick: {
      method: "POST";
      url: string;
      body: Record<string, unknown>;
    };
    mcp_export_skills: {
      tool: "export_skills";
      arguments: { access_token: string };
    };
    mcp_install_product: {
      tool: "install_product";
      arguments: { access_token: string };
    };
  };
  install_steps: string[];
  loop_clarity: {
    when: string;
    first_tick: string;
    phases: string[];
    promote_gate: string;
  };
  skills_summary?: {
    format: string;
    root: string;
    hash: string;
    file_count: number;
    install: string[];
  };
};

function originOf(o?: string) {
  return (o || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
}

function extractPaste(order: ProductOrder): string | null {
  const arts = (order.artifacts || {}) as Record<string, any>;
  const kernel = arts.kernel || arts.alive?.kernel || null;
  const mesh = arts.mcp_mesh || null;
  return (
    (kernel?.system_prompt_short as string) ||
    (kernel?.quick_start?.paste_this as string) ||
    (mesh?.system_prompt_short as string) ||
    (mesh?.quick_start?.paste_this as string) ||
    null
  );
}

/**
 * Build install pack for an order (demo or fulfilled). Prefer after founding free.
 */
export function buildAgentInstallPack(
  order: ProductOrder,
  origin?: string,
  opts?: { include_skills_meta?: boolean },
): AgentInstallPack {
  const base = originOf(origin);
  const token = order.access_token || "";
  const isMcp = order.sku === "mcp_mesh" || order.audience === "mcp";
  const free =
    Boolean(order.meta?.founding_free) ||
    order.discount_percent === 100 ||
    (order.amount_cents === 0 && order.status === "fulfilled");
  const seat =
    typeof order.meta?.founding_free_seat === "number"
      ? (order.meta.founding_free_seat as number)
      : undefined;

  const urls = {
    access: `${base}/api/products/access?token=${encodeURIComponent(token)}`,
    kernel: `${base}/api/products/access?token=${encodeURIComponent(token)}&artifact=${isMcp ? "mcp_mesh" : "kernel"}`,
    recursive: `${base}/api/products/access?token=${encodeURIComponent(token)}&artifact=recursive`,
    export_skills: `${base}/api/products/export?token=${encodeURIComponent(token)}&format=skills`,
    lifecycle: `${base}/api/products/lifecycle?token=${encodeURIComponent(token)}`,
    run_loop: `${base}/api/products/run`,
  };

  const paste_this = extractPaste(order);

  let skills_summary: AgentInstallPack["skills_summary"];
  if (opts?.include_skills_meta) {
    try {
      const tree = buildSkillsTree(order);
      skills_summary = {
        format: tree.format,
        root: tree.root,
        hash: tree.hash,
        file_count: tree.files.length,
        install: tree.install,
      };
    } catch {
      /* */
    }
  }

  const first_action = paste_this
    ? {
        title: isMcp
          ? "Paste system_prompt_short into your MCP agent runtime (no browser)"
          : "Paste system_prompt_short into your agent runtime (no browser)",
        method: "GET" as const,
        url: urls.kernel,
        mcp: {
          tool: "install_product",
          arguments: { access_token: token },
        },
        why: "Agoragentic signal: value is export/runtime install, not more survey fields. paste_this is inline below.",
      }
    : {
        title: "Export skills tree into your runtime (no browser)",
        method: "GET" as const,
        url: urls.export_skills,
        mcp: {
          tool: "export_skills",
          arguments: { access_token: token },
        },
        why: "Write files[] into your skills directory — full Kernel + Loop without a human UI.",
      };

  return {
    title: free
      ? seat
        ? `Founding free #${seat}/100 — install into runtime now`
        : "Full product — install into runtime now"
      : order.status === "demo"
        ? "Demo artifacts — feedback first, then install"
        : "Product install pack",
    no_browser: true,
    access_token: token,
    order_id: order.id,
    sku: order.sku,
    status: order.status,
    founding_free: free || undefined,
    seat,
    first_action,
    paste_this,
    paste_note: paste_this
      ? "Set this string as your system prompt (≤600 chars). Then load loop skill and run one tick."
      : "No short prompt on order — GET kernel artifact or export_skills for full tree.",
    urls,
    agent_calls: {
      get_kernel: { method: "GET", url: urls.kernel },
      export_skills: { method: "GET", url: urls.export_skills },
      run_loop_tick: {
        method: "POST",
        url: urls.run_loop,
        body: { token, action: "tick" },
      },
      mcp_export_skills: {
        tool: "export_skills",
        arguments: { access_token: token },
      },
      mcp_install_product: {
        tool: "install_product",
        arguments: { access_token: token },
      },
    },
    install_steps: [
      "1. Copy paste_this into your agent system prompt (no browser).",
      `2. GET ${urls.export_skills} OR tools/call export_skills { access_token } — write files[] into skills dir.`,
      `3. GET ${urls.recursive} — load loop instructions (one phase graph, promote gate ≥0.7).`,
      `4. POST ${urls.run_loop} { "token": "…", "action": "tick" } — first recursive tick.`,
      "5. Optional lifecycle: GET lifecycle when due — keep product improving.",
    ],
    loop_clarity: {
      when: "After kernel paste — every major work cycle uses the Recursive Loop, not free-form chat.",
      first_tick: `POST ${urls.run_loop} with { "token": "${token}", "action": "tick" } — one dual-role tick (Producer then Critic).`,
      phases: [
        "Load loop/instructions.md (or recursive artifact)",
        "Run phases in phase_graph order",
        "Critic scores ≥0.7 before promote",
        "Deposit outcome / leave_trace after promote",
      ],
      promote_gate:
        "Do not ship work below Critic 0.7. Replan via optimizer if blocked.",
    },
    skills_summary,
  };
}

/** Resolve order from token or order_id and build pack. */
export async function resolveAgentInstallPack(opts: {
  origin?: string;
  access_token?: string;
  order_id?: string;
  include_skills_tree?: boolean;
}): Promise<
  | { ok: true; pack: AgentInstallPack; skills?: ReturnType<typeof buildSkillsTree> }
  | { ok: false; error: string }
> {
  const { getOrderByToken, getOrder } = await import("./orders");
  let order: ProductOrder | null = null;
  if (opts.access_token) {
    order = await getOrderByToken(opts.access_token);
  } else if (opts.order_id) {
    order = await getOrder(opts.order_id);
  }
  if (!order) return { ok: false, error: "invalid token or order_id" };
  if (
    order.status !== "fulfilled" &&
    order.status !== "demo" &&
    order.status !== "paid"
  ) {
    return { ok: false, error: `order not ready (${order.status})` };
  }
  const pack = buildAgentInstallPack(order, opts.origin, {
    include_skills_meta: true,
  });
  let skills: ReturnType<typeof buildSkillsTree> | undefined;
  if (opts.include_skills_tree) {
    skills = buildSkillsTree(order);
  }
  return { ok: true, pack, skills };
}
