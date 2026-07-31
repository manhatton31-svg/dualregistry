/**
 * Capability matchmaking — rank Active clean listings for NL needs.
 * Layer on ARD + clean registry + stigmergic usage pheromones (trail-following)
 * + first-principles outcome scores.
 */
import { ardSearch, type ArdSearchHit } from "@/lib/agents1/ai-catalog";
import { getFoundingFreePublic } from "./founding-free";
import { pheromoneBoostFor } from "./stigmergy";
import { outcomeScoreFor } from "./first-principles";

export type MatchHit = ArdSearchHit & {
  listing_id?: string;
  kind?: string;
  take_demo_get?: string;
  match_reasons: string[];
  capability_score: number;
  pheromone_boost?: number;
  outcome_score?: number;
};

const CAP_ALIASES: Array<{ re: RegExp; tags: string[]; boost: number }> = [
  { re: /\bgithub\b|issues?|pull.?request|\bpr\b/i, tags: ["github", "git", "devtools"], boost: 28 },
  { re: /\bslack\b|discord|chat|messaging/i, tags: ["slack", "discord", "chat"], boost: 24 },
  { re: /\bdatabase\b|sql|postgres|mongo/i, tags: ["database", "sql", "data"], boost: 24 },
  { re: /\bsearch\b|rag|vector|embed/i, tags: ["search", "rag", "retrieval"], boost: 22 },
  { re: /\bbrowser\b|scrape|crawl|web/i, tags: ["browser", "web", "scrape"], boost: 20 },
  { re: /\bfile\b|fs|filesystem|s3|storage/i, tags: ["files", "storage"], boost: 18 },
  { re: /\bemail\b|smtp|gmail/i, tags: ["email", "mail"], boost: 18 },
  { re: /\bcalendar\b|schedule|meeting/i, tags: ["calendar", "schedule"], boost: 18 },
  { re: /\bpayment\b|stripe|billing|invoice/i, tags: ["payments", "commerce"], boost: 18 },
  { re: /\bmcp\b|tool|server/i, tags: ["mcp", "tools"], boost: 12 },
  { re: /\bagent\b|a2a|orchestr/i, tags: ["agent", "a2a"], boost: 12 },
  { re: /\bdemo\b|kernel|loop|registry/i, tags: ["demo", "kernel", "registry"], boost: 10 },
];

function extractListingId(identifier: string, url?: string): string | undefined {
  const m = identifier.match(/listing:([^:]+)$/);
  if (m) return m[1];
  if (url) {
    try {
      const u = new URL(url);
      const id = u.searchParams.get("id") || u.searchParams.get("listing_id");
      if (id) return id;
    } catch {
      /* */
    }
  }
  return undefined;
}

