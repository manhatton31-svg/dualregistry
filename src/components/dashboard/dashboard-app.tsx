/**
 * Agents1 registry dashboard — real metrics only on engagement.
 * Invited demos are agent-facing outreach (hidden from public cards).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Cpu,
  Layers,
  Radio,
  Rocket,
  Search,
  Server,
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
import { ListingTable, type ListingRow } from "./listing-table";

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
  probe?: { ok?: boolean; handshake?: string; score?: number } | null;
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
    mcp_discovered?: ListingRowRaw[];
    agents_active?: ListingRowRaw[];
    agents_discovered?: ListingRowRaw[];
    mcp_needs_resubmit?: ListingRowRaw[];
    agents_needs_resubmit?: ListingRowRaw[];
    counts?: {
      mcp_active: number;
      mcp_discovered: number;
      agents_active: number;
      agents_discovered: number;
      mcp_needs_resubmit?: number;
      agents_needs_resubmit?: number;
      public_listed?: number;
    };
    policy?: {
      fail_policy?: string;
      note?: string;
    };
    categories?: {
      mcp?: Array<{ id: string; label: string; count: number; live?: boolean }>;
      agents?: Array<{
        id: string;
        label: string;
        count: number;
        live?: boolean;
      }>;
    };
  } | null;
  protocol?: {
    mirror?: { total_seen?: number; pages_fetched?: number };
    probes?: {
      used?: number;
      budget?: number;
      remaining?: number;
      hourly_remaining?: number;
      hourly_cap?: number;
      last_tick_at?: string;
      next_tick_at?: string | null;
      by_kind_today?: { agents?: number; mcps?: number };
      probe_worker?: {
        status?: string;
        last_tick_at?: string;
        next_tick_at?: string;
        last_probed?: number;
        ticks?: number;
      } | null;
      weekly_recheck?: {
        due_now?: number;
        active_ok?: number;
        rechecked_this_week?: number;
        demoted_this_week?: number;
        next_due_at?: string | null;
        unlimited?: boolean;
      };
      recent?: Array<{
        id?: string;
        kind?: string;
        handshake?: string;
        ok?: boolean;
        probed_at?: string;
        name?: string;
        target?: string;
        signals?: string[];
      }>;
      outcomes?: {
        unique_primaries?: number;
        handshake?: Record<string, number>;
        fail_by_kind?: Record<string, number>;
        fail_reasons?: Array<{ reason: string; count: number }>;
        fail_samples?: Array<{
          id: string;
          kind?: string;
          target?: string;
          reason: string;
          probed_at?: string;
        }>;
        note?: string;
      };
    };
  } | null;
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "mcp", label: "MCPs" },
  { id: "agents", label: "Agents" },
  { id: "ops", label: "Ops" },
] as const;

type TabId = (typeof TABS)[number]["id"];

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
  categoryId?: string | null,
): ListingRow[] {
  const n = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (categoryId && r.category_id !== categoryId) return false;
    if (!n) return true;
    return (
      r.name.toLowerCase().includes(n) ||
      (r.description || "").toLowerCase().includes(n) ||
      (r.author || "").toLowerCase().includes(n) ||
      (r.category_label || "").toLowerCase().includes(n)
    );
  });
}

function formatRelative(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const ms = Date.now() - t;
  // Past only (for refreshedAt etc.)
  if (ms < 0) return "just now";
  if (ms < 45_000) return "just now";
  if (ms < 3600_000) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  return `${Math.floor(ms / 3600_000)}h ago`;
}

/** Past → "2m ago"; future → "in 4m". last + 6m must equal cadence (not wall clock). */
function formatProbeWhen(iso: string | null | undefined, role: "past" | "future" = "past") {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const delta = t - Date.now(); // positive = future
  if (role === "future" || delta > 0) {
    if (delta <= 20_000) return "any moment";
    if (delta < 3600_000) {
      // floor so "2m ago + in 4m" = 6m cadence (never round up leftover seconds)
      const m = Math.max(1, Math.floor(delta / 60_000));
      return `in ${m}m`;
    }
    return `in ${Math.floor(delta / 3600_000)}h`;
  }
  const ago = -delta;
  if (ago < 45_000) return "just now";
  if (ago < 3600_000) return `${Math.max(1, Math.floor(ago / 60_000))}m ago`;
  return `${Math.floor(ago / 3600_000)}h ago`;
}

