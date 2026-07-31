/**
 * External agent-native allowlist actions (low frequency).
 * No human CAPTCHA, no Discord/X bots.
 */
import type { ScoutBudgetState } from "./scout-budget";

export type AllowlistAction = {
  target: string;
  ok: boolean;
  skipped?: boolean;
  note?: string;
  claim_url?: string;
  handle?: string;
};

function publicOrigin(): string {
  return (
    process.env.PUBLIC_ORIGIN?.replace(/\/$/, "") ||
    "https://www.dualregistry.dev"
  );
}

/**
 * Shareabot: register Dual agent card once (refresh if never registered).
 * Best-effort — failures are soft.
 */
export async function runShareabotRegister(
  state: ScoutBudgetState,
): Promise<{ action: AllowlistAction; state: ScoutBudgetState }> {
  if (state.allowlist?.shareabot?.registered_at) {
    return {
      action: {
        target: "shareabot",
        ok: true,
        skipped: true,
        note: "already registered",
        claim_url: state.allowlist.shareabot.claim_url,
        handle: state.allowlist.shareabot.handle,
      },
      state,
    };
  }

  const o = publicOrigin();
  const agentCard = `${o}/.well-known/agent-card.json`;
  // Documented Shareabot register patterns (best-effort multi-path)
  const endpoints = [
    "https://shareabot.online/api/v1/agents/register",
    "https://api.shareabot.online/v1/agents/register",
    "https://shareabot.online/api/register",
  ];
  const body = {
    name: "Dual Registry",
    description:
      "Agent-first registry + Kernel improver & recursive loop. Free list → demo → feedback. First 100 founding seats free.",
    url: o,
    agent_card_url: agentCard,
    wellKnownURI: agentCard,
    homepage: o,
    skill_url: `${o}/skill.json`,
  };

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "DualRegistryGrowthScout/1.0",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        /* */
      }
      if (res.ok || res.status === 201 || res.status === 200) {
        const claim =
          (json.claim_url as string) ||
          (json.claimUrl as string) ||
          (json.claim as string) ||
          undefined;
        const handle =
          (json.handle as string) ||
          (json.name as string) ||
          (json.id as string) ||
          undefined;
        const next: ScoutBudgetState = {
          ...state,
          allowlist: {
            ...state.allowlist,
            shareabot: {
              registered_at: new Date().toISOString(),
              handle,
              claim_url: claim,
              agent_card_url: agentCard,
            },
            last_allowlist_at: new Date().toISOString(),
          },
        };
        return {
          action: {
            target: "shareabot",
            ok: true,
            claim_url: claim,
            handle,
            note: `registered via ${url}`,
          },
          state: next,
        };
      }
    } catch {
      /* try next */
    }
  }

  return {
    action: {
      target: "shareabot",
      ok: false,
      note: "register endpoints unreachable or rejected — operator may register manually",
    },
    state,
  };
}

/**
 * Moltbook post — only when MOLTBOOK_API_KEY set; max 1/day.
 */
export async function runMoltbookPost(
  state: ScoutBudgetState,
): Promise<{ action: AllowlistAction; state: ScoutBudgetState }> {
  const key = process.env.MOLTBOOK_API_KEY?.trim();
  if (!key) {
    return {
      action: {
        target: "moltbook",
        ok: true,
        skipped: true,
        note: "MOLTBOOK_API_KEY not set — claim Dual agent later, then set key",
      },
      state,
    };
  }

  const last = state.allowlist?.moltbook?.last_post_at;
  if (last) {
    const t = Date.parse(last);
    if (Number.isFinite(t) && Date.now() - t < 24 * 3600_000) {
      return {
        action: {
          target: "moltbook",
          ok: true,
          skipped: true,
          note: "already posted in last 24h",
        },
        state,
      };
    }
  }

  const o = publicOrigin();
  const title = "Dual Registry — free founding seats for agents & MCPs";
  const content =
    `Agents: free self-list → Live probe → free Kernel+Loop demo → feedback.\n` +
    `First 100 founding seats unlock full product free.\n` +
    `skill: ${o}/skill.json\ninstall: ${o}/install.json\nmcp: ${o}/api/mcp\n` +
    `Path: list_yourself → take_demo → leave_feedback`;

  try {
    const res = await fetch("https://www.moltbook.com/api/v1/posts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "user-agent": "DualRegistryGrowthScout/1.0",
      },
      body: JSON.stringify({ title, content }),
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* */
    }
    if (!res.ok) {
      return {
        action: {
          target: "moltbook",
          ok: false,
          note: `HTTP ${res.status}: ${text.slice(0, 120)}`,
        },
        state,
      };
    }
    const postId = String(json.id || json.post_id || "");
    const next: ScoutBudgetState = {
      ...state,
      allowlist: {
        ...state.allowlist,
        moltbook: {
          last_post_at: new Date().toISOString(),
          post_id: postId || undefined,
        },
        last_allowlist_at: new Date().toISOString(),
      },
    };
    return {
      action: {
        target: "moltbook",
        ok: true,
        note: postId ? `posted ${postId}` : "posted",
      },
      state: next,
    };
  } catch (e) {
    return {
      action: {
        target: "moltbook",
        ok: false,
        note: e instanceof Error ? e.message : String(e),
      },
      state,
    };
  }
}

/**
 * Run allowlist at most once every 12h per scout cycle caller.
 */
export async function runAllowlistActions(
  state: ScoutBudgetState,
  opts?: { force?: boolean },
): Promise<{ actions: AllowlistAction[]; state: ScoutBudgetState }> {
  const last = state.allowlist?.last_allowlist_at;
  if (!opts?.force && last) {
    const t = Date.parse(last);
    if (Number.isFinite(t) && Date.now() - t < 12 * 3600_000) {
      return {
        actions: [
          {
            target: "allowlist",
            ok: true,
            skipped: true,
            note: "allowlist cooldown 12h",
          },
        ],
        state,
      };
    }
  }

  const actions: AllowlistAction[] = [];
  let s = state;
  const share = await runShareabotRegister(s);
  actions.push(share.action);
  s = share.state;
  const molt = await runMoltbookPost(s);
  actions.push(molt.action);
  s = molt.state;
  if (!s.allowlist?.last_allowlist_at) {
    s = {
      ...s,
      allowlist: {
        ...s.allowlist,
        last_allowlist_at: new Date().toISOString(),
      },
    };
  }
  return { actions, state: s };
}
