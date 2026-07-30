/**
 * Registry lanes:
 *   active         — checks-clean + recent probe handshake ok (public Active list)
 *   discovered     — picked up, awaiting first successful probe (public “incoming”)
 *   needs_resubmit — probe failed / rejected / failed checks: NOT on public lists.
 *                    Creator must fix card and resubmit for approval.
 *
 * Categories: exclusive primary tags collected only when ACTIVE.
 */
import { loadStoreCache } from "./store-cache";
import { loadState } from "./growth/persist";
import type { AgentListing, FailedCheck, McpListing } from "./types";
import { getProbePublic, type ProbeResult } from "./probe";
import { dataRoot } from "@/lib/data-root";

/**
 * Probe must be this fresh to stay Active.
 * Weekly recheck is every 7d — allow 8d grace so Actives aren't demoted
 * the day before their scheduled recheck.
 */
export const ACTIVE_PROBE_MAX_AGE_MS = 8 * 24 * 3600_000;

export type ListingLane = "active" | "discovered" | "needs_resubmit";

export type LanedListing = {
  id: string;
  kind: "agent" | "mcp";
  name: string;
  description?: string;
  author?: string;
  status?: string;
  safety_score?: number;
  safety_flags?: string[];
  failed_checks?: FailedCheck[];
  repository?: string;
  website?: string;
  remote_url?: string;
  endpoint_url?: string;
  agent_card_url?: string;
  lane: ListingLane;
  lane_reason: string;
  checks_clean: boolean;
  probe?: {
    ok: boolean;
    handshake?: string;
    score: number;
    probed_at: string;
    target?: string;
    age_hours?: number;
    signals?: string[];
  } | null;
  source: "store" | "growth" | "mirror";
  picked_up_at?: string;
  category_id?: string;
  category_label?: string;
  category_reason?: string;
  skills?: { name?: string }[];
  capabilities?: string[];
  tags?: string[];
  framework?: string;
  resubmit?: {
    required: true;
    fix: string;
    endpoint: string;
    message: string;
  };
};

function checksClean(fails?: FailedCheck[] | null): boolean {
  return !fails || fails.length === 0;
}

function failWhy(probe?: ProbeResult): string {
  const sigs = probe?.signals || [];
  const s = sigs.find((x) => /fail|404|402|410|403|timeout/i.test(String(x)));
  if (!s) return "live probe handshake failed";
  if (/404/.test(s))
    return "agent/MCP card URL returned 404 — publish a valid card";
  if (/402/.test(s)) return "card URL paywalled/blocked (402)";
  if (/410/.test(s)) return "card URL gone (410)";
  if (/403/.test(s)) return "card URL forbidden (403)";
  if (/200/.test(s) && /fail/i.test(s))
    return "URL returned HTML/non-card body — serve JSON agent-card or MCP server-card";
  return String(s);
}

function resubmitHint(kind: "agent" | "mcp", probe?: ProbeResult) {
  const fix =
    kind === "agent"
      ? "Host a valid Agent Card at /.well-known/agent.json (or your agent_card_url) with name, url, skills — HTTP 200 JSON only."
      : "Host a valid MCP server card at /.well-known/mcp/server-card.json (or remote_url) with name + transport — HTTP 200, not HTML.";
  return {
    required: true as const,
    fix,
    fix_steps:
      kind === "agent"
        ? [
            "Publish Agent Card JSON at agent_card_url or /.well-known/agent.json",
            "Must return 200 application/json (not HTML/login/404)",
            "Include name, description, url/endpoint, skills[]",
            "POST https://dualregistry.dev/api/publish to resubmit for approval probing",
          ]
        : [
            "Publish MCP server-card or working remote_url",
            "Must return 200 (JSON card or MCP transport), not marketing HTML",
            "Include name + transport/url",
            "POST https://dualregistry.dev/api/publish to resubmit for approval probing",
          ],
    endpoint:
      "POST https://dualregistry.dev/api/publish — resubmit after the card returns 200 JSON",
    message: `Delisted from Dual Registry: ${failWhy(probe)}. Fix the card, then resubmit for approval probing. Partial and fail never stay listed.`,
  };
}

