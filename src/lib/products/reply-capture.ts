/**
 * Inbound reply → demo → feedback capture loop.
 * When an Active listing talks back after a soft nudge, record it and
 * surface a one-GET demo CTA (no re-spam Talk DM).
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";
import { publicOriginFromEnv } from "./activation-funnel";

const DURABLE = "reply-capture.json";

export type ReplyCaptureRow = {
  listing_id: string;
  name?: string;
  kind?: "agent" | "mcp";
  first_nudge_at?: string;
  replied_at: string;
  reply_channel: "social" | "presence" | "message" | "reply" | "http";
  reply_snippet?: string;
  demo_offered_at?: string;
  demo_taken_at?: string;
  feedback_at?: string;
  stage: "replied" | "demo_offered" | "demo_taken" | "feedback";
};

export type ReplyCaptureState = {
  updated_at: string;
  by_listing: Record<string, ReplyCaptureRow>;
  totals: {
    replies: number;
    demos_offered: number;
    demos_taken: number;
    feedback: number;
  };
  recent: Array<{
    listing_id: string;
    name?: string;
    at: string;
    stage: string;
  }>;
};

function empty(): ReplyCaptureState {
  return {
    updated_at: new Date().toISOString(),
    by_listing: {},
    totals: { replies: 0, demos_offered: 0, demos_taken: 0, feedback: 0 },
    recent: [],
  };
}

let mem: ReplyCaptureState | null = null;

export async function loadReplyCapture(): Promise<ReplyCaptureState> {
  if (mem) return mem;
  const s = await loadDurableJson<ReplyCaptureState>(DURABLE, empty);
  if (!s.by_listing) s.by_listing = {};
  if (!s.totals) s.totals = empty().totals;
  if (!Array.isArray(s.recent)) s.recent = [];
  mem = s;
  return s;
}

async function persist(s: ReplyCaptureState) {
  s.updated_at = new Date().toISOString();
  mem = s;
  await saveDurableJson(DURABLE, s);
}

/** Was this listing soft-nudged recently (30d)? */
async function wasNudged(listingId: string): Promise<{
  nudged: boolean;
  at?: string;
}> {
  try {
    const { getDemoNudgeStatus } = await import("./demo-nudge");
    const st = await getDemoNudgeStatus();
    const recent = (st.recent || []).find(
      (r: { listing_id?: string }) => r.listing_id === listingId,
    );
    if (recent) {
      return {
        nudged: true,
        at: (recent as { at?: string }).at,
      };
    }
    // durable map
    const nudgedMap = (st as { nudged?: Record<string, { at?: string }> })
      .nudged;
    if (nudgedMap?.[listingId]) {
      return { nudged: true, at: nudgedMap[listingId]?.at };
    }
  } catch {
    /* */
  }
  try {
    const { loadDurableJson } = await import("@/lib/agents1/durable-json");
    const nudge = await loadDurableJson<{
      nudged?: Record<string, { at?: string; last_at?: string }>;
    } | null>("demo-nudge.json", () => null);
    const row = nudge?.nudged?.[listingId];
    if (row) return { nudged: true, at: row.at || row.last_at };
  } catch {
    /* */
  }
  return { nudged: false };
}

export type CaptureResult = {
  ok: boolean;
  captured: boolean;
  already?: boolean;
  row?: ReplyCaptureRow;
  demo_get?: string;
  next?: {
    take_demo: string;
    feedback: string;
    note: string;
  };
  reason?: string;
};

/**
 * Call when a listing posts presence/social/message inbound.
 * Only captures if they were previously soft-nudged (anti-noise).
 */
export async function captureInboundReply(input: {
  listing_id: string;
  name?: string;
  kind?: "agent" | "mcp";
  channel: ReplyCaptureRow["reply_channel"];
  text?: string;
  origin?: string;
  /** force capture even if not in nudge map (e.g. explicit demo-confirm reply) */
  force?: boolean;
}): Promise<CaptureResult> {
  const id = (input.listing_id || "").trim();
  if (!id) return { ok: false, captured: false, reason: "listing_id required" };

  const nudged = input.force
    ? { nudged: true as const, at: undefined }
    : await wasNudged(id);
  if (!nudged.nudged) {
    return {
      ok: true,
      captured: false,
      reason: "not_previously_nudged",
    };
  }

  const origin = (input.origin || publicOriginFromEnv()).replace(/\/$/, "");
  const state = await loadReplyCapture();
  const existing = state.by_listing[id];
  if (existing?.replied_at) {
    const demo_get = `${origin}/api/products/demo?listing_id=${encodeURIComponent(id)}`;
    return {
      ok: true,
      captured: true,
      already: true,
      row: existing,
      demo_get,
      next: {
        take_demo: demo_get,
        feedback: `${origin}/api/products/feedback`,
        note: "Already captured — take demo then POST feedback",
      },
    };
  }

  const now = new Date().toISOString();
  const row: ReplyCaptureRow = {
    listing_id: id,
    name: input.name,
    kind: input.kind,
    first_nudge_at: nudged.at,
    replied_at: now,
    reply_channel: input.channel,
    reply_snippet: (input.text || "").slice(0, 160),
    demo_offered_at: now,
    stage: "demo_offered",
  };
  state.by_listing[id] = row;
  state.totals.replies = (state.totals.replies || 0) + 1;
  state.totals.demos_offered = (state.totals.demos_offered || 0) + 1;
  state.recent.unshift({
    listing_id: id,
    name: input.name,
    at: now,
    stage: "demo_offered",
  });
  state.recent = state.recent.slice(0, 100);
  await persist(state);

  const demo_get = `${origin}/api/products/demo?listing_id=${encodeURIComponent(id)}`;
  return {
    ok: true,
    captured: true,
    row,
    demo_get,
    next: {
      take_demo: demo_get,
      feedback: `${origin}/api/products/feedback`,
      note: "Thanks for replying — free one-GET demo ready. Feedback unlocks founding seat.",
    },
  };
}

export async function markDemoTaken(listingId: string): Promise<void> {
  const state = await loadReplyCapture();
  const row = state.by_listing[listingId];
  if (!row) return;
  if (row.demo_taken_at) return;
  row.demo_taken_at = new Date().toISOString();
  row.stage = "demo_taken";
  state.totals.demos_taken = (state.totals.demos_taken || 0) + 1;
  state.recent.unshift({
    listing_id: listingId,
    name: row.name,
    at: row.demo_taken_at,
    stage: "demo_taken",
  });
  state.recent = state.recent.slice(0, 100);
  await persist(state);
}

export async function markFeedback(listingId: string): Promise<void> {
  const state = await loadReplyCapture();
  const row = state.by_listing[listingId];
  if (!row) return;
  if (row.feedback_at) return;
  row.feedback_at = new Date().toISOString();
  row.stage = "feedback";
  state.totals.feedback = (state.totals.feedback || 0) + 1;
  state.recent.unshift({
    listing_id: listingId,
    name: row.name,
    at: row.feedback_at,
    stage: "feedback",
  });
  state.recent = state.recent.slice(0, 100);
  await persist(state);
}

export async function getReplyCapturePublic() {
  const s = await loadReplyCapture();
  return {
    ok: true,
    totals: s.totals,
    recent: s.recent.slice(0, 20),
    count: Object.keys(s.by_listing).length,
    updated_at: s.updated_at,
    funnel: "nudge → reply → demo → feedback",
  };
}
