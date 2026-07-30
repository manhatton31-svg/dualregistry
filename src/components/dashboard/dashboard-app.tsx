/**
 * Dual Registry dashboard — clean targets first, real numbers only.
 * Never show store dump, discovered queue, delisted wall, or probe-budget theatre.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Copy,
  Cpu,
  Radio,
  Search,
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
  { id: "clean", label: "Clean targets" },
  { id: "mcp", label: "MCPs" },
  { id: "agents", label: "Agents" },
  { id: "ops", label: "Ops" },
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
  const [tab, setTab] = useState<TabId>("clean");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const lanes = data?.listing_lanes;
  const pe = data?.product_engagement;
  const proto = data?.protocol;

  const fbAgents = pe?.feedback_agent_only ?? 0;
  const fbMcps = pe?.feedback_mcps ?? 0;
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

  const allCleanRows = useMemo(
    () => [...agentActiveRows, ...mcpActiveRows],
    [agentActiveRows, mcpActiveRows],
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
      product: "dualregistry-clean-targets",
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

  const weekly = proto?.probes?.weekly_recheck;

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
              if handshake is ok. Stay Active via Talk presence (heartbeat).
              Growing toward 333 clean listings per day
              (mixed agents + MCPs). Failures are discarded.
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
                ? `${liveMcp} MCP · ${liveAgents} agents · checks clean + probe ok`
                : "loading"
            }
            icon={CheckCircle2}
            accent="success"
          />
          <StatCard
            label="Rule"
            value="probe + talk"
            hint="Handshake ok + Talk presence (or 7d grace) · grow toward 333 clean/day"
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
              }}
              className={cn(
                "min-h-10 flex-1 rounded-[var(--radius-sm)] px-3 text-sm font-medium transition sm:min-h-9",
                tab === t.id
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-fg",
              )}
            >
              {t.label}
              {t.id === "clean" && liveTotal != null ? (
                <span className="ml-1 tabular text-subtle">{liveTotal}</span>
              ) : null}
            </button>
          ))}
        </nav>

        {tab === "clean" ? (
          <div className="space-y-4">
            <Card className="border-success/30">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      Clean targets — use these
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {liveTotal ?? 0} listings with checks clean + handshake ok
                      at source URL. JSON at{" "}
                      <a
                        href="/api/listings/active"
                        className="text-accent underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        /api/listings/active
                      </a>
                      .
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => void copyCleanJson()}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? "Copied" : "Copy all JSON"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pb-4 pt-0">
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle">
                    Agents ({agentActiveRows.length})
                  </p>
                  <ListingTable
                    rows={agentActiveRows}
                    showDemoCta
                    emptyLabel="No clean agents yet — we only list after probe ok at source URL"
                  />
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle">
                    MCPs ({mcpActiveRows.length})
                  </p>
                  <ListingTable
                    rows={mcpActiveRows}
                    showDemoCta
                    emptyLabel="No clean MCPs yet — we only list after probe ok at source URL"
                  />
                </div>
                {allCleanRows.length === 0 ? (
                  <p className="text-sm text-muted">
                    Empty registry — nothing has passed a live probe yet.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">How this registry works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-[11px] text-muted pb-3 pt-0">
                <p>
                  <span className="font-medium text-fg">1. Find</span> a real
                  agent card or MCP endpoint on the internet.
                </p>
                <p>
                  <span className="font-medium text-fg">2. Probe</span> that URL
                  first (never list before probe).
                </p>
                <p>
                  <span className="font-medium text-fg">3. List</span> only if
                  handshake is ok — then it appears here with the target URL.
                </p>
                <p>
                  Growing mixed agents + MCPs toward 333 clean listings per day.
                  Failures stay off the registry.
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
                    Categories unlock when Active.
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
                  Active · clean + probe ok
                </CardTitle>
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

        {tab === "ops" ? (
          <div className="space-y-4">
            <StatCard
              label="Clean listed"
              value={liveTotal ?? "—"}
              hint={
                liveMcp != null && liveAgents != null
                  ? `${liveMcp} MCP · ${liveAgents} agents · only probe-ok`
                  : "only probe-ok targets"
              }
              icon={CheckCircle2}
              accent="success"
            />
            {weekly ? (
              <p className="text-[11px] text-subtle">
                Weekly recheck: active_ok {weekly.active_ok ?? "—"} · due now{" "}
                {weekly.due_now ?? "—"} · this week{" "}
                {weekly.rechecked_this_week ?? "—"}
              </p>
            ) : null}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Product engagement</CardTitle>
              </CardHeader>
              <CardContent className="pb-3 pt-0 text-sm">
                <p className="text-muted text-xs mb-2">
                  Unlock payments at 250 agent + 250 MCP feedback. Founding free
                  after demo+feedback for first 100 clean listings.
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-[10px] uppercase text-subtle">
                      Agent feedback
                    </p>
                    <p className="tabular font-semibold">
                      {fbAgents}/{unlockAgents}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-subtle">
                      MCP feedback
                    </p>
                    <p className="tabular font-semibold">
                      {fbMcps}/{unlockMcps}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-subtle">Unlock</p>
                    <p className="tabular font-semibold">
                      {Math.round(unlockPct)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-subtle">Discounts</p>
                    <p className="tabular font-semibold">
                      {pe?.discounts_issued ?? 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
