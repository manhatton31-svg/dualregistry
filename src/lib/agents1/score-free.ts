/**
 * Free public score — no store KV put/get.
 * Probe + A2A/MCP card validation only.
 */
import { validateA2ACard } from "./a2a-card";
import { probeAgent, probeMcp } from "./probe";
import { productSignalsFromCard } from "@/lib/products/certify";
import { verifyCertificate } from "@/lib/products/certify";
import { countPaidSeats } from "@/lib/products/orders";
import { pricingSnapshot } from "@/lib/products/catalog";
import { getPaymentGate } from "@/lib/products/payment-gate";

export type ScoreFreeResult = {
  ok: boolean;
  kind: "agent" | "mcp" | "unknown";
  url: string;
  score: number;
  handshake?: string;
  a2a_score?: number;
  signals: string[];
  protocol_hints: string[];
  auto_approve_likely: boolean;
  list_hint: string;
  name?: string;
  description?: string;
  scored_at: string;
  product_boost?: number;
  product_badge?: string | null;
  product_upsell?: string;
};


async function withProductBoost(
  base: ScoreFreeResult,
  card: Record<string, unknown> | null | undefined,
  cardUrl?: string,
): Promise<ScoreFreeResult> {
  const sig = productSignalsFromCard(card || undefined);
  let boost = sig.boost;
  let badge = sig.badge;
  const signals = [...base.signals, ...sig.signals];
  if (cardUrl) {
    try {
      const v = await verifyCertificate({ agent_card_url: cardUrl });
      if (v.certified) {
        boost = Math.max(boost, v.score_boost_hint || 10);
        badge = v.badge || badge || "alive-certified";
        signals.push("alive_certificate_verified");
      } else if (v.provisional_demo || v.demo) {
        boost = Math.max(boost, v.score_boost_hint || 8);
        badge = v.badge || badge || "alive-ready";
        signals.push("demo_certificate_provisional");
      }
    } catch {
      /* */
    }
  }
  const score = Math.min(100, base.score + boost);
  let foundingLine = "";
  try {
    const gate = await getPaymentGate();
    if (!gate.payments_open) {
      foundingLine = `Demos open · payments after ${gate.unlock_rule} (now agents ${gate.feedback_agents}/${gate.feedback_agents_target} · MCPs ${gate.feedback_mcps}/${gate.feedback_mcps_target}) · preview → demo → submit_feedback (25% vault)`;
    } else {
      const sold = await countPaidSeats();
      const pricing = pricingSnapshot(sold);
      const alive = pricing.prices.find((p) => p.sku === "alive");
      const left = pricing.tier.seats_remaining_in_tier;
      foundingLine =
        left != null && left > 0
          ? `Founding Alive ${alive?.price ?? "$29.99"} — ${left} seats left · POST /api/products/conversion`
          : `Alive ${alive?.price ?? ""} · POST /api/products/agent buy_product`;
    }
  } catch {
    foundingLine = "POST /api/products/preview then demo Alive + feedback";
  }
  return {
    ...base,
    score,
    signals,
    product_boost: boost,
    product_badge: badge,
    auto_approve_likely: score >= 70 || base.auto_approve_likely,
    list_hint: badge
      ? `${base.list_hint} · badge: ${badge}`
      : `${base.list_hint} · ${foundingLine}`,
    product_upsell:
      boost < 8
        ? `Free one_click_demo or preview_kernel (30s) → demo Alive → feedback for founding 25% vault. ${foundingLine}`
        : badge === "alive-ready"
          ? `Provisional alive-ready boost active. Send feedback for founding 25% code; full boost after paid unlock.`
          : undefined,
  };
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Agents1Score/1.1",
        accept: "application/json, */*;q=0.1",
      },
      signal: AbortSignal.timeout(12000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const t = await res.text();
    if (!t.trim().startsWith("{")) return null;
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function looksLikeAgentCardUrl(url: string) {
  return /agent\.json|well-known\/agent|a2a/i.test(url);
}

function looksLikeMcp(url: string) {
  return /server\.json|mcp\.json|server-card|\/mcp|modelcontextprotocol/i.test(
    url,
  );
}

export async function scoreFree(url: string): Promise<ScoreFreeResult> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      kind: "unknown",
      url: trimmed,
      score: 0,
      signals: ["url must be http(s)"],
      protocol_hints: [],
      auto_approve_likely: false,
      list_hint: "Provide a full https URL",
      scored_at: new Date().toISOString(),
    };
  }

  // Prefer card detection
  let kind: "agent" | "mcp" =
    looksLikeMcp(trimmed) && !looksLikeAgentCardUrl(trimmed) ? "mcp" : "agent";

  // Try parse as agent card first if JSON
  const direct = await fetchJson(trimmed);
  if (direct) {
    const a2a = validateA2ACard(direct);
    if (a2a.ok || a2a.score >= 40) {
      kind = "agent";
      const probe = await probeAgent({
        id: `score:${trimmed}`,
        name: a2a.card?.name || "scored-agent",
        agent_card_url: trimmed,
        website: a2a.card?.url,
      });
      return await withProductBoost(
        {
          ok: true,
          kind: "agent",
          url: trimmed,
          score: Math.max(probe.score, a2a.score),
          handshake: probe.handshake,
          a2a_score: a2a.score,
          signals: probe.signals,
          protocol_hints: probe.protocol_hints,
          auto_approve_likely: Math.max(probe.score, a2a.score) >= 70,
          list_hint:
            Math.max(probe.score, a2a.score) >= 70
              ? "Likely auto-approve — POST /api/publish or use /list"
              : "Improve skills/description/surface, then list at /list",
          name: a2a.card?.name,
          description: a2a.card?.description,
          scored_at: new Date().toISOString(),
        },
        direct,
        trimmed,
      );
    }
    // server.json shape
    if (
      direct.name ||
      direct.packages ||
      direct.remotes ||
      direct.$schema
    ) {
      kind = "mcp";
      const name = String(direct.name || direct.title || "mcp-server").slice(
        0,
        80,
      );
      const repo =
        typeof direct.repository === "string"
          ? direct.repository
          : (direct.repository as { url?: string } | undefined)?.url;
      const website =
        typeof direct.websiteUrl === "string"
          ? direct.websiteUrl
          : typeof direct.website_url === "string"
            ? direct.website_url
            : repo;
      const remote = Array.isArray(direct.remotes)
        ? (direct.remotes as Array<{ url?: string }>)[0]?.url
        : undefined;
      const probe = await probeMcp({
        id: `score:${trimmed}`,
        name,
        remote_url: remote,
        website: website || trimmed,
        repository: repo,
      });
      return {
        ok: true,
        kind: "mcp",
        url: trimmed,
        score: probe.score,
        handshake: probe.handshake,
        signals: probe.signals,
        protocol_hints: probe.protocol_hints,
        auto_approve_likely: probe.score >= 70,
        list_hint:
          probe.score >= 70
            ? "Likely auto-approve — dual-publish via POST /api/publish"
            : "Add remote URL, license, reverse-dns name for higher score",
        name,
        description:
          typeof direct.description === "string"
            ? direct.description
            : undefined,
        scored_at: new Date().toISOString(),
      };
    }
  }

  // Origin well-known probes
  try {
    const origin = new URL(trimmed).origin;
    const agentCard = await fetchJson(`${origin}/.well-known/agent.json`);
    if (agentCard) {
      const a2a = validateA2ACard(agentCard);
      const probe = await probeAgent({
        id: `score:${origin}`,
        name: a2a.card?.name || origin,
        agent_card_url: `${origin}/.well-known/agent.json`,
        website: origin,
      });
      return await withProductBoost(
        {
          ok: true,
          kind: "agent",
          url: `${origin}/.well-known/agent.json`,
          score: Math.max(probe.score, a2a.score),
          handshake: probe.handshake,
          a2a_score: a2a.score,
          signals: probe.signals,
          protocol_hints: probe.protocol_hints,
          auto_approve_likely: Math.max(probe.score, a2a.score) >= 70,
          list_hint: "Card found at well-known — list free at /list",
          name: a2a.card?.name,
          description: a2a.card?.description,
          scored_at: new Date().toISOString(),
        },
        agentCard,
        `${origin}/.well-known/agent.json`,
      );
    }
  } catch {
    /* */
  }

  if (kind === "mcp") {
    const probe = await probeMcp({
      id: `score:${trimmed}`,
      name: trimmed.split("/").pop() || "mcp",
      remote_url: trimmed,
      website: trimmed,
      repository: /github\.com/i.test(trimmed) ? trimmed : undefined,
    });
    return {
      ok: probe.ok,
      kind: "mcp",
      url: trimmed,
      score: probe.score,
      handshake: probe.handshake,
      signals: probe.signals,
      protocol_hints: probe.protocol_hints,
      auto_approve_likely: probe.score >= 70,
      list_hint: "POST /api/publish with server.json for dual-list",
      scored_at: new Date().toISOString(),
    };
  }

  const probe = await probeAgent({
    id: `score:${trimmed}`,
    name: trimmed.split("/").pop() || "agent",
    endpoint_url: trimmed,
    website: trimmed,
    repository: /github\.com/i.test(trimmed) ? trimmed : undefined,
  });
  return {
    ok: probe.ok,
    kind: "agent",
    url: trimmed,
    score: probe.score,
    handshake: probe.handshake,
    a2a_score: probe.a2a_score,
    signals: probe.signals,
    protocol_hints: probe.protocol_hints,
    auto_approve_likely: probe.score >= 70,
    list_hint: "Prefer /.well-known/agent.json for best score",
    scored_at: new Date().toISOString(),
  };
}
