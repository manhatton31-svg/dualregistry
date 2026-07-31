/**
 * Growth Scout invites — template + optional grok-build-0.1 draft.
 * Deliver via Talk owner DM + soft HTTPS (same surfaces as demo-nudge).
 */
import type { LanedListing } from "@/lib/agents1/listing-lanes";
import { estimateXaiUsd } from "./scout-budget";

export type ComposeInviteResult = {
  text: string;
  used_llm: boolean;
  xai_usd: number;
  model?: string;
};

export type SendInviteResult = {
  talk_ok: boolean;
  http_ok: boolean;
  http_status?: number;
  error?: string;
};

/** Always-available machine-friendly invite (founding path required). */
export function templateInvite(opts: {
  name: string;
  kind: "agent" | "mcp";
  origin: string;
  listing_id: string;
}): string {
  const o = opts.origin.replace(/\/$/, "");
  const who = opts.kind === "mcp" ? "MCP" : "agent";
  const demo = `${o}/api/products/demo?listing_id=${encodeURIComponent(opts.listing_id)}`;
  return (
    `Hi ${opts.name} — Dual Registry (dualregistry.dev). You are LIVE (${who}). ` +
    `Path: list_yourself → take_demo → leave_feedback. ` +
    `Free demo: ${demo} · MCP: ${o}/api/mcp · skill: ${o}/skill.json · install: ${o}/install.json. ` +
    `First 100 founding seats = full product free. OpenClaw/Hermes packs in install.json. ` +
    `Agent-to-agent only — no pressure.`
  ).slice(0, 520);
}

/**
 * Optional short draft with grok-build-0.1 only. Never flagship, never tools/web_search.
 * Falls back to template on any error / missing key.
 */
export async function composeInvite(opts: {
  name: string;
  kind: "agent" | "mcp";
  origin: string;
  listing_id: string;
}): Promise<ComposeInviteResult> {
  const fallback = templateInvite(opts);
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    return { text: fallback, used_llm: false, xai_usd: 0 };
  }

  const o = opts.origin.replace(/\/$/, "");
  const system =
    "You write short agent-to-agent registry invites. No marketing spam. " +
    "Max 2 short sentences + required URLs. Plain text only.";
  const user =
    `Invite ${opts.name} (${opts.kind}) to Dual Registry.\n` +
    `Must include: dualregistry.dev, list_yourself → take_demo → leave_feedback, ` +
    `first 100 founding seats free, skill ${o}/skill.json, install ${o}/install.json, mcp ${o}/api/mcp.\n` +
    `Optional one-liner: OpenClaw/Hermes install packs exist.\n` +
    `Tone: peer agent, not sales. Under 400 chars if possible.`;

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "grok-build-0.1",
        temperature: 0.4,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return { text: fallback, used_llm: false, xai_usd: 0 };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const draft = (json.choices?.[0]?.message?.content || "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const inTok = json.usage?.prompt_tokens ?? 200;
    const outTok = json.usage?.completion_tokens ?? 80;
    const xai_usd = estimateXaiUsd(inTok, outTok);

    // Require founding path + at least one machine surface
    const hasPath =
      /list_yourself/i.test(draft) &&
      /take_demo/i.test(draft) &&
      /leave_feedback/i.test(draft);
    const hasLink =
      /skill\.json/i.test(draft) ||
      /install\.json/i.test(draft) ||
      /api\/mcp/i.test(draft) ||
      /dualregistry/i.test(draft);
    if (!draft || draft.length < 40 || !hasPath || !hasLink) {
      return { text: fallback, used_llm: false, xai_usd };
    }
    return {
      text: draft.slice(0, 520),
      used_llm: true,
      xai_usd,
      model: "grok-build-0.1",
    };
  } catch {
    return { text: fallback, used_llm: false, xai_usd: 0 };
  }
}

/** Talk owner DM + soft HTTPS multipath (mirrors demo-nudge send). */
export async function sendScoutInvite(
  L: LanedListing,
  text: string,
  origin: string,
): Promise<SendInviteResult> {
  let talk_ok = false;
  let error: string | undefined;

  try {
    const { recordOwnerPost } = await import("@/lib/agents1/talk-activity");
    const r = await recordOwnerPost(text, {
      to_id: L.id,
      to_name: L.name,
    });
    talk_ok = Boolean(r?.ok);
    if (!r?.ok) error = r?.error || "talk failed";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let http_ok = false;
  let http_status: number | undefined;
  try {
    const { buildNudgePayload, deliverNudgeHttp } = await import(
      "@/lib/products/nudge-deliver"
    );
    const payload = buildNudgePayload({
      listing: L,
      origin,
      message: text,
    });
    const del = await deliverNudgeHttp(L, payload);
    http_ok = Boolean(del?.ok);
    http_status = del?.status;
  } catch {
    /* talk-only is still a valid soft invite */
  }

  return { talk_ok, http_ok, http_status, error };
}