function classify(
  item: {
    id: string;
    name: string;
    failed_checks?: FailedCheck[];
    status?: string;
  },
  probe: ProbeResult | undefined,
): { lane: ListingLane; reason: string; checks_clean: boolean } {
  const clean = checksClean(item.failed_checks);
  if (item.status === "rejected") {
    return {
      lane: "needs_resubmit",
      reason: "Rejected — fix card/listing and resubmit for approval",
      checks_clean: clean,
    };
  }
  if (!clean) {
    return {
      lane: "needs_resubmit",
      reason: "Failed safety checks — fix issues and resubmit",
      checks_clean: false,
    };
  }
  if (!probe) {
    return {
      lane: "discovered",
      reason: "Discovered — awaiting first live probe",
      checks_clean: true,
    };
  }
  const age = Date.now() - Date.parse(probe.probed_at);
  if (probe.handshake === "ok" && probe.ok && age <= ACTIVE_PROBE_MAX_AGE_MS) {
    return {
      lane: "active",
      reason: "Active — checks clean + recent probe ok",
      checks_clean: true,
    };
  }
  if (probe.handshake === "ok" && probe.ok && age > ACTIVE_PROBE_MAX_AGE_MS) {
    return {
      lane: "discovered",
      reason: "Was probe-ok but stale — re-probe to return to active",
      checks_clean: true,
    };
  }
  if (probe.handshake === "partial") {
    return {
      lane: "needs_resubmit",
      reason: `Delisted (partial) — ${failWhy(probe)}. Fix card and resubmit for approval probing.`,
      checks_clean: false,
    };
  }
  // FAIL: removed from registry — must resubmit
  return {
    lane: "needs_resubmit",
    reason: `Delisted (probe fail) — ${failWhy(probe)}. Fix card and resubmit for approval probing.`,
    checks_clean: false,
  };
}

function probeMap(results: ProbeResult[]): Map<string, ProbeResult> {
  const m = new Map<string, ProbeResult>();
  for (const r of results) m.set(r.id, r);
  return m;
}

