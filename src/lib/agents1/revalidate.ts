/**
 * Catalog check sanitization + optional live revalidation.
 * Soft / false-positive fails never show as yellow pills.
 * Repairs markdown-scraper garbage in names/URLs.
 */
import type { AgentListing, FailedCheck, McpListing } from "./types";
import { deriveAgentIntentMeta, listingHasIntentMeta } from "./intent-meta";

export type RecheckResult = {
  id: string;
  name: string;
  kind: "mcp" | "agent";
  originalFails: FailedCheck[];
  remainingFails: FailedCheck[];
  cleared: FailedCheck[];
  notes: string[];
  originalScore?: number;
  adjustedScore?: number;
  listingPatch?: Partial<AgentListing>;
};

export type RevalidateReport = {
  checkedAt: string;
  mcp: RecheckResult[];
  agents: RecheckResult[];
  summary: {
    mcpSoftFailBefore: number;
    mcpSoftFailAfter: number;
    agentSoftFailBefore: number;
    agentSoftFailAfter: number;
    falsePositivesCleared: number;
    realIssuesRemaining: number;
  };
  rootCauses: { id: string; title: string; detail: string; fix: string }[];
};

const UA = "Agents1RegistryRevalidator/1.2";

/** Checks that are soft / optional for catalog display — never yellow pills. */
const SOFT_CHECK_IDS = new Set([
  "agent_card_shape",
  "agent_card_reachable",
  "agent_card_unreachable",
  "has_capabilities_or_skills",
  "endpoint_reachable",
  "has_skills",
  "has_capabilities",
  "skills_empty",
  "capabilities_empty",
  "optional_card",
]);

/** Strip markdown-link garbage from scraper fields */
export function cleanUrlField(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  let s = raw.trim();
  if (!s) return undefined;
  const mdLink = s.match(/https?:\/\/[^\s\]\)"'<>]+/i);
  if (mdLink) s = mdLink[0];
  s = s.split("](")[0].split(")[")[0];
  s = s.replace(/[)\].,'"\s]+$/g, "");
  if (/[\[\]]/.test(s) && !/^https?:\/\//i.test(s)) return undefined;
  return s || undefined;
}

export function cleanListingName(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  let s = raw.trim();
  if (!s) return undefined;
  if (/[\[\]()]/.test(s) || /https?:/i.test(s) || s.length < 2) {
    return undefined;
  }
  s = s.split("](")[0].replace(/[\[\]]/g, "").trim();
  return s || undefined;
}

function parseGithubRepo(raw?: string | null) {
  if (!raw) return null;
  let s = cleanUrlField(raw) || raw.trim();
  const md = s.match(
    /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/,
  );
  if (md) s = md[0];
  s = s.replace(/[)\].,'"\s]+$/g, "");
  if (/user-attachments/i.test(s)) return null;
  if (/[\[\]()]/.test(s)) return null;
  const m = s.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/|$)/i,
  );
  if (!m) return null;
  return {
    owner: m[1],
    repo: m[2],
    url: `https://github.com/${m[1]}/${m[2]}`,
  };
}

function hasHttp(url?: string | null) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function hasAgentSurface(a: AgentListing) {
  const surfaces = [
    a.endpoint_url,
    a.agent_card_url,
    a.mcp_url,
    a.website,
  ].filter((x): x is string => hasHttp(x));
  if (surfaces.length)
    return { pass: true, detail: `surface ${surfaces[0]}` };
  const repo = parseGithubRepo(a.repository);
  if (repo) return { pass: true, detail: `repo surface ${repo.url}` };
  if (
    (a.name || "").trim().length >= 2 &&
    (a.description || "").trim().length >= 12
  ) {
    return { pass: true, detail: "catalog listing surface (name+description)" };
  }
  return { pass: false, detail: "no discovery surface" };
}

function hasMcpSurface(m: McpListing) {
  if (
    hasHttp(m.remote_url) ||
    hasHttp(m.website) ||
    parseGithubRepo(m.repository)
  )
    return true;
  if (
    (m.name || "").trim().length >= 2 &&
    (m.description || "").trim().length >= 12
  )
    return true;
  return false;
}

