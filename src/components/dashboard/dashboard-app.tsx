/**
 * Dual Registry dashboard — clean listings under Agents / MCPs only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  DollarSign,
  MessageSquare,
  Radio,
  Search,
  Sparkles,
  Workflow,
  Zap,
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
import { SiteNav } from "@/components/brand/site-nav";
import { CategoryGroupedListings } from "./category-listings";
import type { ListingRow } from "./listing-table";
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
  platform_cost?: {
    plan?: string;
    fluid?: boolean;
    rates_version?: string;
    running_total?: {
      today_usd?: number;
      month_usd_gross?: number;
      month_usd_after_pro_credit?: number;
      lifetime_usd?: number;
    };
    today?: {
      invocations?: number;
      active_cpu_ms?: number;
      active_cpu_hours?: number;
      skipped_cadence?: number;
      cache_hits?: number;
      usd?: { total?: number; active_cpu?: number };
    };
    month?: {
      month?: string;
      invocations?: number;
      usd_gross?: number;
      usd_after_credit?: number;
      pro_credit_usd?: number;
    };
    savings?: {
      cadence_skips_today?: number;
      cache_hit_rate?: number | null;
      notes?: string[];
    };
  } | null;
  agent_runs?: {
    day?: string;
    totals?: {
      n?: number;
      ok?: number;
      error?: number;
      skipped?: number;
      avg_duration_ms?: number;
      success_rate?: number | null;
    };
    recent?: Array<{
      id?: string;
      title?: string;
      tool?: string;
      status?: string;
      duration_ms?: number;
      usd_estimate?: number;
    }>;
  } | null;
  growth_scout?: {
    month?: string;
    month_usd?: number;
    month_budget_usd?: number;
    budget_remaining_usd?: number;
    budget_exhausted?: boolean;
    month_invites?: number;
    day_invites?: number;
    max_invites_per_day?: number;
    cooldown_days?: number;
    last_run_at?: string;
    last_status?: string;
    last_error?: string;
    last_notes?: string[];
    invited_unique?: number;
    allowlist?: {
      shareabot_registered?: boolean;
      shareabot_claim_url?: string | null;
      moltbook_last_post?: string | null;
    };
    xai_configured?: boolean;
    moltbook_configured?: boolean;
    conversion?: {
      invites?: number;
      talk_ok?: number;
      http_ok?: number;
      both_ok?: number;
      failed?: number;
      demos?: number;
      feedback?: number;
      replies?: number;
      stigmergy_deposits?: number;
      autocatalysis_bumps?: number;
      compositions_seeded?: number;
    };
  } | null;

  hero?: {
    version?: string;
    feedback_source?: string;
    live?: number;
    live_mcp?: number;
    live_agents?: number;
    probes_today?: number;
    probes_agents?: number;
    probes_mcps?: number;
    agent_events_today?: number;
    agent_events_free?: number;
    agent_events_paid?: number;
    agent_events_refills?: number;
    feedback_real?: number;
    feedback_agents?: number;
    feedback_mcps?: number;
    unlock_agents?: number;
    unlock_mcps?: number;
    unlock_agents_target?: number;
    unlock_mcps_target?: number;
    unlock_agents_progress?: number;
    unlock_mcps_progress?: number;
    outcomes?: number;
    network_o?: number | null;
    updated_at?: string;
  } | null;

};

const TABS = [
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

  const [opsLoading, setOpsLoading] = useState(false);

  const load = useCallback(async (soft = false, opts?: { ops?: boolean }) => {
    // Soft poll: do not flip global refreshing spinner (keeps UI snappy)
    if (!soft && !opts?.ops) setRefreshing(true);
    if (opts?.ops) setOpsLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (!soft) q.set("refresh", "1");
      if (opts?.ops) q.set("ops", "1");
      const qs = q.toString();
      const url = qs ? `/api/dashboard?${qs}` : "/api/dashboard";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`dashboard ${res.status}`);
      const json = (await res.json()) as DashboardData;
      const forceOps = Boolean(opts?.ops);
      // Sticky merge: never flash zeros when a soft poll times out side panels
      setData((prev) => {
        if (!prev) return json;
        const score = {
          cost: (v?: DashboardData["platform_cost"]) =>
            Number(v?.running_total?.month_usd_gross || 0) * 1e6 +
            Number(v?.running_total?.today_usd || 0) * 1e3 +
            Number(v?.today?.invocations || 0) +
            (v && typeof v === "object" && "ok" in (v as object) ? 1 : 0),
          runs: (v?: DashboardData["agent_runs"]) =>
            Number(v?.totals?.n || 0) * 10 + Number(v?.totals?.ok || 0) +
            (v && typeof v === "object" ? 1 : 0),
          scout: (v?: DashboardData["growth_scout"]) =>
            Number(v?.month_invites || 0) * 1000 +
            Number(v?.day_invites || 0) * 100 +
            Number(v?.invited_unique || 0) * 10 +
            Number(v?.month_usd || 0) * 1e6 +
            (v && typeof v === "object" ? 1 : 0),
          lanes: (v?: DashboardData["listing_lanes"]) => {
            const mcp = Array.isArray(v?.mcp_active)
              ? v!.mcp_active!.length
              : Number(v?.counts?.mcp_active || 0);
            const ag = Array.isArray(v?.agents_active)
              ? v!.agents_active!.length
              : Number(v?.counts?.agents_active || 0);
            return mcp + ag;
          },
        };
        const pick = <T,>(
          incoming: T | null | undefined,
          was: T | null | undefined,
          sc: (v: T) => number,
          force?: boolean,
        ): T | null | undefined => {
          if (force && incoming != null) return incoming;
          if (incoming == null) return was;
          if (was == null) return incoming;
          try {
            return sc(incoming) >= sc(was) ? incoming : was;
          } catch {
            return incoming;
          }
        };
        return {
          ...json,
          platform_cost: pick(
            json.platform_cost,
            prev.platform_cost,
            score.cost,
            forceOps,
          ) as DashboardData["platform_cost"],
          agent_runs: pick(
            json.agent_runs,
            prev.agent_runs,
            score.runs,
            forceOps,
          ) as DashboardData["agent_runs"],
          growth_scout: pick(
            json.growth_scout,
            prev.growth_scout,
            score.scout,
            forceOps,
          ) as DashboardData["growth_scout"],
          listing_lanes: pick(
            json.listing_lanes,
            prev.listing_lanes,
            score.lanes,
          ) as DashboardData["listing_lanes"],
          mcp: (() => {
            const a = json.mcp;
            const b = prev.mcp;
            if (!a) return b;
            if (!b) return a;
            return Number(a.total || 0) >= Number(b.total || 0) ? a : b;
          })(),
          agents: (() => {
            const a = json.agents;
            const b = prev.agents;
            if (!a) return b;
            if (!b) return a;
            return Number(a.total || 0) >= Number(b.total || 0) ? a : b;
          })(),
          product_engagement:
            json.product_engagement ?? prev.product_engagement,
          hero: (() => {
            const a = json.hero;
            const b = prev.hero;
            if (!a) return b;
            if (!b) return a;
            const n = (x: unknown) => {
              const v = Number(x);
              return Number.isFinite(v) ? v : 0;
            };
            const maxN = (x: unknown, y: unknown) => Math.max(n(x), n(y));
            const live_mcp = maxN(a.live_mcp, b.live_mcp);
            const live_agents = maxN(a.live_agents, b.live_agents);
            const feedback_agents = maxN(a.feedback_agents, b.feedback_agents);
            const feedback_mcps = maxN(a.feedback_mcps, b.feedback_mcps);
            const feedback_real = Math.max(
              maxN(a.feedback_real, b.feedback_real),
              feedback_agents + feedback_mcps,
            );
            const unlock_agents_target =
              maxN(
                a.unlock_agents_target ?? a.unlock_agents,
                b.unlock_agents_target ?? b.unlock_agents,
              ) || 10;
            const unlock_mcps_target =
              maxN(
                a.unlock_mcps_target ?? a.unlock_mcps,
                b.unlock_mcps_target ?? b.unlock_mcps,
              ) || 5;
            return {
              ...b,
              ...a,
              live: live_mcp + live_agents || maxN(a.live, b.live),
              live_mcp,
              live_agents,
              probes_today: maxN(a.probes_today, b.probes_today),
              probes_agents: maxN(a.probes_agents, b.probes_agents),
              probes_mcps: maxN(a.probes_mcps, b.probes_mcps),
              agent_events_today: maxN(
                a.agent_events_today,
                b.agent_events_today,
              ),
              agent_events_free: maxN(a.agent_events_free, b.agent_events_free),
              agent_events_paid: maxN(a.agent_events_paid, b.agent_events_paid),
              feedback_real,
              feedback_agents,
              feedback_mcps,
              unlock_agents: unlock_agents_target,
              unlock_mcps: unlock_mcps_target,
              unlock_agents_target,
              unlock_mcps_target,
              unlock_agents_progress: feedback_agents,
              unlock_mcps_progress: feedback_mcps,
              outcomes: maxN(a.outcomes, b.outcomes),
              feedback_source:
                a.feedback_source === "funnel_honesty" ||
                b.feedback_source === "funnel_honesty" ||
                feedback_real > 0
                  ? "funnel_honesty"
                  : a.feedback_source || b.feedback_source,
            };
          })(),
        };
      });
      setRefreshedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
      if (opts?.ops) setOpsLoading(false);
    }
  }, []);


  useEffect(() => {
    void load(true);
    // Soft poll every 3m — enough for ops visibility without burning Fluid Active CPU
    const id = setInterval(() => void load(true), 180_000);
    return () => clearInterval(id);
  }, [load]);

  return {
    data,
    refreshedAt,
    refreshing,
    opsLoading,
    error,
    refresh: () => load(false),
    loadOps: () => load(true, { ops: true }),
  };
}

export function DashboardApp() {
  const {
    data,
    refreshedAt,
    refreshing,
    opsLoading,
    error,
    refresh,
    loadOps,
  } = useLiveData();
  const [tab, setTab] = useState<TabId>("mcp");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPlatform, setShowPlatform] = useState(false);

  const lanes = data?.listing_lanes;
  const pe = data?.product_engagement;
  const heroEarly = data?.hero;
  const fbAgents =
    heroEarly?.feedback_agents ?? pe?.feedback_agent_only ?? 0;
  const fbMcps = heroEarly?.feedback_mcps ?? pe?.feedback_mcps ?? 0;
  const unlockAgents = heroEarly?.unlock_agents_target ?? 10;
  const unlockMcps = heroEarly?.unlock_mcps_target ?? 5;

  const liveMcp =
    heroEarly?.live_mcp ?? lanes?.counts?.mcp_active ?? null;
  const liveAgents =
    heroEarly?.live_agents ?? lanes?.counts?.agents_active ?? null;
  const liveTotal =
    liveMcp != null && liveAgents != null
      ? liveMcp + liveAgents
      : heroEarly?.live ?? null;

  const platformCost = data?.platform_cost;
  const agentRuns = data?.agent_runs;
  const growthScout = data?.growth_scout;
  const costToday = platformCost?.running_total?.today_usd;
  const costMonth = platformCost?.running_total?.month_usd_after_pro_credit
    ?? platformCost?.month?.usd_after_credit;
  const costInv = platformCost?.today?.invocations;
  const costCpuMs = platformCost?.today?.active_cpu_ms;
  const agentRunN = agentRuns?.totals?.n;
  const agentRunOk = agentRuns?.totals?.ok;

  const hero = data?.hero;
  const probesToday =
    hero?.probes_today ??
    (data?.protocol as { probes?: { used?: number } } | null | undefined)?.probes
      ?.used ??
    null;
  const probesAgents = hero?.probes_agents;
  const probesMcps = hero?.probes_mcps;
  const agentEventsToday = hero?.agent_events_today ?? null;
  const agentEventsFree = hero?.agent_events_free;
  const agentEventsPaid = hero?.agent_events_paid;
  const feedbackReal =
    hero?.feedback_real ??
    (fbAgents != null && fbMcps != null ? fbAgents + fbMcps : null);
  const feedbackAgentsH = hero?.feedback_agents ?? fbAgents;
  const feedbackMcpsH = hero?.feedback_mcps ?? fbMcps;
  const outcomesN = hero?.outcomes ?? null;
  const networkO = hero?.network_o;

  // Search only — category scope applied inside CategoryGroupedListings
  const mcpActiveRows = useMemo(
    () =>
      filterRows((lanes?.mcp_active || []).map(toListingRow), query, null),
    [lanes, query],
  );
  const agentActiveRows = useMemo(
    () =>
      filterRows(
        (lanes?.agents_active || []).map(toListingRow),
        query,
        null,
      ),
    [lanes, query],
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
            <SiteNav active="/" className="mb-3" />
            <h1 className="max-w-2xl text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              Only clean agents & MCPs. Nothing else.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Probe-first registry: Live listings only. Five numbers that
              matter — Live size, probes, agent events, real feedback, outcomes.
              Browse Agents & MCPs; agents use one-call tools on /for-agents.
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
            <Button size="sm" variant="accent" asChild className="w-full sm:w-auto">
              <a href="/collab">
                <Workflow className="h-3.5 w-3.5" />
                Collab Studio
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild className="w-full sm:w-auto">
              <a href="/list">List yourself</a>
            </Button>
            <Button size="sm" variant="accent" asChild className="w-full sm:w-auto">
              <a href="/try">Try (2 min)</a>
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

                <div className="mb-4 grid min-w-0 grid-cols-2 gap-2 sm:mb-5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
          <StatCard
            label="Live"
            value={liveTotal != null ? liveTotal : "—"}
            hint={
              liveMcp != null && liveAgents != null
                ? `${liveMcp} MCP · ${liveAgents} agents`
                : "clean Active only"
            }
            icon={CheckCircle2}
            accent="success"
          />
          <StatCard
            label="Probes today"
            value={probesToday != null ? probesToday : "—"}
            hint={
              probesAgents != null || probesMcps != null
                ? `${probesAgents ?? "—"} agents · ${probesMcps ?? "—"} MCP`
                : "live handshakes"
            }
            icon={Radio}
            accent="info"
          />
          <StatCard
            label="Agent events"
            value={agentEventsToday != null ? agentEventsToday : "—"}
            hint={
              agentEventsFree != null
                ? `${agentEventsFree} free · ${agentEventsPaid ?? 0} paid · UTC day`
                : "one-call value tools"
            }
            icon={Zap}
            accent="accent"
          />
          <StatCard
            label="Real feedback"
            value={feedbackReal != null ? feedbackReal : "—"}
            hint={`${feedbackAgentsH ?? 0}/${hero?.unlock_agents_target ?? unlockAgents} agents · ${feedbackMcpsH ?? 0}/${hero?.unlock_mcps_target ?? unlockMcps} MCP unlock`}
            icon={MessageSquare}
            accent="warn"
          />
          <StatCard
            label="Outcomes"
            value={outcomesN != null ? outcomesN : "—"}
            hint={
              networkO != null
                ? `O=${Number(networkO).toFixed(1)} · deposit_outcome`
                : "deposit_outcome ledger"
            }
            icon={Activity}
            accent="success"
          />
        </div>

        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              setShowPlatform((v) => {
                const next = !v;
                if (next) {
                  // Always fetch ops on open so cold isolates fill the panel
                  void loadOps();
                }
                return next;
              });
            }}
            className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border/60 bg-bg-elevated/30 px-3 py-2 text-left text-xs text-muted transition hover:border-border hover:text-fg"
          >
            <span className="flex items-center gap-2 font-medium">
              {showPlatform ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Platform ops
            </span>
            <span className="tabular text-subtle">
              {opsLoading
                ? "loading…"
                : costToday != null
                  ? `$${Number(costToday) < 0.01 ? Number(costToday).toFixed(4) : Number(costToday).toFixed(2)} today`
                  : "cost · runs · scout"}
              {!opsLoading && agentRunN != null ? ` · ${agentRunN} runs` : ""}
              {!opsLoading && growthScout?.day_invites != null
                ? ` · ${growthScout.day_invites} scout`
                : ""}
            </span>
          </button>
          {showPlatform ? (
            <div className="mt-2 space-y-3">
              {opsLoading && !platformCost && !growthScout ? (
                <Card className="border-border/70">
                  <CardContent className="py-6 text-center text-sm text-muted">
                    Loading platform cost, agent runs, and growth scout…
                  </CardContent>
                </Card>
              ) : null}
              {!opsLoading && !platformCost && !growthScout ? (
                <Card className="border-border/70">
                  <CardContent className="space-y-3 py-5 text-center text-sm text-muted">
                    <p>Ops panels unavailable on this load.</p>
                    <Button size="sm" variant="secondary" onClick={() => void loadOps()}>
                      Retry
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
              {platformCost ? (
                <Card className="border-border/70">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4 text-warn" />
                      Vercel Pro · Fluid cost
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Operator view — not product metrics. Rates{" "}
                      {platformCost.rates_version || "pro-fluid"}.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 pb-4 pt-0 sm:grid-cols-4">
                    <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Today USD
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular text-fg">
                        $
                        {Number(costToday ?? 0) < 0.01
                          ? Number(costToday ?? 0).toFixed(6)
                          : Number(costToday ?? 0).toFixed(4)}
                      </p>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Month after credit
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular text-fg">
                        $
                        {Number(costMonth ?? 0) < 0.01
                          ? Number(costMonth ?? 0).toFixed(6)
                          : Number(costMonth ?? 0).toFixed(4)}
                      </p>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Cadence skips
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular text-fg">
                        {platformCost.today?.skipped_cadence ??
                          platformCost.savings?.cadence_skips_today ??
                          0}
                      </p>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Agent runs
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular text-fg">
                        {agentRunN ?? "—"}
                        {agentRunOk != null ? (
                          <span className="text-sm font-normal text-subtle">
                            {" "}
                            · {agentRunOk} ok
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-4">
                      <Button size="sm" variant="secondary" asChild>
                        <a
                          href="/api/ops/vercel-cost"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Cost API
                        </a>
                      </Button>
                      <Button size="sm" variant="secondary" asChild>
                        <a
                          href="/api/ops/agent-runs"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Runs API
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {growthScout ? (
                <Card className="border-border/70">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Sparkles className="h-4 w-4 text-accent" />
                      Growth Scout · $
                      {Number(growthScout.month_budget_usd ?? 25).toFixed(0)}
                      /mo
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Operator funnel. Last:{" "}
                      <span className="text-fg">
                        {growthScout.last_status || "—"}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 pb-4 pt-0 sm:grid-cols-4">
                    <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Month used
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular text-fg">
                        ${Number(growthScout.month_usd ?? 0).toFixed(4)}
                      </p>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Remaining
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular text-fg">
                        $
                        {Number(growthScout.budget_remaining_usd ?? 0).toFixed(
                          2,
                        )}
                      </p>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Invites today
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular text-fg">
                        {growthScout.day_invites ?? 0}
                        <span className="text-sm font-normal text-subtle">
                          /{growthScout.max_invites_per_day ?? 20}
                        </span>
                      </p>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/50 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Unique invited
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular text-fg">
                        {growthScout.invited_unique ?? 0}
                      </p>
                    </div>
                    <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-4">
                      <Button size="sm" variant="secondary" asChild>
                        <a href="/grow">Founder playbook</a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}
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
              const cats = (
                tab === "mcp"
                  ? lanes?.categories?.mcp || []
                  : lanes?.categories?.agents || []
              )
                .filter((c) => c.live !== false && (c.count || 0) > 0)
                .slice()
                .sort((a, b) => (b.count || 0) - (a.count || 0));
              return (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-subtle">
                    Choose at top · default{" "}
                    <span className="font-medium text-fg">All</span> (top 5
                    collapsed). Pick a category to show only that list.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCategoryFilter(null)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        !categoryFilter
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-border text-muted hover:text-fg",
                      )}
                    >
                      All
                      <span className="ml-1 tabular text-subtle">
                        {tab === "mcp"
                          ? liveMcp ?? mcpActiveRows.length
                          : liveAgents ?? agentActiveRows.length}
                      </span>
                    </button>
                    {cats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCategoryFilter(c.id)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                          categoryFilter === c.id
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-border text-muted hover:text-fg",
                        )}
                      >
                        {c.label}
                        <span className="ml-1 tabular text-subtle">
                          {c.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="space-y-2">
              <p className="text-[11px] text-subtle">
                One list at a time · top 5 collapsed · expand 25/page. JSON:{" "}
                <a
                  href="/api/listings/active"
                  className="text-accent underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  /api/listings/active
                </a>
              </p>
              <CategoryGroupedListings
                rows={tab === "mcp" ? mcpActiveRows : agentActiveRows}
                showDemoCta
                filterCategoryId={categoryFilter}
                categoryLabel={
                  categoryFilter
                    ? (
                        (tab === "mcp"
                          ? lanes?.categories?.mcp
                          : lanes?.categories?.agents) || []
                      ).find((c) => c.id === categoryFilter)?.label
                    : null
                }
                emptyLabel={
                  tab === "mcp" ? "No clean MCPs yet" : "No clean agents yet"
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
