import type { GrowthCandidate } from "./types";
import type { ProbeResult } from "../probe";

export type QualityGateResult = {
  pass: boolean;
  reasons: string[];
  approvalLikelihood: number;
  surfaceTier: 1 | 2 | 3 | 4 | 0;
  protocolTags: string[];
};

const MIN_DESCRIPTION = 40;

function surfaceTier(c: GrowthCandidate): 1 | 2 | 3 | 4 | 0 {
  const hasCard =
    typeof c.agent_card_url === "string" && c.agent_card_url.startsWith("http");
  const hasEndpoint =
    typeof c.endpoint_url === "string" && c.endpoint_url.startsWith("http");
  const hasWebsite =
    typeof c.website === "string" && c.website.startsWith("http");
  const hasRepo =
    typeof c.repository === "string" &&
    /^https?:\/\/github\.com\/[^/]+\/[^/]+/i.test(c.repository);
  const hasRemote =
    typeof c.remote_url === "string" && c.remote_url.startsWith("http");

  if (c.kind === "agent") {
    if (
      hasCard &&
      /well-known\/agent\.json|agent\.json/i.test(c.agent_card_url || "")
    )
      return 1;
    if (hasCard) return 1;
    if (hasEndpoint && !/github\.com\//i.test(c.endpoint_url || "")) return 2;
    if (hasWebsite && !/github\.com\//i.test(c.website || "")) return 3;
    if (hasRepo || hasEndpoint || hasWebsite) return 4;
    return 0;
  }
  if (hasRemote) return 2;
  if (hasWebsite && !/github\.com\//i.test(c.website || "")) return 3;
  if (hasRepo) return 4;
  return 0;
}

function extractProtocolTags(c: GrowthCandidate): string[] {
  const tags = new Set<string>();
  for (const h of c.quality_hints || []) {
    if (h.startsWith("proto:")) tags.add(h.slice(6));
    if (h.startsWith("transport:")) tags.add(h.slice(10));
  }
  for (const p of c.protocols || []) tags.add(p);
  if (c.agent_card_url) tags.add("a2a-card");
  if (c.remote_url) tags.add("remote");
  if (/official-mcp/i.test(c.source)) tags.add("official-mirror");
  return [...tags];
}

export function preflightQualityGate(c: GrowthCandidate): QualityGateResult {
  const reasons: string[] = [];
  let score = 0;
  const tier = surfaceTier(c);
  const protocolTags = extractProtocolTags(c);

  const desc = (c.description || "").trim();
  if (desc.length < MIN_DESCRIPTION) {
    reasons.push(`description too short (${desc.length}<${MIN_DESCRIPTION})`);
  } else {
    score += 15;
    if (desc.length >= 80) score += 5;
  }

  const hasEndpoint =
    typeof c.endpoint_url === "string" && c.endpoint_url.startsWith("http");
  const hasCard =
    typeof c.agent_card_url === "string" && c.agent_card_url.startsWith("http");
  const hasWebsite =
    typeof c.website === "string" && c.website.startsWith("http");
  const hasRepo =
    typeof c.repository === "string" &&
    /^https?:\/\/github\.com\/[^/]+\/[^/]+/i.test(c.repository);
  const hasRemote =
    typeof c.remote_url === "string" && c.remote_url.startsWith("http");

  if (c.kind === "agent") {
    if (tier === 1) score += 40;
    else if (tier === 2) score += 28;
    else if (tier === 3) score += 18;
    else if (tier === 4) score += 8;
    else
      reasons.push(
        "no endpoint, agent card, website, or github repo surface",
      );

    if (!hasEndpoint && !hasCard && !hasWebsite && !hasRepo) {
      reasons.push("missing discovery surface");
    }

    const skills = Array.isArray(c.skills)
      ? c.skills.filter((s) => s?.name)
      : [];
    const caps = Array.isArray(c.capabilities)
      ? c.capabilities.filter(Boolean)
      : [];
    if (skills.length === 0 && caps.length === 0) {
      reasons.push("empty skills and capabilities");
    } else {
      score += Math.min(20, skills.length * 3 + caps.length * 2);
    }

    if (c.protocols?.length) score += 5;
    if (c.framework) score += 3;
    if (protocolTags.includes("a2a-card")) score += 5;
  } else {
    if (hasRemote) score += 25;
    if (hasRepo) score += 15;
    if (hasWebsite) score += 10;
    if (!hasRemote && !hasRepo && !hasWebsite) {
      reasons.push("mcp missing remote_url, repository, and website");
    }
    if (desc.length >= MIN_DESCRIPTION) score += 10;
    // Spec preference
    if (protocolTags.includes("2026-07-28")) score += 8;
    if (protocolTags.includes("streamable-http")) score += 6;
    if (protocolTags.includes("official-mirror") || /official-mcp/i.test(c.source))
      score += 6;
    if (protocolTags.includes("dns-mcp")) score += 5;
  }

  if ((c.name || "").trim().length >= 2) score += 5;
  else reasons.push("invalid name");

  if (/seed:|well-known|agent\.json|official/i.test(c.source)) score += 8;
  if (/^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(c.name)) score += 4; // reverse-dns

  // Probe reputation if attached
  if (typeof c.safety_score === "number" && c.safety_score > 0) {
    score += Math.min(12, Math.round(c.safety_score * 0.12));
  }

  score = Math.min(100, Math.max(0, score));
  const pass = reasons.length === 0 && score >= 25;
  if (!pass && reasons.length === 0) {
    reasons.push(`approval likelihood too low (${score})`);
  }

  return { pass, reasons, approvalLikelihood: score, surfaceTier: tier, protocolTags };
}

export function rankCandidate(
  c: GrowthCandidate,
  store: { mcp: number; agents: number },
  probe?: ProbeResult | null,
): number {
  const gate = preflightQualityGate(c);
  let rank = gate.approvalLikelihood;

  const agentBehind =
    store.agents + 3 < store.mcp;
  const mcpBehind =
    store.mcp + 3 < store.agents;
  const mcpCatchUp = store.agents - store.mcp >= 10;
  if (mcpCatchUp || mcpBehind) {
    if (c.kind === "mcp") rank += mcpCatchUp ? 400 : 200;
    else rank -= mcpCatchUp ? 500 : 80;
  } else if (agentBehind) {
    if (c.kind === "agent") rank += 200;
    else rank -= 50;
  } else {
    // Even-rate: slight preference for whichever is behind by 1+
    if (store.mcp < store.agents && c.kind === "mcp") rank += 80;
    else if (store.agents < store.mcp && c.kind === "agent") rank += 80;
    else if (c.kind === "mcp") rank += 15; // slight MCP bias when equal
  }

  if (gate.surfaceTier === 1) rank += 30;
  else if (gate.surfaceTier === 2) rank += 18;
  else if (gate.surfaceTier === 3) rank += 8;

  if (c.agent_card_url && /well-known\/agent\.json/i.test(c.agent_card_url)) {
    rank += 15;
  }

  // Protocol-native boosts
  if (gate.protocolTags.includes("2026-07-28")) rank += 12;
  if (gate.protocolTags.includes("streamable-http")) rank += 8;
  if (gate.protocolTags.includes("official-mirror")) rank += 10;
  if (gate.protocolTags.includes("a2a-card")) rank += 10;

  // Live probe reputation
  if (probe) {
    rank += Math.round(probe.score * 0.35);
    if (probe.handshake === "ok") rank += 20;
    else if (probe.handshake === "partial") rank += 8;
    else if (probe.handshake === "fail") rank -= 25;
    if (probe.namespace_verified) rank += 10;
  }

  if (!gate.pass) rank -= 120;
  rank -= c.attempts * 3;

  return rank;
}
