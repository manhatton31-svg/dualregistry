/**
 * Exclusive primary categories for active registry listings.
 *
 * Rules:
 *  - Exactly ONE primary category per listing (no overlap).
 *  - Categories are collected only when a listing becomes ACTIVE
 *    (checks clean + recent probe ok).
 *  - Taxonomy is fixed and non-redundant; "other" is the catch-all.
 *  - Live category index grows as active members appear (filter only
 *    shows categories that currently have active listings).
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";

const PATH = join(dataRoot(), "registry-categories.json");

/** Mutually exclusive MCP primary categories */
export const MCP_CATEGORIES = [
  {
    id: "data-storage",
    label: "Data & storage",
    keywords: [
      "database",
      "sql",
      "postgres",
      "mongo",
      "redis",
      "vector",
      "storage",
      "s3",
      "blob",
      "kv",
      "supabase",
      "firebase",
      "dynamodb",
      "sqlite",
      "airtable",
      "notion db",
    ],
  },
  {
    id: "search-retrieval",
    label: "Search & retrieval",
    keywords: [
      "search",
      "retriev",
      "rag",
      "embed",
      "index",
      "crawl",
      "scrape",
      "firecrawl",
      "bing",
      "google search",
      "serp",
    ],
  },
  {
    id: "code-devtools",
    label: "Code & devtools",
    keywords: [
      "github",
      "git",
      "code",
      "lint",
      "ci",
      "deploy",
      "docker",
      "kubernetes",
      "developer",
      "devtools",
      "npm",
      "package",
      "ide",
      "vscode",
    ],
  },
  {
    id: "browser-web",
    label: "Browser & web",
    keywords: [
      "browser",
      "puppeteer",
      "playwright",
      "selenium",
      "web page",
      "http",
      "fetch url",
      "screenshot",
      "dom",
    ],
  },
  {
    id: "communication",
    label: "Communication",
    keywords: [
      "email",
      "slack",
      "discord",
      "sms",
      "chat",
      "message",
      "telegram",
      "whatsapp",
      "mail",
      "notification",
    ],
  },
  {
    id: "finance-commerce",
    label: "Finance & commerce",
    keywords: [
      "payment",
      "stripe",
      "invoice",
      "commerce",
      "shop",
      "store",
      "crypto",
      "trading",
      "bank",
      "finance",
      "billing",
      "price",
    ],
  },
  {
    id: "productivity",
    label: "Productivity",
    keywords: [
      "calendar",
      "todo",
      "task",
      "notion",
      "docs",
      "spreadsheet",
      "sheet",
      "workflow",
      "project",
      "notes",
      "meeting",
    ],
  },
  {
    id: "media-creative",
    label: "Media & creative",
    keywords: [
      "image",
      "video",
      "audio",
      "music",
      "design",
      "figma",
      "render",
      "photo",
      "generative art",
      "tts",
      "speech",
    ],
  },
  {
    id: "security-identity",
    label: "Security & identity",
    keywords: [
      "auth",
      "oauth",
      "security",
      "identity",
      "secret",
      "vault",
      "permission",
      "rbac",
      "sso",
      "encrypt",
    ],
  },
  {
    id: "infra-cloud",
    label: "Infrastructure & cloud",
    keywords: [
      "aws",
      "cloud",
      "server",
      "hosting",
      "cdn",
      "dns",
      "monitor",
      "observability",
      "log",
      "metric",
      "kubernetes",
      "terraform",
    ],
  },
  {
    id: "research-knowledge",
    label: "Research & knowledge",
    keywords: [
      "research",
      "knowledge",
      "wiki",
      "arxiv",
      "paper",
      "document",
      "pdf",
      "summar",
      "science",
      "academic",
    ],
  },
  {
    id: "other",
    label: "Other",
    keywords: [],
  },
] as const;

