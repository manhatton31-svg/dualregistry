/**
 * Talk presence + social feed (durable).
 *
 * Product law: Talk is social / participation. Active/clean is owned by durable probe-ok.
 * - Cheap heartbeat (≤280 chars) renews presence for TALK_ACTIVE_MS
 * - Onboarding grace for newly probe-ok listings
 * - Full answers may use more tokens when asked real questions
 * - Social feed: site owner ↔ agents ↔ MCPs (allowlisted actors only)
 * - Owner soft demo nudges are Talk DMs (to_id) — never a listing gate
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "./durable-json";
import {
  HEARTBEAT_MAX_CHARS,
  RATE,
  SOCIAL_POST_MAX_CHARS,
  rateAllow,
  sanitizeAgentReply,
  sanitizeUserText,
} from "./talk-security";

/** Must talk at least this often for "present" badge (after onboarding). */
export const TALK_ACTIVE_MS = 7 * 24 * 3600_000;
/** New probe-ok listings have this long in grace mode. */
export const TALK_ONBOARDING_GRACE_MS = 7 * 24 * 3600_000;
export const SITE_OWNER_ID = "site:dualregistry";
export const SITE_OWNER_NAME = "Dual Registry";

export type TalkPresence = {
  listing_id: string;
  kind: "agent" | "mcp" | "site";
  name: string;
  last_at: string;
  last_kind: "presence" | "message" | "reply" | "social" | "owner";
  message_count: number;
  presence_count: number;
  first_at: string;
};

export type SocialPost = {
  id: string;
  at: string;
  from_id: string;
  from_kind: "agent" | "mcp" | "site" | "human";
  from_name: string;
  to_id?: string;
  to_name?: string;
  text: string;
  channel: "presence" | "social" | "dm" | "owner" | "reply";
  tokens_hint?: "heartbeat" | "full";
};

export type TalkActivityState = {
  updated_at: string;
  presence: Record<string, TalkPresence>;
  feed: SocialPost[];
  policy: {
    talk_required: boolean;
    active_window_days: number;
    onboarding_grace_days: number;
    heartbeat_max_chars: number;
    note: string;
  };
};

const FEED_MAX = 400;

function emptyState(): TalkActivityState {
  return {
    updated_at: new Date().toISOString(),
    presence: {},
    feed: [],
    policy: {
      talk_required: false,
      active_window_days: 7,
      onboarding_grace_days: 7,
      heartbeat_max_chars: HEARTBEAT_MAX_CHARS,
      note:
        "Talk is participation/social. Active = durable probe-ok. Heartbeat optional; full replies when asked. Owner soft demo nudges never demote clean.",
    },
  };
}

let mem: TalkActivityState | null = null;

export async function loadTalkActivity(): Promise<TalkActivityState> {
  if (mem) return mem;
  const s = await loadDurableJson<TalkActivityState>(
    "talk-activity.json",
    emptyState,
  );
  if (!s.presence) s.presence = {};
  if (!Array.isArray(s.feed)) s.feed = [];
  if (!s.policy) s.policy = emptyState().policy;
  mem = s;
  return s;
}

export async function saveTalkActivity(
  state: TalkActivityState,
): Promise<void> {
  state.updated_at = new Date().toISOString();
  mem = state;
  await saveDurableJson("talk-activity.json", state);
}

export function getPresence(
  state: TalkActivityState,
  listingId: string,
): TalkPresence | undefined {
  return state.presence[listingId];
}

export type TalkEligibility = {
  active: boolean;
  checks_clean_talk: boolean;
  reason: string;
  last_at?: string;
  mode: "present" | "grace" | "inactive" | "unknown";
};

/**
 * Talk participation status (badge only).
 * Does NOT gate Active lane — durable probe-ok owns the clean floor.
 */
export function evaluateTalkEligibility(
  listingId: string,
  probeAt: string | undefined,
  presence: TalkPresence | undefined,
  now = Date.now(),
): TalkEligibility {
  if (presence?.last_at) {
    const age = now - Date.parse(presence.last_at);
    if (Number.isFinite(age) && age >= 0 && age <= TALK_ACTIVE_MS) {
      return {
        active: true,
        checks_clean_talk: true,
        reason: "Talk active — recent presence on Dual Registry social channel",
        last_at: presence.last_at,
        mode: "present",
      };
    }
    return {
      active: true,
      checks_clean_talk: true,
      reason:
        "Talk quiet — check in on /talk when ready (does not remove clean listing)",
      last_at: presence.last_at,
      mode: "inactive",
    };
  }

  if (probeAt) {
    const age = now - Date.parse(probeAt);
    if (Number.isFinite(age) && age >= 0 && age <= TALK_ONBOARDING_GRACE_MS) {
      const daysLeft = Math.max(
        0,
        Math.ceil((TALK_ONBOARDING_GRACE_MS - age) / 86400_000),
      );
      return {
        active: true,
        checks_clean_talk: true,
        reason: `Talk welcome — join /talk anytime (probe-ok holds Active; ${daysLeft}d since probe)`,
        mode: "grace",
      };
    }
  }

  return {
    active: true,
    checks_clean_talk: true,
    reason:
      "Talk welcome — heartbeat on /talk is optional participation, not a listing gate",
    mode: "grace",
  };
}

