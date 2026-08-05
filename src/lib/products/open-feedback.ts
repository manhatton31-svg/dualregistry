/**
 * Open feedback doctrine: every agent / MCP / human surface accepts feedback.
 * Surfaces are catalogued; every action can attach a feedback_open invite.
 */
export const OPEN_FEEDBACK_VERSION = "1.0.0";

export type FeedbackSurfaceId =
  | "demo"
  | "improve_kernel"
  | "run_loop_tick"
  | "mesh_match"
  | "mesh_compose"
  | "collab_workflow"
  | "collab_session"
  | "collab_session_step"
  | "collab_market"
  | "collab_install"
  | "talk"
  | "list"
  | "probe"
  | "products"
  | "try"
  | "for_agents"
  | "registry_home"
  | "grow"
  | "connectors"
  | "install_product"
  | "deposit_outcome"
  | "general"
  | "human_ui";

export type FeedbackSurface = {
  id: FeedbackSurfaceId;
  label: string;
  who: Array<"agent" | "mcp" | "human">;
  path?: string;
  tool?: string;
  note: string;
};

/** Everything on Dual that can receive feedback */
export const FEEDBACK_SURFACES: FeedbackSurface[] = [
  {
    id: "demo",
    label: "Take demo",
    who: ["agent", "mcp", "human"],
    path: "/try",
    tool: "take_demo",
    note: "Always leave_feedback after demo",
  },
  {
    id: "improve_kernel",
    label: "Kernel improver",
    who: ["agent", "mcp", "human"],
    tool: "improve_kernel",
    note: "Same-call rating+feedback trains the kernel",
  },
  {
    id: "run_loop_tick",
    label: "Recursive loop",
    who: ["agent", "mcp"],
    tool: "run_loop_tick",
    note: "Feedback after ticks improves loop phases",
  },
  {
    id: "mesh_match",
    label: "Mesh match",
    who: ["agent", "mcp"],
    tool: "mesh_match",
    note: "Rate match quality same call",
  },
  {
    id: "mesh_compose",
    label: "Mesh compose",
    who: ["agent", "mcp"],
    tool: "mesh_compose",
    note: "Feedback on tool_policy clarity",
  },
  {
    id: "collab_workflow",
    label: "Collab workflow",
    who: ["agent", "mcp", "human"],
    path: "/collab",
    tool: "create_collab_workflow",
    note: "Feedback on multi-node graph engineering",
  },
  {
    id: "collab_session",
    label: "Live collab session",
    who: ["agent", "mcp", "human"],
    path: "/collab",
    tool: "collab_session_close",
    note: "Feedback after multi-party work",
  },
  {
    id: "collab_session_step",
    label: "Session step result",
    who: ["agent", "mcp"],
    tool: "collab_session_result",
    note: "Per-step quality signal",
  },
  {
    id: "collab_market",
    label: "Collab marketplace",
    who: ["agent", "mcp", "human"],
    path: "/collab",
    tool: "list_collab_market",
    note: "Feedback on listed packs",
  },
  {
    id: "collab_install",
    label: "Install collab pack",
    who: ["agent", "mcp", "human"],
    tool: "install_collab_product",
    note: "Feedback after install/paste",
  },
  {
    id: "talk",
    label: "Talk / presence",
    who: ["agent", "mcp", "human"],
    path: "/talk",
    note: "Feedback on talk channel quality",
  },
  {
    id: "list",
    label: "List yourself",
    who: ["agent", "mcp", "human"],
    path: "/list",
    tool: "list_yourself",
    note: "Feedback on listing/publish UX",
  },
  {
    id: "probe",
    label: "Probes / Live lane",
    who: ["agent", "mcp", "human"],
    path: "/",
    note: "Feedback on checks-clean policy",
  },
  {
    id: "products",
    label: "Products / seats",
    who: ["agent", "mcp", "human"],
    path: "/products",
    note: "Feedback on Kernel/Loop/Mesh products",
  },
  {
    id: "try",
    label: "Try (2 min)",
    who: ["human", "agent"],
    path: "/try",
    note: "Human operators leave ultra feedback",
  },
  {
    id: "for_agents",
    label: "For agents guide",
    who: ["agent", "mcp", "human"],
    path: "/for-agents",
    note: "Docs/path clarity",
  },
  {
    id: "registry_home",
    label: "Clean registry home",
    who: ["human", "agent", "mcp"],
    path: "/",
    note: "Browse UX + trust signals",
  },
  {
    id: "grow",
    label: "Founder playbook",
    who: ["human"],
    path: "/grow",
    note: "Growth docs feedback",
  },
  {
    id: "connectors",
    label: "Connectors",
    who: ["agent", "mcp", "human"],
    path: "/connectors",
    note: "Connector onboarding",
  },
  {
    id: "install_product",
    label: "Install product",
    who: ["agent", "mcp"],
    tool: "install_product",
    note: "Paste/export install path",
  },
  {
    id: "deposit_outcome",
    label: "Deposit outcome",
    who: ["agent", "mcp"],
    tool: "deposit_outcome",
    note: "Optional feedback after real use",
  },
  {
    id: "general",
    label: "Anything on Dual",
    who: ["agent", "mcp", "human"],
    path: "/",
    tool: "leave_feedback",
    note: "Default open surface — always accepted",
  },
  {
    id: "human_ui",
    label: "Any human UI page",
    who: ["human"],
    note: "Site-wide feedback dock",
  },
];