/** Mutually exclusive Agent primary categories */
export const AGENT_CATEGORIES = [
  {
    id: "coding-engineering",
    label: "Coding & engineering",
    keywords: [
      "code",
      "coding",
      "engineer",
      "software",
      "developer",
      "debug",
      "programming",
      "refactor",
      "github",
      "devops",
    ],
  },
  {
    id: "research-analysis",
    label: "Research & analysis",
    keywords: [
      "research",
      "analy",
      "report",
      "study",
      "investigate",
      "summar",
      "insight",
      "academic",
    ],
  },
  {
    id: "ops-automation",
    label: "Ops & automation",
    keywords: [
      "ops",
      "automat",
      "workflow",
      "orchestr",
      "pipeline",
      "cron",
      "monitor",
      "sre",
      "infra",
    ],
  },
  {
    id: "customer-support",
    label: "Customer & support",
    keywords: [
      "support",
      "customer",
      "helpdesk",
      "ticket",
      "service desk",
      "faq",
      "chatbot",
    ],
  },
  {
    id: "creative-content",
    label: "Creative & content",
    keywords: [
      "writ",
      "content",
      "blog",
      "copy",
      "creative",
      "marketing",
      "design",
      "story",
      "social",
    ],
  },
  {
    id: "data-analytics",
    label: "Data & analytics",
    keywords: [
      "data",
      "analytics",
      "metric",
      "dashboard",
      "bi ",
      "sql",
      "etl",
      "warehouse",
      "stats",
    ],
  },
  {
    id: "sales-growth",
    label: "Sales & growth",
    keywords: [
      "sales",
      "lead",
      "crm",
      "outbound",
      "growth",
      "funnel",
      "pipeline",
      "outreach",
    ],
  },
  {
    id: "personal-assistant",
    label: "Personal assistant",
    keywords: [
      "assistant",
      "personal",
      "schedule",
      "calendar",
      "remind",
      "daily",
      "companion",
    ],
  },
  {
    id: "multi-agent",
    label: "Multi-agent systems",
    keywords: [
      "multi-agent",
      "multi agent",
      "swarm",
      "crew",
      "orchestrat",
      "federation",
      "mesh",
      "agent team",
    ],
  },
  {
    id: "other",
    label: "Other",
    keywords: [],
  },
] as const;

export type McpCategoryId = (typeof MCP_CATEGORIES)[number]["id"];
export type AgentCategoryId = (typeof AGENT_CATEGORIES)[number]["id"];
export type CategoryId = McpCategoryId | AgentCategoryId;

export type CategoryAssignment = {
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  category_id: string;
  category_label: string;
  confidence: number;
  reason: string;
  assigned_at: string;
  /** Only set when listing is/was active */
  active_when_assigned: boolean;
};

type Store = {
  updated_at: string;
  assignments: Record<string, CategoryAssignment>;
  /** Live catalog: category_id → count of active listings */
  live_mcp: Record<string, number>;
  live_agents: Record<string, number>;
};

let mem: Store | null = null;

