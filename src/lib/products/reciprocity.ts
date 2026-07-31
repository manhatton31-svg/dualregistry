/**
 * Reciprocity trust graph — listings that link Dual get ranking boost
 * + portable clean badge. Adjacent possible on protocol-complete Dual.
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";
import { getListingStatus } from "@/lib/agents1/inbound-discovery";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

const DURABLE = "reciprocity.json";

export type ReciprocityRow = {
  listing_id: string;
  name?: string;
  kind?: "agent" | "mcp";
  links_dual: boolean;
  signals: string[];
  score: number;
  checked_at: string;
  card_url?: string | null;
  clean: boolean;
};

type Store = {
  updated_at: string;
  by_listing: Record<string, ReciprocityRow>;
  totals: {
    checked: number;
    reciprocal: number;
    clean_reciprocal: number;
  };
};

function empty(): Store {
  return {
    updated_at: new Date().toISOString(),
    by_listing: {},
    totals: { checked: 0, reciprocal: 0, clean_reciprocal: 0 },
  };
}

let mem: Store | null = null;

async function load(): Promise<Store> {
  if (mem) return mem;
  const s = await loadDurableJson<Store>(DURABLE, empty);
  if (!s.by_listing) s.by_listing = {};
  if (!s.totals) s.totals = empty().totals;
  mem = s;
  return s;
}

async function persist(s: Store) {
  s.updated_at = new Date().toISOString();
  mem = s;
  await saveDurableJson(DURABLE, s);
}

const DUAL_MARKERS = [
  "dualregistry.dev",
  "www.dualregistry.dev",
  "agents1",
  "dual registry",
  "list_yourself",
  "dev.dualregistry",
];

function scanBlob(blob: string): { links: boolean; signals: string[] } {
  const lower = blob.toLowerCase();
  const signals: string[] = [];
  for (const m of DUAL_MARKERS) {
    if (lower.includes(m.toLowerCase())) signals.push(m);
  }
  return { links: signals.length > 0, signals: [...new Set(signals)] };
}

async function fetchCardText(url: string): Promise<string> {
  if (!url.startsWith("https://")) return "";
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "DualRegistryReciprocity/2.3 (+https://dualregistry.dev)",
      },
      signal: AbortSignal.timeout(4000),
      redirect: "follow",
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 80_000);
  } catch {
    return "";
  }
}

export async function evaluateReciprocity(opts: {
  listing_id: string;
  name?: string;
  kind?: "agent" | "mcp";
  card_url?: string | null;
  website?: string | null;
  description?: string | null;
  origin?: string;
}): Promise<ReciprocityRow> {
  const origin = (opts.origin || "https://dualregistry.dev").replace(/\/$/, "");
  let clean = false;
  try {
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const reg = await loadCleanRegistry();
    clean = Boolean(reg.items?.[opts.listing_id]);
  } catch {
    /* */
  }

  const localBlob = [
    opts.name,
    opts.description,
    opts.website,
    opts.card_url,
  ]
    .filter(Boolean)
    .join("\n");
  let { links, signals } = scanBlob(localBlob);

  if (opts.card_url) {
    const remote = await fetchCardText(opts.card_url);
    const r = scanBlob(remote);
    if (r.links) {
      links = true;
      signals = [...new Set([...signals, ...r.signals, "card_fetch"])];
    }
  }
  if (opts.website && opts.website !== opts.card_url) {
    // only scan website path for dual markers in URL itself (no full page crawl)
    const r = scanBlob(opts.website);
    if (r.links) {
      links = true;
      signals = [...new Set([...signals, ...r.signals, "website"])];
    }
  }

  let score = 0;
  if (clean) score += 40;
  if (links) score += 50;
  if (signals.includes("dualregistry.dev") || signals.includes("www.dualregistry.dev"))
    score += 20;
  if (opts.card_url) score += 10;

  const row: ReciprocityRow = {
    listing_id: opts.listing_id,
    name: opts.name,
    kind: opts.kind,
    links_dual: links,
    signals: signals.slice(0, 12),
    score: Math.min(100, score),
    checked_at: new Date().toISOString(),
    card_url: opts.card_url || null,
    clean,
  };

  const s = await load();
  const prev = s.by_listing[opts.listing_id];
  s.by_listing[opts.listing_id] = row;
  // recompute totals
  const rows = Object.values(s.by_listing);
  s.totals = {
    checked: rows.length,
    reciprocal: rows.filter((r) => r.links_dual).length,
    clean_reciprocal: rows.filter((r) => r.links_dual && r.clean).length,
  };
  if (!prev || prev.links_dual !== row.links_dual || prev.score !== row.score) {
    await persist(s);
  } else {
    mem = s;
  }

  return row;
}