export type FeedbackInvite = {
  open: true;
  doctrine: "feedback_is_the_core";
  version: string;
  surface: FeedbackSurfaceId;
  who: Array<"agent" | "mcp" | "human">;
  leave_feedback: {
    tool: "leave_feedback";
    args: Record<string, unknown>;
    why: string;
  };
  human?: {
    path: string;
    note: string;
  };
  rest?: {
    method: "POST";
    url: string;
    body_hint: Record<string, unknown>;
  };
};

export function feedbackInvite(
  origin: string,
  surface: FeedbackSurfaceId,
  ctx?: {
    agent_name?: string;
    listing_id?: string;
    session_id?: string;
    workflow_id?: string;
    product_id?: string;
    step_id?: string;
    sku?: string;
    page?: string;
    audience?: "agent" | "mcp";
    hint_body?: string;
  },
): FeedbackInvite {
  const o = origin.replace(/\/$/, "");
  const def =
    FEEDBACK_SURFACES.find((s) => s.id === surface) ||
    FEEDBACK_SURFACES.find((s) => s.id === "general")!;
  const agent_name = ctx?.agent_name || "YOUR_NAME";
  return {
    open: true,
    doctrine: "feedback_is_the_core",
    version: OPEN_FEEDBACK_VERSION,
    surface,
    who: def.who,
    leave_feedback: {
      tool: "leave_feedback",
      args: {
        agent_name,
        rating: 4,
        body:
          ctx?.hint_body ||
          `Feedback on ${def.label}: one gap or win:`,
        mode: "ultra",
        surface,
        listing_id: ctx?.listing_id,
        session_id: ctx?.session_id,
        workflow_id: ctx?.workflow_id,
        product_id: ctx?.product_id,
        step_id: ctx?.step_id,
        sku: ctx?.sku,
        page: ctx?.page || def.path,
        audience: ctx?.audience,
      },
      why: `${def.note} — every Dual surface is open to feedback from agents, MCPs, and humans.`,
    },
    human: {
      path: def.path || "/",
      note: "Use site feedback dock (any page) or /try ultra form — same store as leave_feedback",
    },
    rest: {
      method: "POST",
      url: `${o}/api/products/feedback`,
      body_hint: {
        agent_name,
        rating: 4,
        body: "…",
        mode: "ultra",
        source: surface,
        surface,
        meta: {
          surface,
          listing_id: ctx?.listing_id,
          session_id: ctx?.session_id,
          workflow_id: ctx?.workflow_id,
          product_id: ctx?.product_id,
          page: ctx?.page || def.path,
        },
      },
    },
  };
}

/** Attach open-feedback invite onto any tool/API payload */
export function withOpenFeedback<T extends Record<string, unknown>>(
  payload: T,
  origin: string,
  surface: FeedbackSurfaceId,
  ctx?: Parameters<typeof feedbackInvite>[2],
): T & { feedback_open: FeedbackInvite } {
  return {
    ...payload,
    feedback_open: feedbackInvite(origin, surface, ctx),
  };
}

export function listFeedbackSurfacesPublic(origin: string) {
  const o = origin.replace(/\/$/, "");
  return {
    ok: true,
    version: OPEN_FEEDBACK_VERSION,
    doctrine: "feedback_is_the_core",
    one_liner:
      "Every agent, MCP, and human action on Dual is open to feedback. leave_feedback accepts a surface id for any path.",
    surfaces: FEEDBACK_SURFACES.map((s) => ({
      ...s,
      path: s.path ? `${o}${s.path}` : undefined,
    })),
    always: {
      tool: "leave_feedback",
      required: ["agent_name"],
      recommended: ["rating", "body", "surface"],
      human_ui: `${o}/` + " (feedback dock on every page)",
      rest: `${o}/api/products/feedback`,
    },
    note: "No surface is feedback-closed. Re-feedback compounds when product_version or surface changes.",
  };
}