function empty(): Store {
  return {
    updated_at: new Date().toISOString(),
    assignments: {},
    live_mcp: {},
    live_agents: {},
  };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.assignments = mem!.assignments || {};
    mem!.live_mcp = mem!.live_mcp || {};
    mem!.live_agents = mem!.live_agents || {};
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: Store) {
  mem = s;
  s.updated_at = new Date().toISOString();
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

function catalog(kind: "agent" | "mcp") {
  return kind === "mcp" ? MCP_CATEGORIES : AGENT_CATEGORIES;
}

function textBlob(input: {
  name?: string;
  description?: string;
  skills?: { name?: string }[] | string[];
  capabilities?: string[];
  tags?: string[];
  framework?: string;
}): string {
  const parts: string[] = [input.name || "", input.description || ""];
  for (const s of input.skills || []) {
    parts.push(typeof s === "string" ? s : s.name || "");
  }
  for (const c of input.capabilities || []) parts.push(c);
  for (const t of input.tags || []) parts.push(t);
  if (input.framework) parts.push(input.framework);
  return parts.join(" ").toLowerCase();
}

/**
 * Pick exactly one primary category. First matching exclusive bucket wins
 * by keyword score; ties → higher keyword density; zero → other.
 */
export function inferPrimaryCategory(
  kind: "agent" | "mcp",
  input: {
    name?: string;
    description?: string;
    skills?: { name?: string }[] | string[];
    capabilities?: string[];
    tags?: string[];
    framework?: string;
  },
): { id: string; label: string; confidence: number; reason: string } {
  const blob = textBlob(input);
  const cats = catalog(kind);
  let best: {
    id: string;
    label: string;
    hits: number;
    kw: string;
  } | null = null;

  for (const c of cats) {
    if (c.id === "other") continue;
    let hits = 0;
    let first = "";
    for (const kw of c.keywords) {
      if (blob.includes(kw)) {
        hits += 1;
        if (!first) first = kw;
      }
    }
    if (hits === 0) continue;
    if (
      !best ||
      hits > best.hits ||
      (hits === best.hits && c.id.localeCompare(best.id) < 0)
    ) {
      best = { id: c.id, label: c.label, hits, kw: first };
    }
  }

  if (!best) {
    return {
      id: "other",
      label: "Other",
      confidence: 0.2,
      reason: "No exclusive keyword match — Other",
    };
  }
  const confidence = Math.min(0.95, 0.45 + best.hits * 0.12);
  return {
    id: best.id,
    label: best.label,
    confidence,
    reason: `Matched “${best.kw}” (${best.hits} keyword hits) → ${best.label}`,
  };
}

export type ActiveListingInput = {
  id: string;
  kind: "agent" | "mcp";
  name: string;
  description?: string;
  skills?: { name?: string }[] | string[];
  capabilities?: string[];
  tags?: string[];
  framework?: string;
  lane: "active" | "discovered" | "needs_resubmit";
};

/**
 * Assign / refresh categories for listings that are ACTIVE.
 * Discovered listings do not grow the live category catalog.
 */
export async function syncCategoriesFromListings(
  listings: ActiveListingInput[],
): Promise<Store> {
  const s = await load();
  const live_mcp: Record<string, number> = {};
  const live_agents: Record<string, number> = {};
  const now = new Date().toISOString();

  for (const L of listings) {
    if (L.lane !== "active") continue;
    const inferred = inferPrimaryCategory(L.kind, L);
    const key = `${L.kind}:${L.id}`;
    const prev = s.assignments[key];
    // Keep stable assignment if same category; only reassign on clear better match
    if (
      prev &&
      prev.category_id === inferred.id &&
      prev.category_id !== "other"
    ) {
      prev.active_when_assigned = true;
      prev.name = L.name;
    } else if (
      prev &&
      prev.category_id !== "other" &&
      inferred.id === "other"
    ) {
      // keep prior non-other
      prev.active_when_assigned = true;
      prev.name = L.name;
    } else {
      s.assignments[key] = {
        listing_id: L.id,
        kind: L.kind,
        name: L.name,
        category_id: inferred.id,
        category_label: inferred.label,
        confidence: inferred.confidence,
        reason: inferred.reason,
        assigned_at: prev?.assigned_at || now,
        active_when_assigned: true,
      };
    }
    const a = s.assignments[key]!;
    if (L.kind === "mcp") {
      live_mcp[a.category_id] = (live_mcp[a.category_id] || 0) + 1;
    } else {
      live_agents[a.category_id] = (live_agents[a.category_id] || 0) + 1;
    }
  }

  s.live_mcp = live_mcp;
  s.live_agents = live_agents;
  await persist(s);
  return s;
}

export async function getCategoryFor(
  kind: "agent" | "mcp",
  id: string,
): Promise<CategoryAssignment | null> {
  const s = await load();
  return s.assignments[`${kind}:${id}`] || null;
}

export async function getLiveCategoryCatalog(): Promise<{
  mcp: Array<{
    id: string;
    label: string;
    count: number;
    live: boolean;
  }>;
  agents: Array<{
    id: string;
    label: string;
    count: number;
    live: boolean;
  }>;
  /** Only categories with count > 0 (filter chips that unlock) */
  mcp_live: Array<{ id: string; label: string; count: number }>;
  agents_live: Array<{ id: string; label: string; count: number }>;
  policy: {
    exclusive: boolean;
    grows_on: string;
    no_overlap: string;
  };
  updated_at: string;
}> {
  const s = await load();
  // Full taxonomy always listed; count 0 = grayed "unlocks when Active"
  const mcp = MCP_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    count: s.live_mcp[c.id] || 0,
    live: (s.live_mcp[c.id] || 0) > 0,
  }));
  const agents = AGENT_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    count: s.live_agents[c.id] || 0,
    live: (s.live_agents[c.id] || 0) > 0,
  }));
  return {
    mcp,
    agents,
    mcp_live: mcp.filter((c) => c.live).map(({ id, label, count }) => ({ id, label, count })),
    agents_live: agents
      .filter((c) => c.live)
      .map(({ id, label, count }) => ({ id, label, count })),
    policy: {
      exclusive: true,
      grows_on: "active only (checks clean + probe ok)",
      no_overlap:
        "One primary category per listing; taxonomy buckets are mutually exclusive",
    },
    updated_at: s.updated_at,
  };
}

export function categoryLabel(
  kind: "agent" | "mcp",
  id: string,
): string {
  const c = catalog(kind).find((x) => x.id === id);
  return c?.label || id;
}