export async function getReciprocityFor(opts: {
  listing_id?: string;
  url?: string;
  name?: string;
  origin?: string;
}): Promise<Record<string, unknown>> {
  const origin = resolvePublicOrigin(
    opts.origin ? new Request(opts.origin) : undefined,
  ).replace(/\/$/, "");

  let listing_id = (opts.listing_id || "").trim();
  let name = (opts.name || "").trim();
  let card_url = (opts.url || "").trim() || null;
  let kind: "agent" | "mcp" | undefined;
  let website: string | null = null;
  let description: string | null = null;

  if (listing_id || name) {
    const st = await getListingStatus({
      id: listing_id,
      name,
      origin,
    });
    if (st) {
      listing_id = st.listing_id;
      name = st.name || name;
      kind = st.kind as "agent" | "mcp";
      // try lanes for card
      try {
        const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
        const lanes = await getLanedListings();
        const all = [
          ...lanes.agents_active,
          ...lanes.mcp_active,
          ...lanes.agents_discovered,
          ...lanes.mcp_discovered,
        ];
        const L = all.find((x) => x.id === listing_id);
        if (L) {
          card_url = card_url || L.agent_card_url || L.remote_url || null;
          website = L.website || null;
          description = L.description || null;
          kind = L.kind;
          name = L.name || name;
        }
      } catch {
        /* */
      }
    }
  }

  if (!listing_id && card_url) {
    listing_id = `url:${card_url.slice(0, 80)}`;
  }

  if (!listing_id) {
    return {
      ok: false,
      error: "listing_id, name, or url required",
      badge_live: `${origin}/badge/live.svg`,
    };
  }

  const row = await evaluateReciprocity({
    listing_id,
    name,
    kind,
    card_url,
    website,
    description,
    origin,
  });

  return {
    ok: true,
    ...row,
    rank_boost: row.links_dual ? (row.clean ? 70 : 40) : row.clean ? 15 : 0,
    portable: {
      clean_badge: row.clean
        ? `${origin}/badge/clean.svg?id=${encodeURIComponent(listing_id)}`
        : null,
      verified_badge: row.links_dual && row.clean
        ? `${origin}/badge/verified.svg?id=${encodeURIComponent(listing_id)}`
        : null,
      listed_badge: `${origin}/badge/listed.svg`,
      markdown: row.clean
        ? `[![Dual clean](${origin}/badge/clean.svg?id=${encodeURIComponent(listing_id)})](${origin}/list/status?id=${encodeURIComponent(listing_id)})`
        : `[![Dual listed](${origin}/badge/listed.svg)](${origin})`,
    },
    policy:
      "Link Dual in your agent-card / skill / website → reciprocity score + ranking boost on matchmaking & soft invites. Never required for listing.",
  };
}

export async function getReciprocityPublic() {
  const s = await load();
  return {
    ok: true,
    version: "2.3.0",
    totals: s.totals,
    updated_at: s.updated_at,
    top: Object.values(s.by_listing)
      .filter((r) => r.links_dual)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((r) => ({
        listing_id: r.listing_id,
        name: r.name,
        kind: r.kind,
        score: r.score,
        clean: r.clean,
      })),
  };
}

/** Boost used by matchmaking / nudge priority. */
export async function reciprocityBoost(listingId: string): Promise<number> {
  const s = await load();
  const row = s.by_listing[listingId];
  if (!row) return 0;
  if (row.links_dual && row.clean) return 70;
  if (row.links_dual) return 40;
  if (row.clean) return 15;
  return 0;
}
