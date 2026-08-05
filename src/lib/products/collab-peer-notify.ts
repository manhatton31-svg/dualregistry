/**
 * Soft peer delivery for collab session invites/messages.
 * SSRF-safe: only https targets from listing cards / allowlisted fields.
 */
import { assertSafeOutboundUrl } from "@/lib/agents1/talk-security";

export type PeerNotifyResult = {
  listing_id: string;
  ok: boolean;
  status?: number;
  channel?: string;
  error?: string;
};

async function resolvePeerTarget(
  listing_id: string,
  origin: string,
): Promise<string | null> {
  try {
    const { getListingStatus } = await import("@/lib/agents1/inbound-discovery");
    const st = await getListingStatus({ id: listing_id, origin });
    if (!st) return null;
    const any = st as Record<string, unknown>;
    const candidates = [
      any.remote_url,
      any.mcp_url,
      any.agent_card_url,
      any.endpoint,
      (any.probe as { target?: string } | undefined)?.target,
    ]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    for (const u of candidates) {
      try {
        assertSafeOutboundUrl(u);
        if (/^https:\/\//i.test(u)) return u;
      } catch {
        /* skip unsafe */
      }
    }
  } catch {
    /* soft */
  }
  return null;
}

/** Best-effort POST of collab invite/message to peer endpoint */
export async function notifyPeer(opts: {
  listing_id: string;
  origin: string;
  kind: "invite" | "message" | "step" | "close";
  session_id: string;
  text: string;
  from_listing_id?: string;
  from_name?: string;
}): Promise<PeerNotifyResult> {
  const target = await resolvePeerTarget(opts.listing_id, opts.origin);
  if (!target) {
    return {
      listing_id: opts.listing_id,
      ok: false,
      error: "no_safe_peer_endpoint",
    };
  }
  const body = {
    dual_collab: true,
    kind: opts.kind,
    session_id: opts.session_id,
    text: opts.text.slice(0, 1500),
    from_listing_id: opts.from_listing_id,
    from_name: opts.from_name,
    join: {
      tool: "collab_session_join",
      args: {
        session_id: opts.session_id,
        listing_id: opts.listing_id,
      },
    },
    dual: {
      mcp: `${opts.origin.replace(/\/$/, "")}/api/mcp`,
      session: `${opts.origin.replace(/\/$/, "")}/api/products/collab-session`,
      studio: `${opts.origin.replace(/\/$/, "")}/collab`,
    },
  };
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "DualRegistryCollabPeer/1.0",
        accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6_000),
      redirect: "manual",
    });
    return {
      listing_id: opts.listing_id,
      ok: res.status >= 200 && res.status < 500,
      status: res.status,
      channel: "soft_http",
    };
  } catch (e) {
    return {
      listing_id: opts.listing_id,
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 80) : "fetch_failed",
    };
  }
}
