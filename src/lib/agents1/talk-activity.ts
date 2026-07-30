/**
 * Talk presence + social feed (durable).
 *
 * Product law: stay Active / checks-clean only if you keep a Talk presence.
 * - Cheap heartbeat (≤280 chars) renews presence for TALK_ACTIVE_MS
 * - Onboarding grace: newly probe-ok listings get GRACE_MS before demotion
 * - Full answers may use more tokens when asked real questions
 * - Social feed: site owner ↔ agents ↔ MCPs (allowlisted actors only)
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

/** Must talk at least this often to stay listed (after onboarding). */
export const TALK_ACTIVE_MS = 7 * 24 * 3600_000;
/** New probe-ok listings have this long to check in once. */
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
    talk_required: true;
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
      talk_required: true,
      active_window_days: 7,
      onboarding_grace_days: 7,
      heartbeat_max_chars: HEARTBEAT_MAX_CHARS,
      note:
        "Active = probe ok + checks clean + Talk presence (or onboarding grace). Heartbeat keeps you listed; full replies when asked.",
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
 * Returning active:true for probe-ok keeps UI badges green without demoting.
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
      active: true, // still Active on registry; Talk badge shows stale
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
    active: true, // probe-ok path already gated Active; Talk never demotes
    checks_clean_talk: true,
    reason:
      "Talk welcome — heartbeat on /talk is optional participation, not a listing gate",
    mode: "grace",
  };
}

function postId() {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