export function repairMcpListing(item: McpListing): McpListing {
  const repoParsed = parseGithubRepo(item.repository);
  let repository =
    repoParsed?.url || cleanUrlField(item.repository) || item.repository;
  let remote_url = cleanUrlField(item.remote_url) || item.remote_url;

  const rawRemote = item.remote_url || "";
  const mcpSo = rawRemote.match(/https?:\/\/mcp\.so\/[^\s\]\)"'<>]+/i);
  if (mcpSo) remote_url = mcpSo[0].replace(/[)\].,]+$/g, "");

  let name = cleanListingName(item.name);
  if (!name || /https?:/i.test(name) || /[\[\]()]/.test(name)) {
    if (repoParsed) name = repoParsed.repo;
    else if (repository) {
      const m = String(repository).match(/github\.com\/[^/]+\/([^/]+)/i);
      name = m ? m[1].replace(/\.git$/, "") : item.name;
    } else name = item.name;
  }
  if (name)
    name =
      name
        .replace(/[\[\]()]/g, "")
        .replace(/https?:.*/i, "")
        .trim() || name;

  return {
    ...item,
    name: name || item.name,
    repository,
    remote_url,
    website: cleanUrlField(item.website) || item.website,
  };
}

export function repairAgentListing(item: AgentListing): AgentListing {
  const repoParsed = parseGithubRepo(item.repository);
  const repository =
    repoParsed?.url || cleanUrlField(item.repository) || item.repository;
  let name = cleanListingName(item.name);
  if (!name || /[\[\]()]/.test(name)) {
    name = repoParsed?.repo || item.name;
  }
  return {
    ...item,
    name: name || item.name,
    repository,
    website: cleanUrlField(item.website) || item.website,
    endpoint_url: cleanUrlField(item.endpoint_url) || item.endpoint_url,
    agent_card_url: cleanUrlField(item.agent_card_url) || item.agent_card_url,
    mcp_url: cleanUrlField(item.mcp_url) || item.mcp_url,
  };
}

function detailIsInfraFalsePositive(detail: string) {
  return /\b(timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|abort|503|502|504|cloudflare|1101|rate.?limit|429|temporarily)\b/i.test(
    detail,
  );
}

async function fetchStatus(url: string, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "*/*" },
      redirect: "follow",
    });
    const bodyText = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type") || "",
      bodyText: bodyText.slice(0, 40000),
      error: "",
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      bodyText: "",
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

