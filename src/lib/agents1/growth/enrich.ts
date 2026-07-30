import { deriveAgentIntentMeta } from "../intent-meta";
import { validateA2ACard } from "../a2a-card";
import { resolveMcpDns } from "../probe";
import type { GrowthCandidate } from "./types";

const UA = "Agents1GrowthBot/1.1";

async function fetchJson(url: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "application/json, */*;q=0.1" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim().startsWith("{")) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function cardCandidates(c: GrowthCandidate): string[] {
  const out: string[] = [];
  const add = (u?: string) => {
    if (u && u.startsWith("http") && !out.includes(u)) out.push(u);
  };
  add(c.agent_card_url);
  if (c.website) {
    try {
      const o = new URL(c.website);
      add(`${o.origin}/.well-known/agent.json`);
      add(`${o.origin}/agent.json`);
    } catch {
      /* */
    }
  }
  if (c.endpoint_url && c.endpoint_url !== c.website) {
    try {
      const o = new URL(c.endpoint_url);
      add(`${o.origin}/.well-known/agent.json`);
    } catch {
      /* */
    }
  }
  if (c.repository) {
    const m = c.repository.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/i,
    );
    if (m) {
      const repo = m[2].replace(/\.git$/i, "");
      add(
        `https://raw.githubusercontent.com/${m[1]}/${repo}/main/.well-known/agent.json`,
      );
      add(
        `https://raw.githubusercontent.com/${m[1]}/${repo}/main/agent.json`,
      );
    }
  }
  return out;
}

export async function enrichCandidate(
  c: GrowthCandidate,
): Promise<GrowthCandidate> {
  const next: GrowthCandidate = { ...c, updated_at: new Date().toISOString() };
  const hints = [...(c.quality_hints || [])];

  if (c.kind === "agent") {
    for (const url of cardCandidates(c)) {
      const card = await fetchJson(url);
      if (!card) continue;
      const v = validateA2ACard(card);
      if (v.score >= 30) {
        hints.push(`a2a-validate ${v.score}`);
        if (v.card?.name) next.name = v.card.name.slice(0, 80);
        if (v.card?.description && v.card.description.length > 20) {
          next.description = v.card.description.slice(0, 600);
        }
        if (v.card?.url) {
          next.endpoint_url = v.card.url;
          next.website = next.website || v.card.url;
        }
        if (v.card?.skills?.length) next.skills = v.card.skills;
        if (v.card?.protocols?.length) next.protocols = v.card.protocols;
        next.agent_card_url = url;
        hints.push(`card ${url}`);
        if (!hints.includes("proto:a2a")) hints.push("proto:a2a");
        if (!hints.includes("a2a-card")) hints.push("a2a-card");
        break;
      }
    }
    if (!next.protocols?.length) next.protocols = ["a2a", "rest"];
    if (!next.endpoint_url) {
      next.endpoint_url = next.website || next.repository;
    }
    if (!next.website) {
      next.website = next.endpoint_url || next.repository;
    }
    const intent = deriveAgentIntentMeta(next);
    next.skills = intent.skills;
    next.capabilities = intent.capabilities;
    hints.push(intent.detail);
  } else {
    // MCP: DNS _mcp + well-known server-card
    if (next.website || next.remote_url) {
      try {
        const host = new URL(next.remote_url || next.website || "").hostname;
        const dns = await resolveMcpDns(host);
        if (dns?.url) {
          hints.push("dns-mcp", `proto:${dns.proto || "streamable-http"}`);
          if (!next.remote_url) next.remote_url = dns.url;
        }
      } catch {
        /* */
      }
      try {
        const origin = new URL(next.website || next.remote_url || "").origin;
        for (const path of [
          "/.well-known/mcp/server-card.json",
          "/.well-known/mcp.json",
        ]) {
          const card = await fetchJson(`${origin}${path}`);
          if (!card) continue;
          hints.push(`mcp-card ${path}`);
          if (
            Array.isArray(card.protocol_versions) &&
            card.protocol_versions.map(String).includes("2026-07-28")
          ) {
            hints.push("proto:2026-07-28");
          }
          if (card.transport_preference === "streamable-http") {
            hints.push("transport:streamable-http");
          }
          const remotes = card.remotes as
            | Array<{ url?: string; type?: string }>
            | undefined;
          const remote = remotes?.find((r) => r.url);
          if (remote?.url && !next.remote_url) next.remote_url = remote.url;
          break;
        }
      } catch {
        /* */
      }
    }
    if (!next.website) next.website = next.repository || next.remote_url;
    if (/official-mcp/i.test(next.source) && !hints.some((h) => h.includes("official"))) {
      hints.push("proto:official-mirror");
    }
  }

  if ((next.description || "").length < 40) {
    next.description = `${next.name} is a community ${next.kind} for open agent and developer discovery, peer matching, and registry listing on Agents1.`;
  }

  next.quality_hints = [...new Set(hints)];
  next.status = "enriched";
  return next;
}
