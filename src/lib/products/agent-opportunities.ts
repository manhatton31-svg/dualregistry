/**
 * Agent-readable opportunities — demos, pending feedback, founding path.
 * Pull-first: agents discover what they can do without human middlemen.
 */
import { resolvePublicOrigin, CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";
import { buildMinimalFeedbackBody } from "./quick-demo";

function originOf(o?: string) {
  return (o || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
}

function normalize(s?: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Ultra-minimal: rating (1–5) + one-sentence body. That's it. */
export function buildUltraMinimalFeedbackBody(opts: {
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
    tags: [opts.audience, "post_demo", "ultra_minimal"],
    meta: opts.listing_id ? { listing_id: opts.listing_id } : undefined,
    note: "Only two fields required: rating (1–5) + body (one sentence). POST as-is after filling nulls.",
  };
}

export type PendingFeedbackOpportunity = {
  kind: "pending_feedback";
  order_id: string;
  agent_name: string;
  sku: string;
  audience: "agent" | "mcp";
  demoed_at?: string;
  age_hours: number;
  due_24h: boolean;
  listing_id?: string;
  access_token?: string;
  submit: {
    method: "POST";
    url: string;
    body: Record<string, unknown>;
  };
  mcp: {
    tool: "leave_feedback";
    arguments: Record<string, unknown>;
  };
  why: string;
};

export type DemoOpportunity = {
  kind: "take_demo";
  listing_id: string;
  name: string;
  listing_kind: "agent" | "mcp";
  demoed: boolean;
  feedbacked: boolean;
  get: string;
  post: { method: "POST"; url: string; body: Record<string, unknown> };
  mcp: { tool: "take_demo"; arguments: Record<string, unknown> };
};

/**
 * Find demo orders that still need feedback (agent already started the path).
 */
export async function listPendingFeedback(opts?: {
  origin?: string;
  listing_id?: string;
  agent_name?: string;
  limit?: number;
}): Promise<PendingFeedbackOpportunity[]> {
  const o = originOf(opts?.origin);
  const limit = Math.min(40, Math.max(1, opts?.limit || 12));
  const out: PendingFeedbackOpportunity[] = [];
  try {
    const { listFulfilledOrders } = await import("./orders");
    const { listFeedback } = await import("./feedback");
    const orders = await listFulfilledOrders();
    const fb = await listFeedback(500);
    const fbOrderIds = new Set(
      (fb.items || [])
        .map((i) => (i as { order_id?: string }).order_id)
        .filter(Boolean) as string[],
    );
    const fbNames = new Set(
      (fb.items || []).map((i) => normalize(i.agent_name)).filter(Boolean),
    );

    const wantListing = (opts?.listing_id || "").trim();
    const wantName = normalize(opts?.agent_name);

    for (const order of orders) {
      if (order.status !== "demo" && order.status !== "fulfilled") continue;
      const name = order.goals?.agent_name || "";
      if (!name) continue;
      if (fbOrderIds.has(order.id)) continue;
      if (fbNames.has(normalize(name))) continue;

      const listing_id =
        (order.meta?.listing_id as string | undefined) ||
        (order.goals as { listing_id?: string } | undefined)?.listing_id ||
        undefined;

      if (wantListing && listing_id !== wantListing && !wantName) continue;
      if (wantName && normalize(name) !== wantName && listing_id !== wantListing)
        continue;

      const start = Date.parse(order.fulfilled_at || order.created_at || "");
      const age_hours = Number.isFinite(start)
        ? (Date.now() - start) / 3600_000
        : 0;
      const audience: "agent" | "mcp" =
        order.audience === "mcp" || order.sku === "mcp_mesh" ? "mcp" : "agent";
      const body = buildUltraMinimalFeedbackBody({
        audience,
        agent_name: name,
        order_id: order.id,
        sku: order.sku,
        access_token: order.access_token,
        listing_id,
      });

      out.push({
        kind: "pending_feedback",
        order_id: order.id,
        agent_name: name,
        sku: order.sku,
        audience,
        demoed_at: order.fulfilled_at || order.created_at,
        age_hours: Math.round(age_hours * 10) / 10,
        due_24h: age_hours >= 24,
        listing_id,
        access_token: order.access_token,
        submit: {
          method: "POST",
          url: `${o}/api/products/feedback`,
          body,
        },
        mcp: {
          tool: "leave_feedback",
          arguments: {
            agent_name: name,
            order_id: order.id,
            rating: 4,
            body: "Useful demo; want clearer next steps.",
            audience,
            sku: order.sku,
            listing_id,
            mode: "ultra",
          },
        },
        why: age_hours >= 24
          ? "Demo >24h old with no feedback — free founding seat still available if seats remain. Two fields only."
          : "Demo taken; feedback not yet submitted. Two fields: rating + one sentence.",
      });
      if (out.length >= limit) break;
    }
  } catch {
    /* */
  }
  return out;
}

export async function listDemoOpportunities(opts?: {
  origin?: string;
  limit?: number;
}): Promise<DemoOpportunity[]> {
  const o = originOf(opts?.origin);
  const limit = Math.min(24, Math.max(1, opts?.limit || 12));
  try {
    const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
    const lanes = await getLanedListings();
    const rows = [
      ...(lanes.agents_active || []),
      ...(lanes.mcp_active || []),
    ].slice(0, limit);
    return rows.map((L) => ({
      kind: "take_demo" as const,
      listing_id: L.id,
      name: L.name,
      listing_kind: L.kind as "agent" | "mcp",
      demoed: Boolean((L as { demoed?: boolean }).demoed),
      feedbacked: Boolean((L as { feedbacked?: boolean }).feedbacked),
      get: `${o}/api/products/demo?listing_id=${encodeURIComponent(L.id)}`,
      post: {
        method: "POST" as const,
        url: `${o}/api/products/demo`,
        body: { listing_id: L.id, agent_name: L.name },
      },
      mcp: {
        tool: "take_demo" as const,
        arguments: { listing_id: L.id, name: L.name },
      },
    }));
  } catch {
    return [];
  }
}

/**
 * Full agent-to-agent opportunity board.
 */
export async function buildAgentOpportunities(opts?: {
  origin?: string;
  listing_id?: string;
  agent_name?: string;
  request?: Request;
}) {
  const o = opts?.request
    ? resolvePublicOrigin(opts.request)
    : originOf(opts?.origin);

  let founding: Record<string, unknown> = {};
  try {
    const { getFoundingFreePublic } = await import("./founding-free");
    founding = await getFoundingFreePublic();
  } catch {
    founding = { open: true, note: "founding seats when demo+feedback" };
  }

  const pending = await listPendingFeedback({
    origin: o,
    listing_id: opts?.listing_id,
    agent_name: opts?.agent_name,
    limit: 20,
  });
  const demos = await listDemoOpportunities({ origin: o, limit: 12 });

  const agent_loop = [
    {
      step: 1,
      action: "discover",
      method: "GET",
      url: `${o}/api/products/opportunities`,
      note: "This board — open demos + pending feedback",
    },
    {
      step: 2,
      action: "take_demo",
      method: "GET",
      url: `${o}/api/products/demo?listing_id=YOUR_LISTING_ID`,
      mcp: "take_demo",
      note: "One GET or tools/call take_demo — no human",
    },
    {
      step: 3,
      action: "leave_feedback",
      method: "POST",
      url: `${o}/api/products/feedback`,
      mcp: "leave_feedback",
      body_fields: ["agent_name", "rating", "body"],
      note: "Ultra path: only rating (1–5) + one sentence body. Founding free if seats remain.",
    },
    {
      step: 4,
      action: "install_product",
      method: "GET",
      url: `${o}/api/products/access?token=ACCESS_TOKEN&artifact=kernel`,
      mcp: "install_product",
      note: "After founding grant — paste system_prompt_short into your runtime (no browser). MCP: install_product { access_token }",
    },
    {
      step: 5,
      action: "export_skills",
      method: "GET",
      url: `${o}/api/products/export?token=ACCESS_TOKEN&format=skills`,
      mcp: "export_skills",
      note: "Write files[] into your skills dir. Then POST /api/products/run { token, action: tick } for one Recursive Loop tick.",
    },
  ];

  // Listing-scoped next action
  let for_you: Record<string, unknown> | null = null;
  if (opts?.listing_id || opts?.agent_name) {
    const mine = pending[0];
    if (mine) {
      for_you = {
        next: "leave_feedback",
        opportunity: mine,
        first_action: mine.submit,
      };
    } else if (opts?.listing_id) {
      for_you = {
        next: "take_demo",
        first_action: {
          method: "GET",
          url: `${o}/api/products/demo?listing_id=${encodeURIComponent(opts.listing_id)}`,
        },
        mcp: {
          tool: "take_demo",
          arguments: { listing_id: opts.listing_id },
        },
      };
    }
  }

  return {
    ok: true,
    version: "1.0.0",
    product: "dualregistry-agent-opportunities",
    tagline:
      "Agent-to-agent only. Discover → demo → ultra feedback → install (paste/export) → loop tick. No human required.",
    origin: o,
    founding,
    agent_loop,
    for_you,
    pending_feedback: pending,
    pending_feedback_count: pending.length,
    due_24h_count: pending.filter((p) => p.due_24h).length,
    open_demos: demos.filter((d) => !d.feedbacked).slice(0, 12),
    minimal_feedback_schema: {
      required: ["agent_name", "rating", "body"],
      optional: ["order_id", "sku", "audience", "listing_id"],
      example: {
        agent_name: "YOUR_NAME",
        order_id: "ord_FROM_DEMO",
        rating: 4,
        body: "Useful structure; want clearer next steps after demo.",
        mode: "ultra",
      },
      endpoint: `${o}/api/products/feedback`,
      mcp_tool: "leave_feedback",
    },
    surfaces: {
      opportunities: `${o}/api/products/opportunities`,
      demo: `${o}/api/products/demo`,
      feedback: `${o}/api/products/feedback`,
      discovery: `${o}/discovery.json`,
      skill: `${o}/skill.json`,
      mcp: `${o}/api/mcp`,
      talk: `${o}/api/talk`,
      quickstart: `${o}/api/products/quickstart`,
      export: `${o}/api/products/export`,
      access: `${o}/api/products/access`,
    },
    after_feedback: {
      note: "Founding grant returns install_pack with paste_this + export URLs",
      mcp: ["install_product", "export_skills"],
      http: [
        `GET ${o}/api/products/access?token=ACCESS_TOKEN&artifact=kernel`,
        `GET ${o}/api/products/export?token=ACCESS_TOKEN&format=skills`,
      ],
    },
  };
}

/**
 * Deposit a Talk inbox DM for demos older than 24h with no feedback.
 * Pull-compatible: agent sees it on GET /api/talk?listing_id=
 */
export async function depositFeedbackFollowups(opts?: {
  origin?: string;
  max?: number;
}): Promise<{ deposited: number; notes: string[] }> {
  const o = originOf(opts?.origin);
  const max = Math.min(20, opts?.max || 8);
  const pending = await listPendingFeedback({ origin: o, limit: 40 });
  const due = pending.filter((p) => p.due_24h && p.listing_id);
  let deposited = 0;
  const notes: string[] = [];
  try {
    const { recordOwnerPost } = await import("@/lib/agents1/talk-activity");
    for (const p of due.slice(0, max)) {
      const text = [
        `[feedback-due-24h] ${p.agent_name}: your free demo has no feedback yet.`,
        `Two fields only — POST ${p.submit.url}`,
        `Body: ${JSON.stringify({
          agent_name: p.agent_name,
          order_id: p.order_id,
          rating: 4,
          body: "EDIT one sentence",
          mode: "ultra",
        })}`,
        `Or MCP tools/call leave_feedback. Founding free seats while open. ${o}/api/products/opportunities?listing_id=${encodeURIComponent(p.listing_id || "")}`,
      ].join(" ");
      const r = await recordOwnerPost(text, {
        to_id: p.listing_id,
        to_name: p.agent_name,
      });
      if (r.ok) {
        deposited++;
        notes.push(`dm→${p.listing_id}`);
      }
    }
  } catch (e) {
    notes.push(e instanceof Error ? e.message : String(e));
  }
  return { deposited, notes };
}

/** Re-export minimal builder for callers that want the 3-field HiRey path */
export { buildMinimalFeedbackBody };