export async function loadProbeIndex(): Promise<Map<string, ProbeResult>> {
  try {
    const { loadProbeState } = await import("./probe");
    const s = await loadProbeState();
    const map = new Map<string, ProbeResult>();
    for (const [key, r] of Object.entries(s.results || {})) {
      if (key.startsWith("name:") || key.startsWith("url:")) continue;
      const uid = r.id || key;
      const prev = map.get(uid);
      if (!prev || (r.probed_at || "") > (prev.probed_at || "")) {
        map.set(uid, r);
      }
      if (r.id && r.id !== uid) map.set(r.id, r);
    }
    // also index name: and url: aliases for matching
    for (const [key, r] of Object.entries(s.results || {})) {
      if (key.startsWith("name:") || key.startsWith("url:")) {
        const prev = map.get(key);
        if (!prev || (r.probed_at || "") > (prev.probed_at || "")) {
          map.set(key, r);
        }
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function findProbe(
  probes: Map<string, ProbeResult>,
  ids: Array<string | undefined>,
  name?: string,
): ProbeResult | undefined {
  for (const id of ids) {
    if (id && probes.has(id)) return probes.get(id);
  }
  if (name) {
    const n = name.toLowerCase();
    for (const r of probes.values()) {
      if ((r.id || "").toLowerCase().includes(n.slice(0, 24))) return r;
    }
  }
  return undefined;
}

function enrichMcp(
  m: McpListing,
  probes: Map<string, ProbeResult>,
  source: "store" | "growth" | "mirror",
): LanedListing {
  const probe = findProbe(
    probes,
    [m.id, m.remote_url, m.website],
    m.name,
  );
  const { lane, reason, checks_clean } = classify(m, probe);
  const age = probe
    ? (Date.now() - Date.parse(probe.probed_at)) / 3600_000
    : undefined;
  const row: LanedListing = {
    id: m.id,
    kind: "mcp",
    name: m.name,
    description: m.description,
    author: m.author,
    status: m.status,
    safety_score: m.safety_score,
    safety_flags: m.safety_flags,
    failed_checks: m.failed_checks,
    repository: m.repository,
    website: m.website,
    remote_url: m.remote_url,
    lane,
    lane_reason: reason,
    checks_clean,
    probe: probe
      ? {
          ok: Boolean(probe.ok),
          handshake: probe.handshake,
          score: probe.score,
          probed_at: probe.probed_at,
          target: probe.target,
          age_hours: age,
          signals: (probe.signals || []).slice(0, 6),
        }
      : null,
    source,
    picked_up_at: m.updated_at,
  };
  if (lane === "needs_resubmit") {
    row.resubmit = resubmitHint("mcp", probe);
    row.status = row.status === "approved" ? "needs_review" : row.status;
  }
  return row;
}

function enrichAgent(
  a: AgentListing,
  probes: Map<string, ProbeResult>,
  source: "store" | "growth" | "mirror",
): LanedListing {
  const probe = findProbe(
    probes,
    [a.id, a.agent_card_url, a.endpoint_url, a.website],
    a.name,
  );
  const { lane, reason, checks_clean } = classify(a, probe);
  const age = probe
    ? (Date.now() - Date.parse(probe.probed_at)) / 3600_000
    : undefined;
  const row: LanedListing = {
    id: a.id,
    kind: "agent",
    name: a.name,
    description: a.description,
    author: a.author,
    status: a.status,
    safety_score: a.safety_score,
    safety_flags: a.safety_flags,
    failed_checks: a.failed_checks,
    repository: a.repository,
    website: a.website,
    endpoint_url: a.endpoint_url,
    agent_card_url: a.agent_card_url,
    lane,
    lane_reason: reason,
    checks_clean,
    probe: probe
      ? {
          ok: Boolean(probe.ok),
          handshake: probe.handshake,
          score: probe.score,
          probed_at: probe.probed_at,
          target: probe.target,
          age_hours: age,
          signals: (probe.signals || []).slice(0, 6),
        }
      : null,
    source,
    picked_up_at: a.updated_at,
    skills: a.skills,
    capabilities: a.capabilities,
    framework: a.framework,
  };
  if (lane === "needs_resubmit") {
    row.resubmit = resubmitHint("agent", probe);
    row.status = row.status === "approved" ? "needs_review" : row.status;
  }
  return row;
}

export async function getLanedListings(): Promise<{
  mcp_active: LanedListing[];
  mcp_discovered: LanedListing[];
  agents_active: LanedListing[];
  agents_discovered: LanedListing[];
  mcp_needs_resubmit: LanedListing[];
  agents_needs_resubmit: LanedListing[];
  counts: {
    mcp_active: number;
    mcp_discovered: number;
    agents_active: number;
    agents_discovered: number;
    mcp_needs_resubmit: number;
    agents_needs_resubmit: number;
    public_listed: number;
  };
  policy: {
    active_requires: string[];
    probe_fresh_hours: number;
    weekly_recheck_days?: number;
    weekly_recheck?: string;
    note: string;
    fail_policy: string;
  };
  categories: {
    mcp: Array<{ id: string; label: string; count: number; live?: boolean }>;
    agents: Array<{ id: string; label: string; count: number; live?: boolean }>;
    mcp_live?: Array<{ id: string; label: string; count: number }>;
    agents_live?: Array<{ id: string; label: string; count: number }>;
    policy: { exclusive: boolean; grows_on: string; no_overlap: string };
  };
}> {
  const [cache0, probes] = await Promise.all([
    loadStoreCache(),
    loadProbeIndex(),
  ]);
  let cache = cache0;
  // Production cold start: hydrate store listings so Active lanes aren't empty
  if (
    !(cache.mcp_items || []).length &&
    !(cache.agent_items || []).length
  ) {
    try {
      const { getLiveSnapshot } = await import("./fetch-live");
      await getLiveSnapshot({ forceLive: true });
      cache = await loadStoreCache();
    } catch {
      /* keep empty cache */
    }
  }

  const mcpByName = new Set(
    (cache.mcp_items || []).map((m) => m.name.toLowerCase()),
  );
  const agentByName = new Set(
    (cache.agent_items || []).map((a) => a.name.toLowerCase()),
  );

  const mcps: LanedListing[] = (cache.mcp_items || []).map((m) =>
    enrichMcp(m, probes, "store"),
  );
  const agents: LanedListing[] = (cache.agent_items || []).map((a) =>
    enrichAgent(a, probes, "store"),
  );

  try {
    const state = await loadState();
    for (const c of state.candidates || []) {
      const key = (c.name || "").toLowerCase();
      if (!key) continue;
      if (c.kind === "mcp") {
        if (mcpByName.has(key)) continue;
        mcpByName.add(key);
        const pseudo: McpListing = {
          id: c.store_id || c.id || `growth-mcp-${key}`,
          name: c.name,
          description: c.description,
          repository: c.repository,
          website: c.website,
          remote_url: c.remote_url,
          author: c.author || "agents1-growth",
          status:
            c.status === "approved"
              ? "approved"
              : c.status === "rejected"
                ? "rejected"
                : "needs_review",
          safety_score: c.safety_score ?? 55,
          failed_checks: [],
          updated_at: c.updated_at,
        };
        mcps.push(enrichMcp(pseudo, probes, "growth"));
      } else if (c.kind === "agent") {
        if (agentByName.has(key)) continue;
        agentByName.add(key);
        const pseudo: AgentListing = {
          id: c.store_id || c.id || `growth-agent-${key}`,
          name: c.name,
          description: c.description,
          repository: c.repository,
          website: c.website,
          endpoint_url: c.endpoint_url,
          agent_card_url: c.agent_card_url,
          author: c.author || "agents1-growth",
          skills: c.skills,
          capabilities: c.capabilities,
          status:
            c.status === "approved"
              ? "approved"
              : c.status === "rejected"
                ? "rejected"
                : "needs_review",
          safety_score: c.safety_score ?? 55,
          failed_checks: [],
          updated_at: c.updated_at,
        };
        agents.push(enrichAgent(pseudo, probes, "growth"));
      }
    }
  } catch {
    /* */
  }

  // Persist rejection on growth candidates when probe failed (so they don't re-appear as approved)
  try {
    const { loadState: ls, saveState } = await import("./growth/persist");
    const state = await ls();
    let dirty = false;
    for (const c of state.candidates || []) {
      const probe = findProbe(
        probes,
        [c.id, c.store_id, c.agent_card_url, c.remote_url, c.endpoint_url],
        c.name,
      );
      if (
        probe &&
        (probe.handshake === "fail" ||
          (probe.handshake === "partial" && !probe.ok)) &&
        c.status !== "rejected"
      ) {
        c.status = "rejected";
        c.quality_hints = [
          ...(c.quality_hints || []).filter(
            (h) => !String(h).startsWith("reject:"),
          ),
          `reject:probe_${probe.handshake}`,
          `reject_why:${failWhy(probe).slice(0, 120)}`,
        ];
        c.updated_at = new Date().toISOString();
        dirty = true;
      }
      // Clear reject if later ok
      if (
        probe &&
        probe.handshake === "ok" &&
        probe.ok &&
        c.status === "rejected"
      ) {
        c.status = "queued";
        c.quality_hints = (c.quality_hints || []).filter(
          (h) => !String(h).startsWith("reject"),
        );
        dirty = true;
      }
    }
    if (dirty) await saveState(state);
  } catch {
    /* non-blocking */
  }

  const sortFn = (a: LanedListing, b: LanedListing) =>
    (b.safety_score ?? 0) - (a.safety_score ?? 0) ||
    a.name.localeCompare(b.name);

  let mcp_active = mcps.filter((x) => x.lane === "active").sort(sortFn);
  let agents_active = agents.filter((x) => x.lane === "active").sort(sortFn);
  // PRODUCT: public registry = CLEAN ONLY. Never expose unprobed store dump.
  const mcp_discovered: LanedListing[] = [];
  const agents_discovered: LanedListing[] = [];
  const mcp_needs_resubmit = mcps
    .filter((x) => x.lane === "needs_resubmit")
    .sort(sortFn)
    .slice(0, 40);
  const agents_needs_resubmit = agents
    .filter((x) => x.lane === "needs_resubmit")
    .sort(sortFn)
    .slice(0, 40);

  // CLEAN REGISTRY SOURCE OF TRUTH = probe-ok results (not store membership).
  // Cold starts with thin store cache still keep every confirmed-clean target.
  {
    const have = new Set(
      [...mcp_active, ...agents_active].flatMap((r) =>
        [r.id, r.agent_card_url, r.remote_url, r.website].filter(Boolean) as string[],
      ),
    );
    for (const r of probes.values()) {
      if (!(r.handshake === "ok" && r.ok)) continue;
      if ((r.id || "").startsWith("name:") || (r.id || "").startsWith("url:")) continue;
      const target = r.target || "";
      if (have.has(r.id) || (target && have.has(target))) continue;
      const age = Date.now() - Date.parse(r.probed_at || "");
      if (!Number.isFinite(age) || age > ACTIVE_PROBE_MAX_AGE_MS) continue;
      const kind = (r.kind === "agent" ? "agent" : "mcp") as "agent" | "mcp";
      const row: LanedListing = {
        id: r.id,
        kind,
        name: (r as { name?: string }).name || r.id,
        description: undefined,
        website: target || undefined,
        remote_url: kind === "mcp" ? target : undefined,
        agent_card_url: kind === "agent" ? target : undefined,
        lane: "active",
        lane_reason: "Active — probe ok at source URL",
        checks_clean: true,
        probe: {
          ok: true,
          handshake: "ok",
          score: r.score || 0,
          probed_at: r.probed_at,
          target,
          age_hours: age / 3600_000,
          signals: (r.signals || []).slice(0, 6),
        },
        source: "mirror",
        safety_score: r.score || 50,
      };
      if (kind === "mcp") mcp_active.push(row);
      else agents_active.push(row);
      have.add(r.id);
      if (target) have.add(target);
    }
    const dedupe = (rows: LanedListing[]) => {
      const by = new Map<string, LanedListing>();
      for (const r of rows) {
        const key = (
          r.agent_card_url ||
          r.remote_url ||
          r.endpoint_url ||
          r.website ||
          r.id
        )
          .toLowerCase()
          .replace(/\/$/, "");
        const prev = by.get(key);
        if (!prev) {
          by.set(key, r);
          continue;
        }
        const pa = prev.probe?.probed_at || "";
        const ra = r.probe?.probed_at || "";
        if (ra >= pa) by.set(key, r);
      }
      return [...by.values()].sort(sortFn);
    };
    mcp_active = dedupe(mcp_active);
    agents_active = dedupe(agents_active);
  }

  let categories: {
    mcp: Array<{ id: string; label: string; count: number; live?: boolean }>;
    agents: Array<{ id: string; label: string; count: number; live?: boolean }>;
    mcp_live?: Array<{ id: string; label: string; count: number }>;
    agents_live?: Array<{ id: string; label: string; count: number }>;
    policy: { exclusive: boolean; grows_on: string; no_overlap: string };
  } = {
    mcp: [],
    agents: [],
    policy: {
      exclusive: true,
      grows_on: "active only (checks clean + probe ok)",
      no_overlap: "one primary category per listing",
    },
  };

  try {
    const { syncCategoriesFromListings, getLiveCategoryCatalog } = await import(
      "./categories"
    );
    // Categories only from Active
    const allForSync = [...mcp_active, ...agents_active].map((L) => ({
      id: L.id,
      kind: L.kind,
      name: L.name,
      description: L.description,
      skills: L.skills,
      capabilities: L.capabilities,
      tags: L.tags,
      framework: L.framework,
      lane: L.lane,
    }));
    const store = await syncCategoriesFromListings(allForSync);
    const cat = await getLiveCategoryCatalog();
    categories = {
      mcp: cat.mcp,
      agents: cat.agents,
      mcp_live: cat.mcp_live,
      agents_live: cat.agents_live,
      policy: cat.policy,
    };
    for (const row of [
      ...mcp_active,
      ...mcp_discovered,
      ...agents_active,
      ...agents_discovered,
    ]) {
      const a = store.assignments[`${row.kind}:${row.id}`];
      if (a) {
        row.category_id = a.category_id;
        row.category_label = a.category_label;
        row.category_reason = a.reason;
      }
    }
  } catch {
    /* categories optional */
  }

  try {
    const { listingEngagementBadges } = await import(
      "@/lib/products/quick-demo"
    );
    const badges = await listingEngagementBadges();
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const apply = (rows: LanedListing[]) => {
      for (const r of rows) {
        const b = badges.get(norm(r.name));
        if (!b) continue;
        (r as LanedListing & {
          demoed?: boolean;
          feedbacked?: boolean;
          founder_n?: number;
        }).demoed = b.demoed;
        (r as LanedListing & { feedbacked?: boolean }).feedbacked = b.feedbacked;
        if (b.founder_n)
          (r as LanedListing & { founder_n?: number }).founder_n = b.founder_n;
      }
    };
    apply(mcp_active);
    apply(agents_active);
  } catch {
    /* */
  }

  let mcp_active_out: LanedListing[] = mcp_active;
  let agents_active_out: LanedListing[] = agents_active;
  try {
    const { attachActivationToListings, publicOriginFromEnv } = await import(
      "@/lib/products/activation-funnel"
    );
    // Always dualregistry.dev (or AGENTS1_PUBLIC_ORIGIN) for agent-facing take_demo URLs
    const origin = publicOriginFromEnv();
    mcp_active_out = attachActivationToListings(
      mcp_active,
      origin,
    ) as LanedListing[];
    agents_active_out = attachActivationToListings(
      agents_active,
      origin,
    ) as LanedListing[];
  } catch {
    /* */
  }

  return {
    mcp_active: mcp_active_out,
    mcp_discovered,
    agents_active: agents_active_out,
    agents_discovered,
    mcp_needs_resubmit,
    agents_needs_resubmit,
    counts: {
      mcp_active: mcp_active.length,
      mcp_discovered: mcp_discovered.length,
      agents_active: agents_active.length,
      agents_discovered: agents_discovered.length,
      mcp_needs_resubmit: mcp_needs_resubmit.length,
      agents_needs_resubmit: agents_needs_resubmit.length,
      public_listed: mcp_active.length + agents_active.length,
    },
    policy: {
      active_requires: [
        "failed_checks empty (checks clean)",
        "live probe handshake ok",
        `probe fresher than ${ACTIVE_PROBE_MAX_AGE_MS / 3600_000}h`,
      ],
      probe_fresh_hours: ACTIVE_PROBE_MAX_AGE_MS / 3600_000,
      weekly_recheck_days: 7,
      weekly_recheck: "unlimited — every Active re-probed 7d after last ok",
      note: "Public registry = CLEAN ONLY. A listing appears only after probe ok at its own card/URL. Unprobed store junk is never listed.",
      fail_policy:
        "Probe fail/partial = never listed. Fix card, resubmit via /list, then we probe again before listing.",
    },
    categories,
  };
}