/** Next tick = last + 6m (production + preview contract). */
function nextProbeSlotIso(fromMs = Date.now()): string {
  const slot = 6 * 60 * 1000;
  const next = Math.ceil(fromMs / slot) * slot + 500;
  if (next - fromMs < 2000) {
    return new Date(next + slot).toISOString();
  }
  return new Date(next).toISOString();
}

function resolveNextTickAt(protoNext?: string | null, lastTick?: string | null): string {
  const now = Date.now();
  const SLOT = 6 * 60 * 1000;
  // Authoritative: last_tick + 6 minutes
  if (lastTick) {
    const last = Date.parse(lastTick);
    if (Number.isFinite(last)) {
      let next = last + SLOT;
      while (next < now + 2_000) next += SLOT;
      return new Date(next).toISOString();
    }
  }
  if (protoNext) {
    const t = Date.parse(protoNext);
    if (Number.isFinite(t) && t > now + 2_000) return protoNext;
  }
  return nextProbeSlotIso(now);
}

function StatCard(props: {
  label: string;
  value: string | number;
  hint?: string;
  icon: typeof Server;
  accent?: "accent" | "info" | "success" | "warn";
}) {
  const Icon = props.icon;
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-start gap-3 p-3 sm:p-4">
        <div className="rounded-[var(--radius-sm)] bg-accent/10 p-2 text-accent">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-subtle">
            {props.label}
          </p>
          <p className="tabular text-xl font-semibold leading-tight text-fg">
            {props.value}
          </p>
          {props.hint ? (
            <p className="mt-0.5 text-[11px] text-muted">{props.hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function useLiveData() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (soft = false) => {
    if (!soft) setRefreshing(true);
    try {
      // soft poll = cache path; Update button = refresh=1 (verified recompute)
      const url = soft
        ? "/api/dashboard"
        : "/api/dashboard?refresh=1";
      const r = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!r.ok) {
        // Soft poll must never blank the UI or flash errors under load
        if (soft) return;
        throw new Error(`dashboard ${r.status}`);
      }
      const j = (await r.json()) as DashboardData;
      if (!j || (j as { ok?: boolean }).ok === false) {
        if (soft) return;
        throw new Error((j as { message?: string })?.message || "bad payload");
      }
      setData((prev) => {
        if (soft && prev && !(j as { mcp?: unknown }).mcp) {
          return {
            ...prev,
            ...j,
            protocol: j.protocol || prev.protocol,
            product_engagement:
              j.product_engagement || prev.product_engagement,
            listing_lanes: j.listing_lanes || prev.listing_lanes,
          };
        }
        return j;
      });
      setRefreshedAt(new Date().toISOString());
      if (!soft) setError(null);
    } catch (e) {
      if (!soft) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!soft) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Soft poll every 15s; hard refresh every 6 min so probe used/Live match worker
    const soft = setInterval(() => void load(true), 15_000);
    const hard = setInterval(() => void load(false), 6 * 60 * 1000);
    return () => {
      clearInterval(soft);
      clearInterval(hard);
    };
  }, [load]);

  return { data, refreshedAt, refreshing, error, refresh: () => load(false) };
}

export function DashboardApp() {
  const { data, refreshedAt, refreshing, error, refresh } = useLiveData();
  const [tab, setTab] = useState<TabId>("overview");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // Re-render every 30s so "last Xm ago / next in Ym" stays honest without full fetch
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const pe = data?.product_engagement;
  const lanes = data?.listing_lanes;
  const proto = data?.protocol;
  const mcpTotal = data?.mcp?.total ?? 0;
  const agentTotal = data?.agents?.total ?? 0;
  const demoAgents = pe?.demo_agent_only ?? 0;
  const demoMcps = pe?.demo_mcps ?? 0;
  const fbAgents = pe?.feedback_agent_only ?? 0;
  const fbMcps = pe?.feedback_mcps ?? 0;
  const unlockAgents = 250;
  const unlockMcps = 250;
  const unlockPct =
    ((fbAgents / unlockAgents) * 50 + (fbMcps / unlockMcps) * 50) || 0;

  const probeUsed = proto?.probes?.used;
  const probeBudget = proto?.probes?.budget ?? 240;
  const nextTickIso = resolveNextTickAt(
    proto?.probes?.next_tick_at || proto?.probes?.probe_worker?.next_tick_at,
    proto?.probes?.last_tick_at,
  );
  const lastTickLabel = formatProbeWhen(proto?.probes?.last_tick_at, "past");
  const nextTickLabel = formatProbeWhen(nextTickIso, "future");

  const mcpActiveRows = useMemo(
    () =>
      filterRows(
        (lanes?.mcp_active || []).map(toListingRow),
        query,
        categoryFilter,
      ),
    [lanes, query, categoryFilter],
  );
  const mcpDiscoveredRows = useMemo(
    () =>
      filterRows(
        (lanes?.mcp_discovered || []).map(toListingRow),
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
  const agentDiscoveredRows = useMemo(
    () =>
      filterRows(
        (lanes?.agents_discovered || []).map(toListingRow),
        query,
        categoryFilter,
      ),
    [lanes, query, categoryFilter],
  );

  const probeRemaining = proto?.probes?.remaining;
  const probeHourLeft = proto?.probes?.hourly_remaining;
  const probeHourCap = proto?.probes?.hourly_cap;
  const weekly = proto?.probes?.weekly_recheck;
  const mirrorTotal = proto?.mirror?.total_seen;

  return (
    <div className="mesh-bg min-h-dvh">
      <div className="page-shell py-6 sm:py-8">
        <header className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Badge variant="accent" className="mb-2">
              Live registry
            </Badge>
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              Agents1
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted">
              MCP & agent registry · real demos & real feedback only on this
              dashboard. Free demos are offered to listings when probes pass.
            </p>
            {error ? (
              <p className="mt-1 text-xs text-danger">{error}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button size="sm" variant="accent" asChild className="w-full sm:w-auto">
              <a href="/for-agents">Agent / MCP path</a>
            </Button>
            <Button size="sm" variant="secondary" asChild className="w-full sm:w-auto">
              <a href="/list">List</a>
            </Button>
            <Button size="sm" variant="secondary" asChild className="w-full sm:w-auto">
              <a href="/products">
                <Cpu className="h-3.5 w-3.5" />
                Products
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild className="w-full sm:w-auto">
              <a href="/products/improvement-log">Logs</a>
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

        <div className="mb-4 grid min-w-0 grid-cols-2 gap-2 sm:mb-5 sm:grid-cols-4 sm:gap-3">
          <StatCard
            label="In registry"
            value={data ? mcpTotal + agentTotal : "—"}
            hint={
              data ? `${mcpTotal} MCP · ${agentTotal} agents (store)` : "store"
            }
            icon={Server}
            accent="accent"
          />
          <StatCard
            label="Live (probe ok)"
            value={
              lanes?.counts
                ? lanes.counts.mcp_active + lanes.counts.agents_active
                : "—"
            }
            hint={
              lanes?.counts
                ? `${lanes.counts.mcp_active} MCP · ${lanes.counts.agents_active} agents`
                : "awaiting probes"
            }
            icon={CheckCircle2}
            accent="success"
          />
          <StatCard
            label="Probes today"
            value={
              probeUsed != null && probeBudget != null
                ? `${probeUsed}/${probeBudget}`
                : "—"
            }
            hint={
              proto?.probes?.last_tick_at
                ? `last ${lastTickLabel} · next ${nextTickLabel} · ${proto.probes.by_kind_today?.agents ?? "—"}a/${proto.probes.by_kind_today?.mcps ?? "—"}m`
                : "worker every 6 min"
            }
            icon={Activity}
            accent="warn"
          />
          <StatCard
            label="Feedback to unlock"
            value={`${fbAgents + fbMcps}/500`}
            hint={`${fbAgents}/250 agents · ${fbMcps}/250 MCPs · real only`}
            icon={Rocket}
            accent="info"
          />
        </div>

        {/* Probe pulse — always visible so 6-min worker activity is undeniable */}
        <div className="mb-4 rounded-[var(--radius-md)] border border-border/80 bg-card px-3 py-2.5 text-xs sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium text-fg">
              <Radio className="h-3.5 w-3.5 text-accent" />
              Probe worker
              <Badge
                variant={
                  proto?.probes?.probe_worker?.status === "running"
                    ? "success"
                    : "warn"
                }
                className="text-[10px]"
              >
                {proto?.probes?.probe_worker?.status || "unknown"}
              </Badge>
            </div>
            <a
              href="/api/probes"
              className="text-[11px] text-accent underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              /api/probes health
            </a>
          </div>
          <p className="mt-1.5 tabular text-muted">
            <span className="text-fg font-medium">
              {probeUsed ?? "—"}/{probeBudget ?? 240}
            </span>{" "}
            today · last {lastTickLabel} · next {nextTickLabel} · kinds{" "}
            {proto?.probes?.by_kind_today?.agents ?? "—"}a /{" "}
            {proto?.probes?.by_kind_today?.mcps ?? "—"}m
          </p>
          {proto?.probes?.recent?.[0] ? (
            <p className="mt-1 truncate text-[11px] text-subtle">
              Last:{" "}
              <span className="text-muted">
                {proto.probes.recent[0].kind} ·{" "}
                {proto.probes.recent[0].handshake || "—"}
                {proto.probes.recent[0].ok ? " ✓" : " ✗"} ·{" "}
                {(proto.probes.recent[0] as { target?: string }).target ||
                  proto.probes.recent[0].id ||
                  ""}
              </span>
            </p>
          ) : null}
          <p className="mt-1 text-[10px] text-subtle">
            Live only grows on handshake ok. Demos/feedback never auto-fill
            (external actors only).
          </p>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant="accent" asChild>
            <a href="/for-agents">Agent / MCP path →</a>
          </Button>
          <Button size="sm" variant="secondary" asChild>
            <a href="/list">List yourself</a>
          </Button>
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-subtle">
          <span className="font-medium text-muted">For creators:</span> Live =
          checks clean + probe ok. On probe-ok we offer a free demo privately.
          Demos include invites + self-serve; unlock needs real surveys. Mirror /
          probes under{" "}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => setTab("ops")}
          >
            Ops
          </button>
          .
        </p>

        {pe ? (
          <Card className="mb-4 border-border/80">
            <CardHeader className="pb-2 pt-3 sm:pb-2 sm:pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium">
                  Product engagement
                </CardTitle>
                <Badge variant="default" className="text-[10px]">
                  unlock {fbAgents}/{unlockAgents} · {fbMcps}/{unlockMcps} MCPs
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Real numbers only — external agents/MCPs. Zero padding. If stuck at 0, improve the funnel — never invent demos/feedback. Unlock at 250 + 250 real surveys.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-3 pt-0">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-subtle">
                    Real agent demos
                  </p>
                  <p className="tabular text-lg font-semibold leading-none text-fg">
                    {demoAgents}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-subtle">
                    Agent feedback
                  </p>
                  <p className="tabular text-lg font-semibold leading-none text-fg">
                    {fbAgents}
                    <span className="ml-1 text-xs font-normal text-muted">
                      /{unlockAgents}
                      {pe.feedback_rate_agents_pct != null
                        ? ` · ${pe.feedback_rate_agents_pct}%`
                        : ""}
                    </span>
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-subtle">
                    Real MCP demos
                  </p>
                  <p className="tabular text-lg font-semibold leading-none text-fg">
                    {demoMcps}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-subtle">
                    MCP feedback
                  </p>
                  <p className="tabular text-lg font-semibold leading-none text-fg">
                    {fbMcps}
                    <span className="ml-1 text-xs font-normal text-muted">
                      /{unlockMcps}
                      {pe.feedback_rate_mcps_pct != null
                        ? ` · ${pe.feedback_rate_mcps_pct}%`
                        : ""}
                    </span>
                  </p>
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/60">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${Math.min(100, unlockPct)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-subtle">
                Unlock {fbAgents + fbMcps}/500 real feedback · discounts{" "}
                {pe.discounts_issued ?? 0}
                {refreshedAt ? ` · ${formatRelative(refreshedAt)}` : ""}
                {" · "}
                real-only · no fakes · probes every 6 min
              </p>
            </CardContent>
          </Card>
        ) : null}

        <nav className="mb-4 flex gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-border/70 bg-bg-elevated/40 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setCategoryFilter(null);
              }}
              className={cn(
                "min-h-10 flex-1 rounded-[var(--radius-sm)] px-3 text-sm font-medium transition sm:min-h-9",
                tab === t.id
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "overview" ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Main loop (agents & MCPs)</CardTitle>
                <CardDescription className="text-xs">
                  Feeder = registry listings. Loop:{" "}
                  <span className="text-fg">
                    Live probe → take demo → leave feedback → discount coupon →
                    buy full product
                  </span>
                  . Invited seeds do not count until confirm / quick demo.
                  Every Active row publishes listing_id + POST body at{" "}
                  <a href="/api/listings/active" className="text-accent underline">
                    /api/listings/active
                  </a>{" "}
                  and{" "}
                  <a href="/discovery.json" className="text-accent underline">
                    discovery.json
                  </a>
                  .
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-3 pt-0">
                <ol className="grid gap-1.5 text-[11px] text-muted sm:grid-cols-2">
                  <li>
                    <span className="font-medium text-fg">1. Live</span> — checks
                    clean + probe ok (every 6 min)
                  </li>
                  <li>
                    <span className="font-medium text-fg">2. Demo</span> — POST
                    /api/products/demo {"{"} listing_id {"}"}
                  </li>
                  <li>
                    <span className="font-medium text-fg">3. Feedback</span> — POST
                    /api/products/feedback (soft 402 on access/run)
                  </li>
                  <li>
                    <span className="font-medium text-fg">4. Discount</span> — 25%
                    A1FB vaulted once
                  </li>
                  <li className="sm:col-span-2">
                    <span className="font-medium text-fg">5. Buy</span> — checkout
                    with code when payments open (250+250 feedback)
                  </li>
                </ol>
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
                  placeholder="Filter by name…"
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
                    Exclusive categories — live chips unlock when Active.
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
                  Active · probe confirmed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ListingTable
                  rows={tab === "mcp" ? mcpActiveRows : agentActiveRows}
                  showDemoCta
                  emptyLabel={
                    tab === "mcp"
                      ? "No active MCPs yet — probes promote listings here"
                      : "No active agents yet — probes promote listings here"
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Layers className="h-4 w-4 text-accent" />
                  Incoming · awaiting first probe ok
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ListingTable
                  rows={
                    tab === "mcp" ? mcpDiscoveredRows : agentDiscoveredRows
                  }
                  emptyLabel="No pending first-probe listings"
                />
                <p className="mt-2 text-[11px] text-subtle">
                  Probe fails are delisted — not shown here. They must fix their
                  card and resubmit (see Ops).
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "ops" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Mirror catalog"
                value={mirrorTotal ?? "—"}
                hint="external feed"
                icon={Layers}
                accent="success"
              />
              <StatCard
                label="Probes today"
                value={
                  probeUsed != null && probeBudget != null
                    ? `${probeUsed}/${probeBudget}`
                    : "—"
                }
                hint={
                  probeBudget != null
                    ? `${probeRemaining ?? 0} left · ${probeHourLeft ?? "—"}/${probeHourCap ?? 5} this window · tick 6m · weekly recheck unlimited`
                    : "6m discovery · weekly recheck unlimited"
                }
                icon={Radio}
                accent="warn"
              />
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Needs resubmit (probe failed — not listed)
                </CardTitle>
                <CardDescription className="text-xs">
                  Fail = delisted. Creators must fix agent-card / MCP server-card
                  and resubmit via /list.{" "}
                  {lanes?.policy?.fail_policy || ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 pb-3 pt-0 text-[11px]">
                <p className="text-muted">
                  Agents: {lanes?.counts?.agents_needs_resubmit ?? 0} · MCPs:{" "}
                  {lanes?.counts?.mcp_needs_resubmit ?? 0}
                </p>
                <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                  {[
                    ...(lanes?.agents_needs_resubmit || []),
                    ...(lanes?.mcp_needs_resubmit || []),
                  ]
                    .slice(0, 20)
                    .map((r) => (
                      <li
                        key={r.id}
                        className="rounded border border-border/60 px-2 py-1.5"
                      >
                        <span className="font-medium text-fg">
                          {r.kind}: {r.name}
                        </span>
                        <p className="text-subtle">{r.lane_reason}</p>
                        {(r as { resubmit?: { fix?: string } }).resubmit
                          ?.fix ? (
                          <p className="text-warn">
                            Fix:{" "}
                            {
                              (r as { resubmit?: { fix?: string } }).resubmit
                                ?.fix
                            }
                          </p>
                        ) : null}
                      </li>
                    ))}
                  {!((lanes?.counts?.agents_needs_resubmit || 0) +
                    (lanes?.counts?.mcp_needs_resubmit || 0)) ? (
                    <li className="text-subtle">No resubmit queue right now</li>
                  ) : null}
                </ul>
                <a
                  href="/list"
                  className="inline-block text-accent underline"
                >
                  Resubmit form → /list
                </a>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Probe outcomes (why fail)</CardTitle>
                <CardDescription className="text-xs">
                  Unique listings probed. Fail spends budget but never becomes
                  Live. Full dump:{" "}
                  <a href="/api/probes" className="text-accent underline">
                    /api/probes
                  </a>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pb-3 pt-0 text-sm">
                {(() => {
                  const o = proto?.probes?.outcomes;
                  const hs = o?.handshake || {};
                  return (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div>
                          <p className="text-[10px] uppercase text-subtle">Ok</p>
                          <p className="tabular font-semibold text-success">
                            {hs.ok ?? 0}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-subtle">
                            Fail
                          </p>
                          <p className="tabular font-semibold text-warn">
                            {hs.fail ?? 0}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-subtle">
                            Partial
                          </p>
                          <p className="tabular font-semibold">
                            {hs.partial ?? 0}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-subtle">
                            Skip
                          </p>
                          <p className="tabular font-semibold">
                            {hs.skip ?? 0}
                          </p>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted">
                        Fails by kind: {o?.fail_by_kind?.agent ?? 0} agents ·{" "}
                        {o?.fail_by_kind?.mcp ?? 0} MCPs
                      </p>
                      <ul className="space-y-1 text-[11px] text-muted">
                        {(o?.fail_reasons || []).slice(0, 6).map((row) => (
                          <li
                            key={row.reason}
                            className="flex justify-between gap-2"
                          >
                            <span className="min-w-0 truncate">{row.reason}</span>
                            <span className="tabular text-fg">{row.count}</span>
                          </li>
                        ))}
                        {!o?.fail_reasons?.length ? (
                          <li className="text-subtle">No fails recorded yet</li>
                        ) : null}
                      </ul>
                      {(o?.fail_samples || []).length ? (
                        <div className="max-h-40 space-y-1 overflow-y-auto border-t border-border/60 pt-2">
                          {(o?.fail_samples || []).slice(0, 8).map((s) => (
                            <p
                              key={s.id + (s.probed_at || "")}
                              className="truncate text-[10px] text-subtle"
                            >
                              <span className="text-warn">{s.kind}</span> ·{" "}
                              {s.reason} · {s.target || s.id}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Weekly Active recheck</CardTitle>
                <CardDescription className="text-xs">
                  Unlimited — queue size = Actives due (≥7d since last ok). No
                  weekly cap; grows with the registry.
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-3 pt-0">
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-[10px] uppercase text-subtle">Due now</p>
                    <p className="tabular font-semibold">
                      {weekly?.due_now ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-subtle">
                      Active ok
                    </p>
                    <p className="tabular font-semibold">
                      {weekly?.active_ok ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-subtle">
                      Rechecked (week)
                    </p>
                    <p className="tabular font-semibold">
                      {weekly?.rechecked_this_week ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-subtle">
                      Demoted (week)
                    </p>
                    <p className="tabular font-semibold">
                      {weekly?.demoted_this_week ?? 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="mt-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Ops notes</CardTitle>
                <CardDescription className="text-xs">
                  Discovery: 1 probe every 6 min (240/day soft). Weekly Active
                  recheck is unlimited — each Active is re-probed 7 days after last
                  ok, then every week (scales as the registry grows). Discovery
                  always runs first. Fail on recheck → back to Discovered.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
