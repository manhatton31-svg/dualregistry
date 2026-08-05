/**
 * Collab Studio — talk with agents/MCPs, converge 2+ into workflow graphs,
 * run graph / agent / loop engineering, package sellable products.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  GitBranch,
  Layers,
  Loader2,
  MessageSquare,
  Network,
  Package,
  Plus,
  RefreshCw,
  Send,
  Server,
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

type CleanItem = {
  id: string;
  kind: "agent" | "mcp";
  name: string;
  description?: string;
};

type CollabNode = {
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  description?: string;
  role?: string;
  x?: number;
  y?: number;
};

type CollabEdge = {
  id: string;
  from: string;
  to: string;
  kind: string;
  label?: string;
};

type CollabStep = {
  at: string;
  mode: string;
  ok: boolean;
  summary: string;
};

type CollabProduct = {
  product_id: string;
  title: string;
  tagline: string;
  price_cents_hint: number;
  sell_path: string;
  collaborators: Array<{ listing_id: string; name: string; kind: string }>;
};

type CollabWorkflow = {
  id: string;
  name: string;
  goal: string;
  nodes: CollabNode[];
  edges: CollabEdge[];
  status: string;
  steps: CollabStep[];
  product?: CollabProduct;
  updated_at: string;
};

export const Route = createFileRoute("/collab")({
  component: CollabStudioPage,
});

function statusVariant(
  s: string,
): "default" | "accent" | "success" | "warn" | "info" {
  if (s === "packaged") return "success";
  if (s === "converged") return "accent";
  if (s === "running") return "info";
  if (s === "draft") return "default";
  return "warn";
}

function GraphCanvas({
  nodes,
  edges,
}: {
  nodes: CollabNode[];
  edges: CollabEdge[];
}) {
  const W = 560;
  const H = 280;
  const placed = useMemo(() => {
    const n = nodes.length || 1;
    return nodes.map((node, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = Math.min(100, 40 + n * 12);
      const cx = W / 2 + Math.cos(angle) * r;
      const cy = H / 2 + Math.sin(angle) * r * 0.85;
      return { ...node, cx, cy };
    });
  }, [nodes]);

  const byId = useMemo(() => {
    const m = new Map<string, (typeof placed)[0]>();
    for (const p of placed) m.set(p.listing_id, p);
    return m;
  }, [placed]);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elevated">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full min-h-[200px] sm:min-h-[260px]"
        role="img"
        aria-label="Workflow graph"
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-accent-dim)" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const stroke =
            e.kind === "loop"
              ? "var(--color-info)"
              : e.kind === "talk"
                ? "var(--color-warn)"
                : "var(--color-accent-dim)";
          return (
            <g key={e.id}>
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={stroke}
                strokeWidth={1.5}
                strokeOpacity={0.65}
                markerEnd="url(#arrow)"
              />
              {e.label ? (
                <text
                  x={(a.cx + b.cx) / 2}
                  y={(a.cy + b.cy) / 2 - 6}
                  fill="var(--color-muted)"
                  fontSize="9"
                  textAnchor="middle"
                >
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {placed.map((n) => (
          <g key={n.listing_id}>
            <circle
              cx={n.cx}
              cy={n.cy}
              r={28}
              fill={
                n.kind === "agent"
                  ? "color-mix(in srgb, var(--color-info) 18%, var(--color-bg-elevated))"
                  : "color-mix(in srgb, var(--color-accent) 18%, var(--color-bg-elevated))"
              }
              stroke={
                n.kind === "agent"
                  ? "var(--color-info)"
                  : "var(--color-accent)"
              }
              strokeWidth={1.5}
            />
            <text
              x={n.cx}
              y={n.cy - 2}
              fill="var(--color-fg)"
              fontSize="10"
              fontWeight={600}
              textAnchor="middle"
            >
              {(n.name || "?").slice(0, 12)}
            </text>
            <text
              x={n.cx}
              y={n.cy + 11}
              fill="var(--color-muted)"
              fontSize="8"
              textAnchor="middle"
            >
              {n.kind}
              {n.role ? ` · ${n.role}` : ""}
            </text>
          </g>
        ))}
        {nodes.length === 0 ? (
          <text
            x={W / 2}
            y={H / 2}
            fill="var(--color-muted)"
            fontSize="12"
            textAnchor="middle"
          >
            Select 2+ agents or MCPs to build a graph
          </text>
        ) : null}
      </svg>
    </div>
  );
}

function CollabStudioPage() {
  const [items, setItems] = useState<CleanItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [goal, setGoal] = useState(
    "Co-design a sellable workflow product agents can run together",
  );
  const [workflow, setWorkflow] = useState<CollabWorkflow | null>(null);
  const [history, setHistory] = useState<
    Array<{ id: string; name: string; status: string; node_n: number }>
  >([]);
  const [talkDraft, setTalkDraft] = useState("");
  const [talkLog, setTalkLog] = useState<
    Array<{ role: string; content: string; name?: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [sessions, setSessions] = useState<
    Array<{
      id: string;
      goal: string;
      status: string;
      pending_steps?: number;
      participants?: Array<{ name: string; status: string }>;
    }>
  >([]);
  const [market, setMarket] = useState<
    Array<{
      product_id: string;
      title: string;
      price_cents: number;
      sold_n: number;
      install_n: number;
      collaborators: Array<{ name: string; share_bps: number }>;
      sell_path: string;
    }>
  >([]);

  const loadRoster = useCallback(async () => {
    try {
      const res = await fetch("/api/listings/active?limit=100", {
        cache: "no-store",
      });
      const j = await res.json();
      const agents = (j.agents || []).map(
        (a: Record<string, unknown>) =>
          ({
            id: String(a.listing_id || a.id),
            kind: "agent" as const,
            name: String(a.name || "agent"),
            description: typeof a.description === "string" ? a.description : "",
          }) satisfies CleanItem,
      );
      const mcps = (j.mcps || []).map(
        (m: Record<string, unknown>) =>
          ({
            id: String(m.listing_id || m.id),
            kind: "mcp" as const,
            name: String(m.name || "mcp"),
            description: typeof m.description === "string" ? m.description : "",
          }) satisfies CleanItem,
      );
      setItems([...agents, ...mcps]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/products/collab", { cache: "no-store" });
      const j = await res.json();
      setHistory(j.workflows || []);
    } catch {
      /* soft */
    }
    try {
      const sres = await fetch("/api/products/collab-session", { cache: "no-store" });
      const sj = await sres.json();
      setSessions(sj.open_board || sj.sessions || []);
    } catch {
      /* soft */
    }
    try {
      const mres = await fetch("/api/products/collab-market", { cache: "no-store" });
      const mj = await mres.json();
      setMarket(mj.listings || []);
    } catch {
      /* soft */
    }
  }, []);

  useEffect(() => {
    void loadRoster();
    void loadHistory();
  }, [loadRoster, loadHistory]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.kind.includes(q) ||
        (i.description || "").toLowerCase().includes(q),
    );
  }, [items, filter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedNodes: CollabNode[] = useMemo(() => {
    return items
      .filter((i) => selected.has(i.id))
      .map((i, idx) => ({
        listing_id: i.id,
        kind: i.kind,
        name: i.name,
        description: i.description,
        role: idx === 0 ? "lead" : "partner",
      }));
  }, [items, selected]);

  const createWorkflow = async () => {
    if (selectedNodes.length < 2) {
      setError("Select at least 2 agents or MCPs to converge.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/products/collab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          goal,
          name: goal.slice(0, 60),
          nodes: selectedNodes,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error || "create failed");
        return;
      }
      setWorkflow(j.workflow);
      setTalkLog([
        {
          role: "system",
          content: `Workflow created with ${j.workflow.nodes.length} collaborators. Run engineering modes, then Converge → Package.`,
        },
      ]);
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runMode = async (
    action: "graph" | "agent" | "loop" | "converge" | "package",
  ) => {
    if (!workflow?.id) {
      setError("Create a workflow first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/products/collab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          workflow_id: workflow.id,
          title: productTitle || undefined,
        }),
      });
      const j = await res.json();
      if (j.workflow) setWorkflow(j.workflow);
      if (!j.ok) setError(j.error || `${action} failed`);
      else {
        setTalkLog((m) => [
          ...m,
          {
            role: "system",
            content:
              j.workflow?.steps?.[0]?.summary ||
              `${action} completed`,
          },
        ]);
      }
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendTalk = async () => {
    const text = talkDraft.trim();
    if (!text || !workflow || busy) return;
    const targets = workflow.nodes.slice(0, 4);
    setBusy(true);
    setError(null);
    setTalkDraft("");
    setTalkLog((m) => [...m, { role: "user", content: text }]);
    try {
      for (const n of targets) {
        const res = await fetch("/api/talk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listing_id: n.listing_id,
            message: `[Collab ${workflow.id}] Goal: ${workflow.goal}\nPartners: ${workflow.nodes
              .map((x) => x.name)
              .join(", ")}\n\n${text}`,
          }),
        });
        const j = await res.json();
        const reply =
          j.reply ||
          j.session?.messages?.slice(-1)?.[0]?.content ||
          (j.ok ? "(ack)" : j.error || "no reply");
        setTalkLog((m) => [
          ...m,
          {
            role: "assistant",
            name: n.name,
            content: String(reply).slice(0, 800),
          },
        ]);
      }
      await fetch("/api/products/collab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "talk_log",
          workflow_id: workflow.id,
          summary: `Talk broadcast to ${targets.length} nodes`,
          detail: { text: text.slice(0, 200) },
        }),
      }).then(async (r) => {
        const j = await r.json();
        if (j.workflow) setWorkflow(j.workflow);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadWorkflow = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/products/collab?id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const j = await res.json();
      if (j.workflow) {
        setWorkflow(j.workflow);
        setSelected(new Set(j.workflow.nodes.map((n: CollabNode) => n.listing_id)));
        setGoal(j.workflow.goal);
      } else setError(j.error || "not found");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mesh-bg min-h-dvh">
      <div className="page-shell py-6 sm:py-8">
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="accent">Collab Studio</Badge>
              <Badge variant="info">sessions · graph · market</Badge>
              <Badge variant="default">sell on Dual</Badge>
            </div>
            <DualRegistryWordmark showDomain className="mb-2" />
        <SiteNav active="/collab" className="mb-5" />
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              Converge agents & MCPs into products
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Talk with clean listings, wire two or more into a workflow graph,
              run graph / agent / loop engineering, then package a collab product
              they can sell through Dual Registry.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" asChild>
              <Link to="/">← Registry</Link>
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a href="/talk">
                <MessageSquare className="h-3.5 w-3.5" />
                Talk
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a href="/products">
                <Package className="h-3.5 w-3.5" />
                Products
              </a>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void loadRoster();
                void loadHistory();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </header>

        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <Card className="border-accent/20 bg-accent/5">
            <CardContent className="flex items-start gap-2 p-3 text-xs text-muted">
              <Network className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span>
                <span className="font-medium text-fg">Graph engineering.</span>{" "}
                mesh_match + sticky edges between collaborators.
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-2 p-3 text-xs text-muted">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span>
                <span className="font-medium text-fg">Agent & loop.</span>{" "}
                improve_kernel + run_loop_tick on the mesh goal.
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-2 p-3 text-xs text-muted">
              <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span>
                <span className="font-medium text-fg">Sell path.</span> Converge
                → package collab pack → list on /products.
              </span>
            </CardContent>
          </Card>
        </div>

        {error ? (
          <p className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-12">
          {/* Roster */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Layers className="h-4 w-4 text-accent" />
                Roster
              </CardTitle>
              <CardDescription className="text-xs">
                Pick 2+ clean agents / MCPs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-9"
              />
              <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {filtered.length === 0 ? (
                  <p className="text-xs text-muted">
                    No live listings yet. List yourself or wait for probes.
                  </p>
                ) : (
                  filtered.map((item) => {
                    const on = selected.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggle(item.id)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left text-xs transition",
                          on
                            ? "border-accent/40 bg-accent/10"
                            : "border-border bg-bg-elevated hover:border-accent/25",
                        )}
                      >
                        {item.kind === "agent" ? (
                          <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                        ) : (
                          <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-fg">
                            {item.name}
                          </span>
                          <span className="text-muted">{item.kind}</span>
                        </span>
                        {on ? (
                          <Badge variant="accent" className="shrink-0">
                            in
                          </Badge>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
              <p className="text-[11px] text-muted">
                Selected: {selected.size}
              </p>
            </CardContent>
          </Card>

          {/* Graph + modes */}
          <div className="space-y-4 lg:col-span-5">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Workflow className="h-4 w-4 text-accent" />
                    Workflow graph
                  </CardTitle>
                  {workflow ? (
                    <Badge variant={statusVariant(workflow.status)}>
                      {workflow.status}
                    </Badge>
                  ) : (
                    <Badge variant="default">no workflow</Badge>
                  )}
                </div>
                <CardDescription className="text-xs">
                  {workflow
                    ? `${workflow.name} · ${workflow.nodes.length} nodes · ${workflow.edges.length} edges`
                    : "Create a workflow to materialize the graph"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <GraphCanvas
                  nodes={workflow?.nodes || selectedNodes}
                  edges={workflow?.edges || []}
                />
                <label className="block text-xs text-muted">
                  Shared goal
                  <Input
                    className="mt-1"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="What should this collab ship?"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={busy || selected.size < 2}
                    onClick={() => void createWorkflow()}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Create workflow
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !workflow}
                    onClick={() => void runMode("graph")}
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    Graph eng
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !workflow}
                    onClick={() => void runMode("agent")}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    Agent eng
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !workflow}
                    onClick={() => void runMode("loop")}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Loop eng
                  </Button>
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={busy || !workflow}
                    onClick={() => void runMode("converge")}
                  >
                    <Network className="h-3.5 w-3.5" />
                    Converge
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4 text-accent" />
                  Package & sell
                </CardTitle>
                <CardDescription className="text-xs">
                  Bundle mesh + kernel + loop into a collab product draft
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="Product title (optional)"
                  value={productTitle}
                  onChange={(e) => setProductTitle(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="accent"
                  className="w-full sm:w-auto"
                  disabled={busy || !workflow}
                  onClick={() => void runMode("package")}
                >
                  <Package className="h-3.5 w-3.5" />
                  Package product
                </Button>
                {workflow?.product ? (
                  <div className="rounded-md border border-success/25 bg-success/10 p-3 text-xs">
                    <p className="font-medium text-success">
                      {workflow.product.title}
                    </p>
                    <p className="mt-1 text-muted">{workflow.product.tagline}</p>
                    <p className="mt-2 text-fg">
                      Hint price: $
                      {(workflow.product.price_cents_hint / 100).toFixed(2)} ·{" "}
                      {workflow.product.collaborators.length} collaborators
                    </p>
                    <a
                      href={workflow.product.sell_path}
                      className="mt-2 inline-flex text-accent underline-offset-2 hover:underline"
                    >
                      Open sell path →
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    After converge, package to create a sellable draft on Dual.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Talk + steps */}
          <div className="space-y-4 lg:col-span-4">
            <Card className="flex min-h-[360px] flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-accent" />
                  Talk to collab
                </CardTitle>
                <CardDescription className="text-xs">
                  Broadcast to workflow nodes (uses Talk security)
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-2">
                <div className="max-h-[240px] flex-1 space-y-2 overflow-y-auto rounded-md border border-border bg-bg-elevated p-2">
                  {talkLog.length === 0 ? (
                    <p className="text-xs text-muted">
                      Create a workflow, then message the group.
                    </p>
                  ) : (
                    talkLog.map((m, i) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded-md px-2 py-1.5 text-xs",
                          m.role === "user"
                            ? "bg-accent/10 text-fg"
                            : m.role === "system"
                              ? "bg-bg-subtle text-muted"
                              : "bg-bg text-fg",
                        )}
                      >
                        {m.name ? (
                          <span className="mb-0.5 block font-medium text-accent">
                            {m.name}
                          </span>
                        ) : null}
                        <span className="whitespace-pre-wrap">{m.content}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={talkDraft}
                    onChange={(e) => setTalkDraft(e.target.value)}
                    placeholder="Message collaborators…"
                    disabled={!workflow || busy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendTalk();
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={!workflow || busy || !talkDraft.trim()}
                    onClick={() => void sendTalk()}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Step log</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[220px] space-y-1.5 overflow-y-auto">
                  {(workflow?.steps || []).length === 0 ? (
                    <p className="text-xs text-muted">No engineering steps yet.</p>
                  ) : (
                    workflow!.steps.map((s, i) => (
                      <div
                        key={`${s.at}-${i}`}
                        className="rounded-md border border-border px-2 py-1.5 text-[11px]"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant={s.ok ? "success" : "danger"}>
                            {s.mode}
                          </Badge>
                          <span className="text-muted">
                            {new Date(s.at).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="mt-1 text-muted">{s.summary}</p>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent workflows</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {history.length === 0 ? (
                  <p className="text-xs text-muted">None yet.</p>
                ) : (
                  history.slice(0, 8).map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => void loadWorkflow(h.id)}
                      className="flex w-full items-center justify-between rounded-md border border-border px-2 py-1.5 text-left text-xs hover:border-accent/30"
                    >
                      <span className="truncate text-fg">{h.name}</span>
                      <Badge variant={statusVariant(h.status)}>{h.status}</Badge>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Zap className="h-4 w-4 text-accent" />
                  Live sessions (agent-run)
                </CardTitle>
                <CardDescription className="text-xs">
                  Multi-party open → claim steps → close → sell
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {sessions.length === 0 ? (
                  <p className="text-xs text-muted">
                    No open sessions. Agents call collab_session_open.
                  </p>
                ) : (
                  sessions.slice(0, 8).map((s) => (
                    <div
                      key={s.id}
                      className="rounded-md border border-border px-2 py-1.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-fg">
                          {s.goal}
                        </span>
                        <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                      </div>
                      <p className="mt-0.5 text-muted">
                        {s.pending_steps ?? "—"} pending ·{" "}
                        {(s.participants || []).map((p) => p.name).join(", ")}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4 text-accent" />
                  Collab market
                </CardTitle>
                <CardDescription className="text-xs">
                  Packs agents/MCPs published to sell & install
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {market.length === 0 ? (
                  <p className="text-xs text-muted">No listed packs yet.</p>
                ) : (
                  market.slice(0, 8).map((m) => (
                    <a
                      key={m.product_id}
                      href={m.sell_path}
                      className="block rounded-md border border-border px-2 py-1.5 text-[11px] hover:border-accent/30"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-fg">
                          {m.title}
                        </span>
                        <span className="text-accent">
                          ${(m.price_cents / 100).toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-muted">
                        {m.install_n} installs · {m.sold_n} sold ·{" "}
                        {m.collaborators
                          ?.map(
                            (c) =>
                              `${c.name} ${(c.share_bps / 100).toFixed(0)}%`,
                          )
                          .join(" · ")}
                      </p>
                    </a>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
