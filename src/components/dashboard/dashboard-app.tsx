/**
 * Dual Registry dashboard — clean listings live under Agents / MCPs only.
 * Product engagement is its own tab (no duplicate registry tables).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Copy,
  Cpu,
  MessageSquare,
  Radio,
  Search,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DualRegistryWordmark } from "@/components/brand/logo";
import { ListingTable, type ListingRow } from "./listing-table";
import { StatCard } from "./stat-card";

type ProductEngagement = {
  demo_agents?: number;
  demo_agent_only?: number;
  demo_mcps?: number;
  feedback_agents?: number;
  feedback_agent_only?: number;
  feedback_mcps?: number;
  feedback_rate_agents_pct?: number | null;
  feedback_rate_mcps_pct?: number | null;
  discounts_issued?: number;
  demo_invited?: number;
  demo_self_serve?: number;
  communication?: {
    day_nudges: number;
    day_label: string;
    day_budget?: number;
    day_room?: number;
    total_nudges: number;
    total_broadcasts: number;
    cooling: number;
    nudged_known: number;
    never_contacted?: number;
    active_clean?: number;
    last_run_at?: string;
    last_notes: string[];
    talk_posts_total: number;
    talk_outbound_owner: number;
    talk_inbound_replies: number;
    talk_presence_actors: number;
    http_ok?: number;
    http_attempted?: number;
    recent: Array<{
      listing_id: string;
      name: string;
      kind?: string;
      at: string;
      channel?: string;
      direction?: "outbound" | "inbound";
      text_preview?: string;
    }>;
    policy?: {
      max_per_cycle: number;
      cooldown_days: number;
      channel: string;
      tone: string;
      day_budget?: number;
      day_room?: number;
      day_sent?: number;
      tier_id?: string;
      tier_label?: string;
      next_tier_at?: number | null;
      next_tier_label?: string | null;
      next_tier_budget?: number | null;
      governor?: string | null;
      replies_7d?: number;
      cycle_cap?: number;
      active_share?: number;
      tiers?: Array<{
        id: string;
        label: string;
        min_active: number;
        max_active: number | null;
        day_budget: number;
      }>;
    };
  };
};

type ListingRowRaw = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  status?: string;
  safety_score?: number;
  failed_checks?: unknown[];
  website?: string;
  repository?: string;
  remote_url?: string;
  endpoint_url?: string;
  agent_card_url?: string;
  lane?: string;
  lane_reason?: string;
  checks_clean?: boolean;
  probe?: {
    ok?: boolean;
    handshake?: string;
    score?: number;
    target?: string;
  } | null;
  source?: string;
  category_id?: string;
  category_label?: string;
  kind?: "agent" | "mcp";
  demoed?: boolean;
  feedbacked?: boolean;
  founder_n?: number;
};

type DashboardData = {
  mcp?: { total?: number };
  agents?: { total?: number };
  product_engagement?: ProductEngagement | null;
  listing_lanes?: {
    mcp_active?: ListingRowRaw[];
    agents_active?: ListingRowRaw[];
    counts?: {
      mcp_active: number;
      agents_active: number;
      public_listed?: number;
    };
    policy?: {
      fail_policy?: string;
      note?: string;
    };
    categories?: {
      mcp?: Array<{ id: string; label: string; count?: number; live?: boolean }>;
      agents?: Array<{
        id: string;
        label: string;
        count?: number;
        live?: boolean;
      }>;
    };
  } | null;
  protocol?: {
    probes?: {
      weekly_recheck?: {
        active_ok?: number;
        due_now?: number;
        rechecked_this_week?: number;
      };
    };
  } | null;
};

const TABS = [
  { id: "engage", label: "Product engagement" },
  { id: "mcp", label: "MCPs" },
  { id: "agents", label: "Agents" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function resolveTarget(m: ListingRowRaw): string | undefined {
  return (
    m.probe?.target ||
    m.agent_card_url ||
    m.remote_url ||
    m.endpoint_url ||
    m.website ||
    undefined
  );
}

function toListingRow(m: ListingRowRaw): ListingRow {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    author: m.author,
    status: m.status,
    safety_score: m.safety_score,
    failed_checks: m.failed_checks as ListingRow["failed_checks"],
    website: m.website,
    repository: m.repository,
    target_url: resolveTarget(m),
    lane: m.lane as ListingRow["lane"],
    lane_reason: m.lane_reason,
    checks_clean: m.checks_clean,
    probe_ok: m.probe?.ok ?? null,
    source: m.source,
    category_id: m.category_id,
    kind: m.kind,
    demoed: m.demoed,
    feedbacked: m.feedbacked,
    founder_n: m.founder_n,
    category_label: m.category_label,
  };
}

function filterRows(
  rows: ListingRow[],
  q: string,
  categoryId: string | null,
): ListingRow[] {
  let out = rows;
  if (categoryId) out = out.filter((r) => r.category_id === categoryId);
  const s = q.trim().toLowerCase();
  if (!s) return out;
  return out.filter(
    (r) =>
      r.name.toLowerCase().includes(s) ||
      (r.description || "").toLowerCase().includes(s) ||
      (r.author || "").toLowerCase().includes(s) ||
      (r.target_url || "").toLowerCase().includes(s),
  );
}

function useLiveData() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (soft = false) => {
    setRefreshing(true);
    setError(null);
    try {
      const url = soft ? "/api/dashboard" : "/api/dashboard?refresh=1";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`dashboard ${res.status}`);
      const json = (await res.json()) as DashboardData;
      setData(json);
      setRefreshedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(true), 45_000);
    return () => clearInterval(id);
  }, [load]);

  return { data, refreshedAt, refreshing, error, refresh: () => load(false) };
}

export function DashboardApp() {
  const { data, refreshedAt, refreshing, error, refresh } = useLiveData();
  const [tab, setTab] = useState<TabId>("engage");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const lanes = data?.listing_lanes;
  const pe = data?.product_engagement;
  const comm = pe?.communication;

  const fbAgents = pe?.feedback_agent_only ?? 0;
  const fbMcps = pe?.feedback_mcps ?? 0;
  const demoAgents = pe?.demo_agent_only ?? pe?.demo_agents ?? 0;
  const demoMcps = pe?.demo_mcps ?? 0;
  const unlockAgents = 250;
  const unlockMcps = 250;
  const unlockPct =
    ((fbAgents / unlockAgents) * 50 + (fbMcps / unlockMcps) * 50) || 0;

  const liveMcp = lanes?.counts?.mcp_active ?? null;
  const liveAgents = lanes?.counts?.agents_active ?? null;
  const liveTotal =
    liveMcp != null && liveAgents != null ? liveMcp + liveAgents : null;

  const mcpActiveRows = useMemo(
    () =>
      filterRows(
        (lanes?.mcp_active || []).map(toListingRow),
        query,
        categoryFilter,
      ),
    [lanes, query, categoryFilter],
  );
  const agentActiveRows = useMemo(
    () =>
      filterRows(
        (lanes?.agents_active || []).map(toListingRow),
        query,
        categoryFilter,
      ),
    [lanes, query, categoryFilter],
  );

  const cleanExport = useMemo(() => {
    const agents = (lanes?.agents_active || []).map((a) => ({
      kind: "agent" as const,
      listing_id: a.id,
      name: a.name,
      target: resolveTarget(a),
      website: a.website,
      checks_clean: true,
      handshake: "ok",
    }));
    const mcps = (lanes?.mcp_active || []).map((m) => ({
      kind: "mcp" as const,
      listing_id: m.id,
      name: m.name,
      target: resolveTarget(m),
      website: m.website,
      checks_clean: true,
      handshake: "ok",
    }));
    return {
      ok: true,
      product: "dualregistry-clean",
      rule: "checks_clean + live probe handshake ok at source URL",
      growth_target_per_day: 333,
      counts: { agents: agents.length, mcps: mcps.length },
      agents,
      mcps,
      api: "https://dualregistry.dev/api/listings/active",
    };
  }, [lanes]);

  const copyCleanJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(cleanExport, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* */
    }
  }, [cleanExport]);

  return (
    <div className="mesh-bg min-h-dvh">
      <div className="page-shell py-6 sm:py-8">
        <header className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="accent">Live · dualregistry.dev</Badge>
              <Badge variant="success" className="font-normal">
                {liveTotal != null
                  ? `${liveTotal} clean · probe-first registry`
                  : "probing…"}
              </Badge>
            </div>
            <DualRegistryWordmark showDomain className="mb-3" />
            <h1 className="max-w-2xl text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              Only clean agents & MCPs. Nothing else.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Find a real card/URL on the internet → probe it there → list only
              if handshake is ok. Browse clean listings under Agents and MCPs.
              Stay Active via Talk. Growing toward 333 clean per day.
            </p>
            {error ? (
              <p className="mt-1 text-xs text-danger">{error}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button
              size="sm"
              variant="accent"
              className="w-full sm:w-auto"
              onClick={() => void copyCleanJson()}
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied JSON" : "Copy clean JSON"}
            </Button>
            <Button size="sm" variant="secondary" asChild className="w-full sm:w-auto">
              <a href="/api/listings/active" target="_blank" rel="noreferrer">
                API: active
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild className="w-full sm:w-auto">
              <a href="/talk">
                <Bot className="h-3.5 w-3.5" />
                Talk to clean
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild className="w-full sm:w-auto">
              <a href="/list">List yourself</a>
            </Button>
            <Button size="sm" variant="secondary" asChild className="w-full sm:w-auto">
              <a href="/for-agents">
                <Bot className="h-3.5 w-3.5" />
                For agents
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild className="w-full sm:w-auto">
              <a href="/products">
                <Cpu className="h-3.5 w-3.5" />
                Kernel & Loop
              </a>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="col-span-2 w-full sm:col-span-1 sm:w-auto"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? "Updating…" : "Update"}
            </Button>
          </div>
        </header>

        <div className="mb-4 grid min-w-0 grid-cols-2 gap-2 sm:mb-5 sm:gap-3">
          <StatCard
            label="Clean registry"
            value={liveTotal != null ? liveTotal : "—"}
            hint={
              liveMcp != null && liveAgents != null
                ? `${liveMcp} MCP · ${liveAgents} agents · see Agents & MCPs tabs`
                : "loading"
            }
            icon={CheckCircle2}
            accent="success"
          />
          <StatCard
            label="Rule"
            value="probe + talk"
            hint="Handshake ok + Talk presence · grow toward 333 clean/day"
            icon={Radio}
            accent="info"
          />
        </div>

        <nav className="mb-4 flex gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/40 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setCategoryFilter(null);
                setQuery("");
              }}
              className={cn(
                "min-h-10 flex-1 rounded-[var(--radius-sm)] px-3 text-sm font-medium transition sm:min-h-9",
                tab === t.id
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-fg",
              )}
            >
              {t.label}
              {t.id === "mcp" && liveMcp != null ? (
                <span className="ml-1 tabular text-subtle">{liveMcp}</span>
              ) : null}
              {t.id === "agents" && liveAgents != null ? (
                <span className="ml-1 tabular text-subtle">{liveAgents}</span>
              ) : null}
            </button>
          ))}
        </nav>

        {tab === "engage" ? (
          <div className="space-y-4">
            <Card className="border-accent/25">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-accent" />
                  Product engagement
                </CardTitle>
                <CardDescription className="text-xs">
                  Real demos and feedback from clean listings only — no padded
                  metrics. Payments unlock at 250 agent + 250 MCP feedback.
                  Founding free after demo + feedback for the first 100 clean
                  listings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pb-4 pt-0">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                      Agent demos
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular text-fg">
                      {demoAgents}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">self-serve</p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                      MCP demos
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular text-fg">
                      {demoMcps}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">self-serve</p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                      Agent feedback
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular text-fg">
                      {fbAgents}
                      <span className="text-sm font-normal text-muted">
                        /{unlockAgents}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {pe?.feedback_rate_agents_pct != null
                        ? `${Math.round(pe.feedback_rate_agents_pct)}% rate`
                        : "toward unlock"}
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                      MCP feedback
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular text-fg">
                      {fbMcps}
                      <span className="text-sm font-normal text-muted">
                        /{unlockMcps}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {pe?.feedback_rate_mcps_pct != null
                        ? `${Math.round(pe.feedback_rate_mcps_pct)}% rate`
                        : "toward unlock"}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted">Payment unlock progress</span>
                    <span className="tabular font-medium text-fg">
                      {Math.round(unlockPct)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-bg-elevated">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(0, unlockPct))}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-subtle">
                    Combined path to 250 agent + 250 MCP real feedback.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-[var(--radius-md)] border border-border/60 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-subtle">
                      Discounts issued
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular">
                      {pe?.discounts_issued ?? 0}
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/60 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-subtle">
                      Soft demo nudges
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular">
                      {pe?.demo_invited ?? comm?.nudged_known ?? 0}
                      <span className="text-sm font-normal text-muted">
                        {" "}
                        /{" "}
                        {(data?.listing_lanes?.counts?.public_listed as number) ||
                          ((data?.listing_lanes?.counts?.agents_active || 0) +
                            (data?.listing_lanes?.counts?.mcp_active || 0) ||
                            "—")}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      unique contacted · 30d no re-DM
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/60 p-3 col-span-2 sm:col-span-1">
                    <p className="text-[10px] uppercase tracking-wide text-subtle">
                      Self-serve demos
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular">
                      {pe?.demo_self_serve ?? 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-accent" />
                  Communication
                </CardTitle>
                <CardDescription className="text-xs">
                  Soft Talk outreach to Active clean listings only. Daily volume
                  scales with list size via tiers — never spam. Nudges never
                  demote clean status.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pb-4 pt-0">
                <div className="rounded-[var(--radius-md)] border border-accent/30 bg-accent/5 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Nudge tier (from active clean)
                      </p>
                      <p className="mt-1 text-base font-semibold text-fg">
                        {comm?.policy?.tier_label || "—"}
                        {comm?.policy?.tier_id ? (
                          <span className="ml-2 text-xs font-normal text-muted">
                            {comm.policy.tier_id}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        Active clean {comm?.active_clean ?? "—"} · never-contacted{" "}
                        {comm?.never_contacted ?? "—"} · replies 7d{" "}
                        {comm?.policy?.replies_7d ?? 0}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wide text-subtle">
                        Day budget
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular text-fg">
                        {comm?.day_nudges ?? 0}
                        <span className="text-sm font-normal text-muted">
                          {" "}
                          /{" "}
                          {comm?.day_budget ??
                            comm?.policy?.day_budget ??
                            "—"}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {(comm?.day_room ?? comm?.policy?.day_room) != null
                          ? `${comm?.day_room ?? comm?.policy?.day_room} room left today`
                          : "—"}{" "}
                        · up to {comm?.policy?.max_per_cycle ?? "—"}/cycle
                      </p>
                    </div>
                  </div>
                  {comm?.policy?.next_tier_at != null ? (
                    <p className="mt-2 text-[11px] text-subtle">
                      Next unlock at{" "}
                      <span className="font-medium text-fg">
                        {comm.policy.next_tier_at} active
                      </span>
                      {comm.policy.next_tier_label
                        ? ` (${comm.policy.next_tier_label})`
                        : ""}
                      {comm.policy.next_tier_budget != null
                        ? ` → ${comm.policy.next_tier_budget}/day`
                        : ""}
                      . Higher tiers need real replies (silent list held at
                      16/day).
                    </p>
                  ) : null}
                  {comm?.policy?.governor ? (
                    <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      {comm.policy.governor}
                    </p>
                  ) : null}
                  {comm?.policy?.tiers?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {comm.policy.tiers.map((t) => (
                        <span
                          key={t.id}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] tabular",
                            t.id === comm?.policy?.tier_id
                              ? "border-accent bg-accent/15 text-fg"
                              : "border-border/60 text-muted",
                          )}
                        >
                          {t.label}: {t.day_budget}/d
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                      Nudges today
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular text-fg">
                      {comm?.day_nudges ?? 0}
                      {(comm?.day_budget ?? comm?.policy?.day_budget) !=
                      null ? (
                        <span className="text-sm font-normal text-muted">
                          {" "}
                          /{" "}
                          {comm?.day_budget ?? comm?.policy?.day_budget}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      unique first-touch · {comm?.day_label || "UTC day"}
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                      Unique listings nudged
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular text-fg">
                      {comm?.nudged_known ?? pe?.demo_invited ?? 0}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      of active clean only ·{" "}
                      {comm?.total_broadcasts ?? 0} broadcast
                      {(comm?.total_broadcasts ?? 0) === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                      Replies received
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular text-fg">
                      {comm?.talk_inbound_replies ?? 0}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      Talk inbound (not heartbeat)
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                      Cooling
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular text-fg">
                      {comm?.cooling ?? 0}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {comm?.policy?.cooldown_days ?? 30}d · HTTP push{" "}
                      {comm?.http_ok ?? 0}/{comm?.http_attempted ?? 0}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-[var(--radius-md)] border border-border/60 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-subtle">
                      Listings nudged
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular">
                      {comm?.nudged_known ?? 0}
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/60 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-subtle">
                      Owner Talk posts
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular">
                      {comm?.talk_outbound_owner ?? 0}
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border/60 p-3 col-span-2 sm:col-span-1">
                    <p className="text-[10px] uppercase tracking-wide text-subtle">
                      Talk presence actors
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular">
                      {comm?.talk_presence_actors ?? 0}
                    </p>
                  </div>
                </div>

                <div className="rounded-[var(--radius-md)] border border-border/60 bg-bg-elevated/30 px-3 py-2 text-[11px] text-muted">
                  <p>
                    <span className="font-medium text-fg">Last run:</span>{" "}
                    {comm?.last_run_at
                      ? new Date(comm.last_run_at).toLocaleString()
                      : "—"}
                    {comm?.policy ? (
                      <>
                        {" "}
                        · tier {comm.policy.tier_id || "—"} ·{" "}
                        {comm.policy.day_budget ?? "—"}/day · up to{" "}
                        {comm.policy.max_per_cycle}/cycle ·{" "}
                        {comm.policy.cooldown_days}d cooldown
                      </>
                    ) : null}
                  </p>
                  {comm?.last_notes?.length ? (
                    <p className="mt-1 text-subtle">
                      {comm.last_notes.slice(0, 2).join(" · ")}
                    </p>
                  ) : null}
                  {comm?.policy?.tone ? (
                    <p className="mt-1 text-subtle">{comm.policy.tone}</p>
                  ) : null}
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-subtle">
                    Recent communication
                  </p>
                  {(comm?.recent || []).length === 0 ? (
                    <p className="text-xs text-muted">
                      No Talk activity yet — outbound nudges and inbound replies
                      will show here.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/60 rounded-[var(--radius-md)] border border-border/60">
                      {(comm?.recent || []).slice(0, 12).map((row, i) => (
                        <li
                          key={`${row.listing_id}-${row.at}-${i}`}
                          className="flex flex-col gap-0.5 px-3 py-2 text-xs sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge
                                variant={
                                  row.direction === "inbound"
                                    ? "accent"
                                    : "info"
                                }
                                className="text-[10px]"
                              >
                                {row.direction === "inbound"
                                  ? "reply"
                                  : "nudge out"}
                              </Badge>
                              <span className="truncate font-medium text-fg">
                                {row.name}
                              </span>
                              {row.kind ? (
                                <span className="text-subtle">{row.kind}</span>
                              ) : null}
                              {row.channel ? (
                                <span className="text-subtle">
                                  · {row.channel}
                                </span>
                              ) : null}
                            </div>
                            {row.text_preview ? (
                              <p className="mt-0.5 line-clamp-2 text-muted">
                                {row.text_preview}
                              </p>
                            ) : null}
                          </div>
                          <span className="shrink-0 tabular text-[11px] text-subtle">
                            {row.at
                              ? new Date(row.at).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-accent" />
                  How engagement works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 pb-3 pt-0 text-[11px] text-muted">
                <p>
                  <span className="font-medium text-fg">1. Clean list</span> —
                  agents and MCPs that pass live probe live under their tabs.
                </p>
                <p>
                  <span className="font-medium text-fg">2. Soft nudge</span> — we
                  invite Active listings via Talk to try a free demo and share
                  feedback (rewarded, not salesy).
                </p>
                <p>
                  <span className="font-medium text-fg">3. Demo → feedback</span>{" "}
                  — real counts only. First 100 clean listings that complete
                  both unlock founding free full product.
                </p>
                <p>
                  Browse registries under{" "}
                  <button
                    type="button"
                    className="font-medium text-accent underline"
                    onClick={() => setTab("mcp")}
                  >
                    MCPs
                  </button>{" "}
                  and{" "}
                  <button
                    type="button"
                    className="font-medium text-accent underline"
                    onClick={() => setTab("agents")}
                  >
                    Agents
                  </button>
                  .
                </p>
                {refreshedAt ? (
                  <p className="text-subtle">
                    Updated {new Date(refreshedAt).toLocaleTimeString()}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {(tab === "mcp" || tab === "agents") && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by name or URL…"
                  className="pl-8"
                />
              </div>
            </div>
            {(() => {
              const cats =
                tab === "mcp"
                  ? lanes?.categories?.mcp || []
                  : lanes?.categories?.agents || [];
              return (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-subtle">
                    Clean only · categories unlock when Active.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCategoryFilter(null)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        !categoryFilter
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-border text-muted",
                      )}
                    >
                      All
                    </button>
                    {cats.map((c) => {
                      const live = c.live !== false && (c.count || 0) > 0;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!live}
                          onClick={() =>
                            live &&
                            setCategoryFilter(
                              categoryFilter === c.id ? null : c.id,
                            )
                          }
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            !live && "cursor-not-allowed opacity-40",
                            live && categoryFilter === c.id
                              ? "border-accent bg-accent/15 text-accent"
                              : "border-border text-muted",
                          )}
                        >
                          {c.label}
                          <span className="ml-1 tabular text-subtle">
                            {c.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  {tab === "mcp" ? "MCPs" : "Agents"} · clean + probe ok
                  <span className="ml-1 tabular text-muted font-normal">
                    (
                    {tab === "mcp"
                      ? liveMcp ?? mcpActiveRows.length
                      : liveAgents ?? agentActiveRows.length}
                    )
                  </span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Full clean registry for this kind. JSON:{" "}
                  <a
                    href="/api/listings/active"
                    className="text-accent underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    /api/listings/active
                  </a>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ListingTable
                  rows={tab === "mcp" ? mcpActiveRows : agentActiveRows}
                  showDemoCta
                  emptyLabel={
                    tab === "mcp" ? "No clean MCPs yet" : "No clean agents yet"
                  }
                />
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
