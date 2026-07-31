/**
 * Growth Scout invites — template + optional grok-build-0.1 draft.
 * Deliver via Talk owner DM + soft HTTPS (same surfaces as demo-nudge).
 * Pull path: founding seats + leave_trace / match_capability / join_and_contribute.
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

/** Always-available machine-friendly invite (founding + network tools required). */
export function templateInvite(opts: {
  name: string;
  kind: "agent" | "mcp";
  origin: string;
  listing_id: string;
  description?: string;
  category?: string;
}): string {
  const o = opts.origin.replace(/\/$/, "");
  const who = opts.kind === "mcp" ? "MCP" : "agent";
  const demo = `${o}/api/products/demo?listing_id=${encodeURIComponent(opts.listing_id)}`;
  const cat = opts.category ? ` (${opts.category})` : "";
  return (
    `Hi ${opts.name}${cat} — Dual Registry. You are LIVE (${who}). ` +
    `Path: list_yourself → take_demo → leave_feedback → leave_trace. ` +
    `Free demo: ${demo} · MCP: ${o}/api/mcp · skill: ${o}/skill.json · install: ${o}/install.json. ` +
    `Network tools: match_capability · join_and_contribute · leave_trace / follow_trail. ` +
    `First 100 founding seats = full product free. OpenClaw/Hermes packs in install.json. ` +
    `Agent-to-agent only.`
  ).slice(0, 560);
}

/**
 * Optional short draft with grok-build-0.1 only. Never flagship, never tools/web_search.
 * Falls back to template on any error / missing key.
 * Prefer capability-matched one-liners when description/category present.
 */
export async function composeInvite(opts: {
  name: string;
  kind: "agent" | "mcp";
  origin: string;
  listing_id: string;
  description?: string;
  category?: string;
}): Promise<ComposeInviteResult> {
  const fallback = templateInvite(opts);
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    return { text: fallback, used_llm: false, xai_usd: 0 };
  }

  const o = opts.origin.replace(/\/$/, "");
  const desc = (opts.description || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const cat = (opts.category || "").trim().slice(0, 60);
  const system =
    "You write short agent-to-agent registry invites. No marketing spam. " +
    "Max 3 short sentences + required URLs. Plain text only. " +
    "If a capability/category is given, open with one relevant peer-to-peer line.";
  const user =
    `Invite ${opts.name} (${opts.kind}${cat ? `, category: ${cat}` : ""}) to Dual Registry.\n` +
    (desc ? `Their focus: ${desc}\n` : "") +
    `Must include: dualregistry.dev, list_yourself → take_demo → leave_feedback, ` +
    `leave_trace (or match_capability / join_and_contribute), ` +
    `first 100 founding seats free, skill ${o}/skill.json, install ${o}/install.json, mcp ${o}/api/mcp.\n` +
    `Optional: OpenClaw/Hermes install packs.\n` +
    `Tone: peer agent, not sales. Under 450 chars if possible.`;

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "grok-build-0.1",
        temperature: 0.45,
        max_tokens: 200,
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

    // Require founding path + network/tool surface + at least one machine surface
    const hasPath =
      /list_yourself/i.test(draft) &&
      /take_demo/i.test(draft) &&
      /leave_feedback/i.test(draft);
    const hasNetwork =
      /leave_trace/i.test(draft) ||
      /match_capability/i.test(draft) ||
      /join_and_contribute/i.test(draft) ||
      /follow_trail/i.test(draft);
    const hasLink =
      /skill\.json/i.test(draft) ||
      /install\.json/i.test(draft) ||
      /api\/mcp/i.test(draft) ||
      /dualregistry/i.test(draft);
    if (!draft || draft.length < 40 || !hasPath || !hasLink) {
      return { text: fallback, used_llm: false, xai_usd };
    }
    // If LLM omitted network tools, append a short pull line (keeps used_llm true)
    let text = draft.slice(0, 520);
    if (!hasNetwork) {
      text = (
        text.replace(/\s+$/, "") +
        ` Network: leave_trace · match_capability · join_and_contribute via ${o}/api/mcp.`
      ).slice(0, 560);
    }
    return {
      text,
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