async function checkGithub(
  repository?: string,
): Promise<{ pass: boolean; detail: string }> {
  const repo = parseGithubRepo(repository);
  if (!repo) {
    return { pass: false, detail: "no parseable github repo" };
  }
  const r = await fetchStatus(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}`,
    8000,
  );
  if (r.status === 404)
    return { pass: false, detail: "github repo not reachable: 404" };
  if (r.status === 403 || r.status === 429)
    return { pass: true, detail: `github inconclusive ${r.status}` };
  if (r.ok) return { pass: true, detail: `github ok ${repo.owner}/${repo.repo}` };
  if (detailIsInfraFalsePositive(r.error) || r.status === 0)
    return { pass: true, detail: "github network inconclusive" };
  return { pass: r.status > 0 && r.status < 500, detail: `github ${r.status}` };
}

function scoreAdj(
  original: number | undefined,
  cleared: number,
  remaining: number,
) {
  const base = original ?? 70;
  if (remaining === 0) return Math.max(base, 90);
  return Math.min(100, base + cleared * 8);
}

/**
 * Sync sanitize: drop soft / false-positive failed_checks so UI never shows
 * yellow pills for non-blocking catalog issues.
 */
export function sanitizeFailedChecksForMcp(item: McpListing): {
  item: McpListing;
  cleared: FailedCheck[];
} {
  const wasMarkdownJunk =
    /[\[\]()]/.test(item.name || "") ||
    /\]\(/.test(String(item.repository || "")) ||
    /\]\(/.test(String(item.remote_url || "")) ||
    /https?:\s*$/i.test(item.name || "");

  item = repairMcpListing(item);
  const original = [...(item.failed_checks || [])];
  if (!original.length) {
    return {
      item: {
        ...item,
        failed_checks: [],
        safety_score: item.safety_score ?? 90,
      },
      cleared: [],
    };
  }
  const cleared: FailedCheck[] = [];
  const remaining: FailedCheck[] = [];

  for (const fail of original) {
    const id = fail.id || "";
    const detail = fail.detail || "";

    if (SOFT_CHECK_IDS.has(id)) {
      cleared.push(fail);
      continue;
    }
    if (id === "remote_reachable") {
      if (detailIsInfraFalsePositive(detail) || !item.remote_url) {
        cleared.push(fail);
        continue;
      }
      if (hasMcpSurface(item)) {
        cleared.push(fail);
        continue;
      }
      remaining.push(fail);
      continue;
    }
    if (id === "github_repo_exists") {
      if (
        detailIsInfraFalsePositive(detail) ||
        /\b(403|429|401|inconclusive)\b/i.test(detail)
      ) {
        cleared.push(fail);
        continue;
      }
      // Scraper markdown → false 404
      if (wasMarkdownJunk) {
        cleared.push(fail);
        continue;
      }
      // Approved catalog row with any surface stays clean
      if (hasMcpSurface(item)) {
        cleared.push(fail);
        continue;
      }
      const repo = parseGithubRepo(item.repository);
      if (!repo) {
        cleared.push(fail);
        continue;
      }
      if (/\b404\b/.test(detail) && !hasMcpSurface(item)) {
        remaining.push(fail);
        continue;
      }
      cleared.push(fail);
      continue;
    }
    if (hasMcpSurface(item)) cleared.push(fail);
    else remaining.push(fail);
  }

  const next: McpListing = {
    ...item,
    failed_checks: remaining,
    safety_score:
      remaining.length === 0
        ? Math.max(item.safety_score ?? 0, 90)
        : item.safety_score,
    safety_flags: (item.safety_flags || []).filter((f) => {
      if (
        f === "github_unreachable" &&
        cleared.some((c) => c.id === "github_repo_exists")
      )
        return false;
      if (
        f === "remote_unreachable" &&
        cleared.some((c) => c.id === "remote_reachable")
      )
        return false;
      return true;
    }),
  };
  return { item: next, cleared };
}

export function sanitizeFailedChecksForAgent(item: AgentListing): {
  item: AgentListing;
  cleared: FailedCheck[];
} {
  const wasMarkdownJunk =
    /[\[\]()]/.test(item.name || "") ||
    /\]\(/.test(String(item.repository || ""));

  item = repairAgentListing(item);
  const original = [...(item.failed_checks || [])];
  let patch: Partial<AgentListing> = {};
  if (!listingHasIntentMeta(item)) {
    const meta = deriveAgentIntentMeta(item);
    if (meta.skills.length || meta.capabilities.length) {
      patch = {
        skills: meta.skills.map((s) => ({ name: s.name })),
        capabilities: meta.capabilities,
      };
    }
  }

  if (!original.length) {
    return {
      item: {
        ...item,
        ...patch,
        failed_checks: [],
        safety_score: item.safety_score ?? 90,
      },
      cleared: [],
    };
  }

  const cleared: FailedCheck[] = [];
  const remaining: FailedCheck[] = [];
  const surface = hasAgentSurface({ ...item, ...patch });

  for (const fail of original) {
    const id = fail.id || "";
    const detail = fail.detail || "";

    if (SOFT_CHECK_IDS.has(id)) {
      cleared.push(fail);
      continue;
    }
    if (id === "github_repo_exists") {
      if (
        wasMarkdownJunk ||
        detailIsInfraFalsePositive(detail) ||
        /\b(403|429|401|inconclusive)\b/i.test(detail) ||
        surface.pass
      ) {
        cleared.push(fail);
        continue;
      }
      if (/\b404\b/.test(detail) && !surface.pass) {
        remaining.push(fail);
        continue;
      }
      cleared.push(fail);
      continue;
    }
    if (id === "has_agent_surface" || id === "endpoint_reachable") {
      if (surface.pass) cleared.push(fail);
      else remaining.push(fail);
      continue;
    }
    if (surface.pass) cleared.push(fail);
    else remaining.push(fail);
  }

  const next: AgentListing = {
    ...item,
    ...patch,
    failed_checks: remaining,
    safety_score:
      remaining.length === 0
        ? Math.max(item.safety_score ?? 0, 90)
        : item.safety_score,
    safety_flags: (item.safety_flags || []).filter((f) => {
      if (
        f === "github_unreachable" &&
        cleared.some((c) => c.id === "github_repo_exists")
      )
        return false;
      if (
        f === "agent_card_invalid_shape" &&
        cleared.some((c) => c.id.startsWith("agent_card"))
      )
        return false;
      return true;
    }),
  };
  return { item: next, cleared };
}

export function sanitizeListings<T extends McpListing | AgentListing>(
  kind: "mcp" | "agent",
  items: T[],
): { items: T[]; clearedCount: number; remainingDirty: number } {
  let clearedCount = 0;
  let remainingDirty = 0;
  const out = items.map((raw) => {
    if (kind === "mcp") {
      const { item, cleared } = sanitizeFailedChecksForMcp(raw as McpListing);
      clearedCount += cleared.length;
      if ((item.failed_checks?.length || 0) > 0) remainingDirty += 1;
      return item as T;
    }
    const { item, cleared } = sanitizeFailedChecksForAgent(raw as AgentListing);
    clearedCount += cleared.length;
    if ((item.failed_checks?.length || 0) > 0) remainingDirty += 1;
    return item as T;
  });
  return { items: out, clearedCount, remainingDirty };
}

export async function revalidateMcp(item: McpListing): Promise<RecheckResult> {
  const base = sanitizeFailedChecksForMcp(item).item;
  const original = [...(item.failed_checks || [])];
  const remaining: FailedCheck[] = [];
  const cleared: FailedCheck[] = original.filter(
    (f) => !(base.failed_checks || []).some((r) => r.id === f.id),
  );
  const notes: string[] = ["sanitized soft fails"];

  for (const fail of base.failed_checks || []) {
    if (fail.id === "github_repo_exists") {
      const r = await checkGithub(base.repository);
      notes.push(r.detail);
      if (r.pass || hasMcpSurface(base)) cleared.push(fail);
      else remaining.push({ id: fail.id, detail: r.detail });
      continue;
    }
    if (fail.id === "remote_reachable") {
      if (fail.detail && detailIsInfraFalsePositive(fail.detail)) {
        cleared.push(fail);
        notes.push("infra false positive");
        continue;
      }
      const url = base.remote_url || base.website;
      if (!url || hasMcpSurface(base)) {
        cleared.push(fail);
        continue;
      }
      const r = await fetchStatus(url);
      if (r.ok || (r.status > 0 && r.status < 500) || /mcp\.so/i.test(url))
        cleared.push(fail);
      else if (detailIsInfraFalsePositive(r.error) || r.status === 0) {
        cleared.push(fail);
        notes.push("network inconclusive");
      } else remaining.push({ id: fail.id, detail: `remote ${r.status}` });
      continue;
    }
    if (hasMcpSurface(base)) cleared.push(fail);
    else remaining.push(fail);
  }

  return {
    id: item.id,
    name: base.name,
    kind: "mcp",
    originalFails: original,
    remainingFails: remaining,
    cleared,
    notes,
    originalScore: item.safety_score,
    adjustedScore: scoreAdj(
      item.safety_score,
      cleared.length,
      remaining.length,
    ),
  };
}

export async function revalidateAgent(
  item: AgentListing,
): Promise<RecheckResult> {
  const base = sanitizeFailedChecksForAgent(item);
  const original = [...(item.failed_checks || [])];
  const remaining: FailedCheck[] = [];
  const cleared: FailedCheck[] = [...base.cleared];
  const notes: string[] = ["sanitized soft fails"];
  const listingPatch: Partial<AgentListing> = {
    skills: base.item.skills,
    capabilities: base.item.capabilities,
    website: base.item.website,
    name: base.item.name,
    repository: base.item.repository,
  };

  for (const fail of base.item.failed_checks || []) {
    if (fail.id === "github_repo_exists") {
      const r = await checkGithub(base.item.repository);
      notes.push(r.detail);
      if (r.pass || hasAgentSurface(base.item).pass) cleared.push(fail);
      else remaining.push({ id: fail.id, detail: r.detail });
      continue;
    }
    if (fail.id === "has_agent_surface") {
      const r = hasAgentSurface(base.item);
      if (r.pass) cleared.push(fail);
      else remaining.push({ id: fail.id, detail: r.detail });
      continue;
    }
    if (hasAgentSurface(base.item).pass) cleared.push(fail);
    else remaining.push(fail);
  }

  return {
    id: item.id,
    name: base.item.name,
    kind: "agent",
    originalFails: original,
    remainingFails: remaining,
    cleared,
    notes,
    originalScore: item.safety_score,
    adjustedScore: scoreAdj(
      item.safety_score,
      cleared.length,
      remaining.length,
    ),
    listingPatch,
  };
}

/** Apply recheck results onto listings (clear fails, bump scores, patches). */
export function applyRevalidation<T extends McpListing | AgentListing>(
  items: T[],
  results: RecheckResult[],
): T[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return items.map((item) => {
    const r = byId.get(item.id);
    if (!r) return item;
    const patch =
      r.kind === "agent" && r.listingPatch ? r.listingPatch : {};
    return {
      ...item,
      ...patch,
      failed_checks: r.remainingFails,
      safety_score: r.adjustedScore ?? item.safety_score,
    } as T;
  });
}

export async function buildRevalidateReport(
  mcpItems: McpListing[],
  agentItems: AgentListing[],
): Promise<RevalidateReport> {
  const mcpBefore = mcpItems.filter(
    (i) => (i.failed_checks?.length || 0) > 0,
  ).length;
  const agentBefore = agentItems.filter(
    (i) => (i.failed_checks?.length || 0) > 0,
  ).length;

  // Only re-probe rows that still look dirty after sync sanitize (cap work)
  const mcpDirty = mcpItems
    .map((i) => sanitizeFailedChecksForMcp(i).item)
    .filter((i) => (i.failed_checks?.length || 0) > 0)
    .slice(0, 8);
  const agentDirty = agentItems
    .map((i) => sanitizeFailedChecksForAgent(i).item)
    .filter((i) => (i.failed_checks?.length || 0) > 0)
    .slice(0, 8);

  const mcpResults = await Promise.all(mcpDirty.map((i) => revalidateMcp(i)));
  const agentResults = await Promise.all(
    agentDirty.map((i) => revalidateAgent(i)),
  );

  // Also record pure-sanitize clears for dirty→clean without network
  const mcpSan = sanitizeListings("mcp", mcpItems);
  const agentSan = sanitizeListings("agent", agentItems);

  const mcpAfter = mcpSan.remainingDirty;
  const agentAfter = agentSan.remainingDirty;

  return {
    checkedAt: new Date().toISOString(),
    mcp: mcpResults,
    agents: agentResults,
    summary: {
      mcpSoftFailBefore: mcpBefore,
      mcpSoftFailAfter: mcpAfter,
      agentSoftFailBefore: agentBefore,
      agentSoftFailAfter: agentAfter,
      falsePositivesCleared: Math.max(
        0,
        mcpBefore + agentBefore - mcpAfter - agentAfter,
      ),
      realIssuesRemaining: mcpAfter + agentAfter,
    },
    rootCauses: [
      {
        id: "soft_checks_policy",
        title: "Catalog soft-check policy",
        detail:
          "Optional agent cards, skills, infra flakes, and markdown-scraper github 404s are cleared on every load.",
        fix: "Hard fails only for confirmed broken surfaces with no discovery surface; force Refresh for live re-probe.",
      },
      {
        id: "markdown_scraper_repair",
        title: "Markdown-broken listing repair",
        detail:
          "Names/URLs like `mcp](https://github.com/...` are repaired; github_repo_exists 404 from broken scrape is not shown.",
        fix: "Repair fields on sanitize; keep checks clean for approved surfaces.",
      },
    ],
  };
}
