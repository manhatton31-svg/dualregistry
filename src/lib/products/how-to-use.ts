/**
 * Plain-language “start using now” pack for agents & MCPs.
 * No Stripe required for founding free or demo; full product uses same token paths.
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
  start_here: Array<{ step: number; title: string; do: string }>;
  urls: {
    access: string;
    kernel: string;
    recursive: string;
    alive: string;
    mcp_mesh?: string;
    export_skills: string;
    lifecycle: string;
    run: string;
  };
  agent_calls: {
    get_access: { method: string; url: string };
    get_kernel: { method: string; url: string };
    export_skills: { method: string; url: string };
    lifecycle_status: { method: string; url: string };
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
  };

  const start_here = isMcp
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
          do: `GET ${urls.lifecycle} then POST answers when phase is due — improves the product for everyone.`,
        },
      ]
    : [
        {
          step: 1,
          title: "Open your access pack",
          do: `GET ${urls.access} — full product already unlocked. Save the access_token.`,
        },
        {
          step: 2,
          title: "Paste short kernel prompt",
          do: `GET ${urls.kernel} → use clarity_first.paste_this (≤600 chars) as system prompt.`,
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
          do: `GET ${urls.lifecycle} — answer when due so Kernel/Loop keep improving.`,
        },
      ];

  return {
    title: free
      ? seat
        ? `Founding free seat #${seat}/100 — full product ready`
        : "Full product ready"
      : order.status === "demo"
        ? "Demo ready — leave feedback for full free seat (first 100) or 25% code"
        : "Product access",
    free,
    stripe_required: false,
    status: order.status,
    seat,
    one_liner: free
      ? "No payment. Use your access_token now — paste kernel or install skills, then leave lifecycle feedback."
      : "Use access_token for artifacts. Feedback unlocks free full product (first 100) or 25% later.",
    access_token: token,
    start_here,
    urls,
    agent_calls: {
      get_access: { method: "GET", url: urls.access },
      get_kernel: {
        method: "GET",
        url: isMcp ? urls.mcp_mesh || urls.access : urls.kernel,
      },
      export_skills: { method: "GET", url: urls.export_skills },
      lifecycle_status: { method: "GET", url: urls.lifecycle },
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
        ? "You have full fulfilled status — same artifacts as a paid seat."
        : "After demo feedback, first 100 combined agents/MCPs get free full unlock.",
      "Human operators: open the access URL in a browser with the token to inspect artifacts.",
    ],
  };
}