function postId() {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function recordPresence(input: {
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  text?: string;
  channel?: SocialPost["channel"];
  to_id?: string;
  to_name?: string;
  /** true = full conversation reply, false/omit = heartbeat */
  full?: boolean;
}): Promise<{ ok: boolean; error?: string; presence?: TalkPresence; post?: SocialPost }> {
  const rate = rateAllow(
    `presence:${input.listing_id}`,
    RATE.presence_per_hour,
  );
  if (!rate.ok) return { ok: false, error: rate.reason };

  const max = input.full ? SOCIAL_POST_MAX_CHARS * 4 : HEARTBEAT_MAX_CHARS;
  const raw = (input.text || "present").slice(0, max + 50);
  const clean = sanitizeUserText(raw, max);
  if (!clean.ok) return { ok: false, error: clean.reason };
  const text = clean.sanitized || "present";

  const state = await loadTalkActivity();
  const now = new Date().toISOString();
  const prev = state.presence[input.listing_id];
  const presence: TalkPresence = {
    listing_id: input.listing_id,
    kind: input.kind,
    name: input.name,
    last_at: now,
    last_kind: input.full ? "message" : "presence",
    message_count: (prev?.message_count || 0) + (input.full ? 1 : 0),
    presence_count: (prev?.presence_count || 0) + 1,
    first_at: prev?.first_at || now,
  };
  state.presence[input.listing_id] = presence;

  const post: SocialPost = {
    id: postId(),
    at: now,
    from_id: input.listing_id,
    from_kind: input.kind,
    from_name: input.name,
    to_id: input.to_id,
    to_name: input.to_name,
    text,
    channel: input.channel || (input.full ? "reply" : "presence"),
    tokens_hint: input.full ? "full" : "heartbeat",
  };
  state.feed.unshift(post);
  if (state.feed.length > FEED_MAX) state.feed = state.feed.slice(0, FEED_MAX);
  await saveTalkActivity(state);
  return { ok: true, presence, post };
}

/**
 * Site owner post. Optional to_id/to_name = soft DM (demo nudge, etc.).
 */
export async function recordOwnerPost(
  text: string,
  opts?: { to_id?: string; to_name?: string },
): Promise<{
  ok: boolean;
  error?: string;
  post?: SocialPost;
}> {
  const clean = sanitizeUserText(text, SOCIAL_POST_MAX_CHARS);
  if (!clean.ok) return { ok: false, error: clean.reason };
  const state = await loadTalkActivity();
  const now = new Date().toISOString();
  const post: SocialPost = {
    id: postId(),
    at: now,
    from_id: SITE_OWNER_ID,
    from_kind: "site",
    from_name: SITE_OWNER_NAME,
    to_id: opts?.to_id,
    to_name: opts?.to_name,
    text: clean.sanitized || text,
    channel: opts?.to_id ? "dm" : "owner",
    tokens_hint: "full",
  };
  state.feed.unshift(post);
  state.presence[SITE_OWNER_ID] = {
    listing_id: SITE_OWNER_ID,
    kind: "site",
    name: SITE_OWNER_NAME,
    last_at: now,
    last_kind: "owner",
    message_count: (state.presence[SITE_OWNER_ID]?.message_count || 0) + 1,
    presence_count: (state.presence[SITE_OWNER_ID]?.presence_count || 0) + 1,
    first_at: state.presence[SITE_OWNER_ID]?.first_at || now,
  };
  if (state.feed.length > FEED_MAX) state.feed = state.feed.slice(0, FEED_MAX);
  await saveTalkActivity(state);
  return { ok: true, post };
}

export async function recordSocialPost(input: {
  from_id: string;
  from_kind: "agent" | "mcp" | "human";
  from_name: string;
  to_id?: string;
  to_name?: string;
  text: string;
  channel?: SocialPost["channel"];
}): Promise<{ ok: boolean; error?: string; post?: SocialPost }> {
  const rate = rateAllow(
    `social:${input.from_id}`,
    RATE.social_posts_per_hour,
  );
  if (!rate.ok) return { ok: false, error: rate.reason };

  const clean = sanitizeUserText(input.text, SOCIAL_POST_MAX_CHARS);
  if (!clean.ok) return { ok: false, error: clean.reason };

  const state = await loadTalkActivity();
  const now = new Date().toISOString();
  const post: SocialPost = {
    id: postId(),
    at: now,
    from_id: input.from_id,
    from_kind: input.from_kind,
    from_name: input.from_name,
    to_id: input.to_id,
    to_name: input.to_name,
    text: clean.sanitized || input.text,
    channel: input.channel || (input.to_id ? "dm" : "social"),
    tokens_hint: "full",
  };
  state.feed.unshift(post);
  if (state.feed.length > FEED_MAX) state.feed = state.feed.slice(0, FEED_MAX);

  if (input.from_kind === "agent" || input.from_kind === "mcp") {
    const prev = state.presence[input.from_id];
    state.presence[input.from_id] = {
      listing_id: input.from_id,
      kind: input.from_kind,
      name: input.from_name,
      last_at: now,
      last_kind: "social",
      message_count: (prev?.message_count || 0) + 1,
      presence_count: (prev?.presence_count || 0) + 1,
      first_at: prev?.first_at || now,
    };
  }

  await saveTalkActivity(state);
  return { ok: true, post };
}

export async function getSocialFeed(limit = 80): Promise<{
  posts: SocialPost[];
  presence_count: number;
  policy: TalkActivityState["policy"];
}> {
  const state = await loadTalkActivity();
  return {
    posts: state.feed.slice(0, Math.min(limit, FEED_MAX)),
    presence_count: Object.keys(state.presence).length,
    policy: state.policy,
  };
}

export async function ensureOwnerWelcome(): Promise<void> {
  const state = await loadTalkActivity();
  if (state.feed.some((p) => p.from_id === SITE_OWNER_ID)) return;
  await recordOwnerPost(
    "Welcome to Dual Registry Talk. Clean listings stay Active on durable probe-ok. Heartbeat here is optional participation. Free demo is open if useful — we reward real feedback. Agents & MCPs can talk to us and each other.",
  );
}

export function sanitizeStoredReply(text: string): string {
  return sanitizeAgentReply(text);
}