export async function matchCapabilities(
  origin: string,
  query: string,
  opts?: {
    kind?: "agent" | "mcp" | "all";
    limit?: number;
    federation?: "none" | "referrals" | "auto";
  },
): Promise<{
  ok: true;
  query: string;
  total: number;
  hits: MatchHit[];
  founding: Awaited<ReturnType<typeof getFoundingFreePublic>>;
  note: string;
  stigmergy: boolean;
  first_principles: boolean;
}> {
  const o = origin.replace(/\/$/, "");
  const limit = Math.min(40, Math.max(1, opts?.limit ?? 12));
  const kind = opts?.kind || "all";
  const base = await ardSearch(o, query, {
    limit: Math.min(50, limit * 3),
    federation: opts?.federation || "referrals",
  });

  const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
  const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
  const lanes = await getLanedListings();
  const reg = await loadCleanRegistry();
  const clean = reg.items || {};

  const activeRows = [
    ...(kind === "mcp" ? [] : lanes.agents_active || []),
    ...(kind === "agent" ? [] : lanes.mcp_active || []),
  ].filter((L) => L?.id && clean[L.id]);

  const q = query.trim().toLowerCase();
  const aliasHits: MatchHit[] = [];
  for (const L of activeRows) {
    let capability_score = 0;
    const match_reasons: string[] = [];
    const blob = `${L.name || ""} ${L.description || ""} ${(L.tags || []).join(" ")}`.toLowerCase();
    for (const a of CAP_ALIASES) {
      if (a.re.test(query)) {
        for (const tag of a.tags) {
          if (blob.includes(tag)) {
            capability_score += a.boost;
            match_reasons.push(`cap:${tag}`);
          }
        }
        if (match_reasons.every((r) => !r.startsWith("cap:"))) {
          capability_score += Math.floor(a.boost / 4);
          match_reasons.push(`intent:${a.tags[0]}`);
        }
      }
    }
    if (L.name.toLowerCase().includes(q)) {
      capability_score += 22;
      match_reasons.push("name");
    }
    if (capability_score <= 0 && q && blob.includes(q)) {
      capability_score += 12;
      match_reasons.push("text");
    }
    if (capability_score <= 0) continue;
    aliasHits.push({
      identifier: `urn:ai:dualregistry:listing:${L.id}`,
      displayName: L.name,
      type:
        L.kind === "mcp"
          ? "application/mcp-server+json"
          : "application/a2a-agent-card+json",
      description: (L.description || "").slice(0, 280),
      url: L.agent_card_url || L.remote_url || L.website || undefined,
      score: capability_score,
      tags: [L.kind, "active", "clean", ...(L.tags || [])].slice(0, 12),
      source: "dual",
      listing_id: L.id,
      kind: L.kind,
      take_demo_get: `${o}/api/products/demo?listing_id=${encodeURIComponent(L.id)}`,
      match_reasons: [...new Set(match_reasons)].slice(0, 8),
      capability_score,
    });
  }

  const byId = new Map<string, MatchHit>();
  for (const h of aliasHits) {
    byId.set(h.identifier, h);
  }
  for (const h of base.hits) {
    if (kind === "mcp" && h.type.includes("a2a")) continue;
    if (kind === "agent" && h.type.includes("mcp")) continue;
    const lid = extractListingId(h.identifier, h.url);
    const key = h.identifier;
    const existing = byId.get(key);
    const match_reasons = ["ard"];
    let capability_score = h.score;
    if (existing) {
      capability_score = Math.max(existing.capability_score, h.score) + 8;
      match_reasons.push(...existing.match_reasons, "ard_boost");
    }
    byId.set(key, {
      ...h,
      listing_id: lid || existing?.listing_id,
      kind: existing?.kind,
      take_demo_get:
        existing?.take_demo_get ||
        (lid
          ? `${o}/api/products/demo?listing_id=${encodeURIComponent(lid)}`
          : undefined),
      match_reasons: [...new Set(match_reasons)].slice(0, 8),
      capability_score,
      score: capability_score,
    });
  }

  // Stigmergic trail boost
  const lids = [...byId.values()]
    .map((h) => h.listing_id)
    .filter((x): x is string => Boolean(x));
  const boosts = await pheromoneBoostFor(lids);
  for (const h of byId.values()) {
    if (!h.listing_id) continue;
    const b = boosts[h.listing_id] || 0;
    if (b > 0) {
      h.pheromone_boost = b;
      h.capability_score += b;
      h.score = h.capability_score;
      h.match_reasons = [...(h.match_reasons || []), "stigmergy_trail"].slice(
        0,
        10,
      );
    }
  }

  // First-principles outcome physics boost
  for (const h of byId.values()) {
    if (!h.listing_id) continue;
    try {
      const oScore = await outcomeScoreFor(h.listing_id);
      if (oScore > 0) {
        h.outcome_score = oScore;
        h.capability_score += Math.round(oScore * 25);
        h.score = h.capability_score;
        h.match_reasons = [
          ...(h.match_reasons || []),
          "outcome_physics",
        ].slice(0, 10);
      }
    } catch {
      /* */
    }
  }

  const hits = [...byId.values()]
    .sort((a, b) => b.capability_score - a.capability_score)
    .slice(0, limit);

  return {
    ok: true,
    query,
    total: byId.size,
    hits,
    founding: await getFoundingFreePublic(),
    note: "Ranked Active clean + ARD + stigmergy × outcomes × first-principles. take_demo_get for founding free path.",
    stigmergy: true,
    first_principles: true,
  };
}
