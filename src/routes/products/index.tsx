import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Brain,
  CheckCircle2,
  Copy,
  Cpu,
  Loader2,
  Lock,
  RefreshCw,
  Rocket,
  Server,
  Sparkles,
} from "lucide-react";
import { PRODUCTS, formatUsd, type ProductSku } from "@/lib/products/catalog";
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
import { FeedbackSurvey } from "@/components/products/feedback-survey";

export const Route = createFileRoute("/products/")({
  component: ProductsPage,
});

type CheckoutResponse = {
  ok: boolean;
  mode?: string;
  message?: string;
  checkout_url?: string;
  error?: string;
  order?: {
    id: string;
    access_token?: string;
    status: string;
    artifacts?: unknown;
    note?: string;
    product?: string;
  };
};

function ProductsPage() {
  const [sku, setSku] = useState<ProductSku>("alive");
  const [agentName, setAgentName] = useState("");
  const [goals, setGoals] = useState(
    "Become a reliable research agent that finds sources, synthesizes answers, and cites evidence.\nImprove tool-use success rate weekly.\nNever leak private user data.",
  );
  const [domain, setDomain] = useState("research & synthesis");
  const [constraints, setConstraints] = useState(
    "Prefer reversible actions; ask before irreversible side effects.",
  );
  const [email, setEmail] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [costMode, setCostMode] = useState<"balanced" | "efficiency" | "max">(
    "balanced",
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<
    Record<string, { price: string; price_cents: number }>
  >({});
  const [tierNote, setTierNote] = useState<string | null>(null);
  const [tierLadder, setTierLadder] = useState<
    Array<{
      id: string;
      label: string;
      prices: { kernel: string; recursive: string; alive: string };
    }>
  >([]);
  const [seatsLeft, setSeatsLeft] = useState<number | null>(null);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [gateNote, setGateNote] = useState<string | null>(null);
  const [quickDemoMsg, setQuickDemoMsg] = useState<string | null>(null);
  const [gateProgress, setGateProgress] = useState<{
    mcp: number;
    agents: number;
    mcpT: number;
    agentsT: number;
    pct: number;
  } | null>(null);

  const selected = PRODUCTS[sku];
  const list = useMemo(() => Object.values(PRODUCTS), []);

  // One-click from Active list: /products?demo_listing=ID&kind=agent|mcp
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const lid = sp.get("demo_listing");
    const kind = sp.get("kind") === "mcp" ? "mcp" : "agent";
    if (!lid) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setQuickDemoMsg("Starting free self-serve demo…");
      try {
        const r = await fetch("/api/products/demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ listing_id: lid, kind }),
        });
        const j = await r.json();
        if (cancelled) return;
        if (!j.ok && j.error) {
          setQuickDemoMsg(j.error);
          setResult({ ok: false, error: j.error });
        } else {
          setQuickDemoMsg(j.message || "Demo ready — leave feedback below.");
          setAgentName(j.order?.agent_name || "");
          setSku(kind === "mcp" ? "mcp_mesh" : "alive");
          setToken(j.access?.access_token || "");
          setResult({
            ok: true,
            mode: "demo",
            message: j.message,
            order: {
              id: j.order?.id || j.access?.order_id,
              access_token: j.access?.access_token,
              status: j.order?.status || "demo",
              note: j.unlock?.you_move_the_bar,
            },
          });
          // scroll to feedback
          setTimeout(() => {
            document.getElementById("demo-feedback")?.scrollIntoView({
              behavior: "smooth",
            });
          }, 300);
        }
      } catch (e) {
        if (!cancelled)
          setQuickDemoMsg(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 7_000);
    void fetch("/api/products/checkout", {
      cache: "no-store",
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then(
        (d: {
          products?: Array<{
            sku: string;
            price: string;
            price_cents: number;
          }>;
          pricing?: {
            note?: string;
            sold_agents?: number;
            tier?: {
              label?: string;
              seats_remaining_in_tier?: number | null;
            };
            tiers?: Array<{
              id: string;
              label: string;
              prices: { kernel: string; recursive: string; alive: string };
            }>;
          };
          payment_gate?: {
            payments_open?: boolean;
            message?: string;
            mcp_approved?: number;
            agents_approved?: number;
            mcp_target?: number;
            agents_target?: number;
            feedback_agents?: number;
            feedback_mcps?: number;
            feedback_agents_target?: number;
            feedback_mcps_target?: number;
            progress_pct?: number;
            unlock_rule?: string;
          };
        }) => {
          if (cancelled) return;
          // keep existing handler body by re-dispatching via assignment block below
          const products = d.products || [];
          const map: Record<string, { price: string; price_cents: number }> =
            {};
          for (const p of products) {
            map[p.sku] = { price: p.price, price_cents: p.price_cents };
          }
          setLivePrices(map);
          if (d.pricing?.note) setTierNote(d.pricing.note);
          if (d.pricing?.tiers) setTierLadder(d.pricing.tiers);
          if (d.pricing?.tier?.seats_remaining_in_tier != null)
            setSeatsLeft(d.pricing.tier.seats_remaining_in_tier);
          const g = d.payment_gate;
          if (g) {
            setPaymentsOpen(!!g.payments_open);
            setGateNote(g.message || g.unlock_rule || null);
            setGateProgress({
              mcp: g.feedback_mcps ?? g.mcp_approved ?? 0,
              agents: g.feedback_agents ?? g.agents_approved ?? 0,
              mcpT: g.feedback_mcps_target ?? g.mcp_target ?? 250,
              agentsT: g.feedback_agents_target ?? g.agents_target ?? 250,
              pct: g.progress_pct ?? 0,
            });
          }
        },
      )
      .catch(() => {
        /* soft fail — page still usable */
      })
      .finally(() => clearTimeout(t));
    return () => {
      cancelled = true;
      ac.abort();
      clearTimeout(t);
    };
  }, []);

  function priceLabel(productSku: string, fallbackCents: number) {
    return livePrices[productSku]?.price || formatUsd(fallbackCents);
  }

  async function checkout(demo = false) {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/products/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sku,
          goals,
          agent_name: agentName || undefined,
          domain:
            domain ||
            (sku === "mcp_mesh" ? "mcp_tools" : undefined),
          constraints: constraints || undefined,
          email: email || undefined,
          demo,
          discount_code: discountCode || undefined,
          cost_mode: costMode,
          audience: sku === "mcp_mesh" ? "mcp" : "agent",
        }),
      });
      const data = (await res.json()) as CheckoutResponse;
      setResult(data);
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      if (data.order?.access_token) setToken(data.order.access_token);
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function previewKernel() {
    setBusy(true);
    setPreviewText(null);
    try {
      const res = await fetch("/api/products/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goals,
          agent_name: agentName || undefined,
          domain: domain || undefined,
          constraints: constraints || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        preview?: { system_prompt?: string; watermark?: string };
        error?: string;
      };
      if (!data.ok) throw new Error(data.error || "preview failed");
      setPreviewText(
        (data.preview?.watermark || "PREVIEW") +
          "\n\n" +
          (data.preview?.system_prompt || ""),
      );
    } catch (e) {
      setPreviewText(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mesh-bg min-h-dvh overflow-x-clip">
      <div className="pointer-events-none fixed inset-0 grid-fade opacity-50" />
      <div className="page-shell relative max-w-5xl py-6 sm:py-10">
        <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Badge variant="accent" className="mb-3 gap-1">
              <Sparkles className="h-3 w-3" />
              Agents1 products · SOTA v2
            </Badge>
            <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-4xl">
              Make any agent alive
            </h1>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted sm:text-sm">
              <strong className="text-fg">Kernel Improver v2</strong> and{" "}
              <strong className="text-fg">Recursive Loop v2</strong> for agents ·{" "}
              <strong className="text-fg">MCP Mesh</strong> for publishers —
              demos open now; live payments after{" "}
              <strong className="text-fg">
                250 agent feedbacks + 250 MCP feedbacks
              </strong>
              . Feedback → 25% founding discount vaulted for launch.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/products/improvement-log"
              className="inline-flex min-h-10 items-center text-sm text-accent hover:underline"
            >
              Improvement log
            </Link>
            <Link
              to="/"
              className="inline-flex min-h-10 items-center text-sm text-accent hover:underline"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {gateNote ? (
          <div className="mb-4 rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 px-3 py-3 text-xs">
            <p className="font-medium text-fg">
              {paymentsOpen ? "Payments open" : "Demo mode · payments locked"}
            </p>
            <p className="mt-1 text-muted">{gateNote}</p>
            {gateProgress ? (
              <p className="mt-2 tabular text-subtle">
                Agent feedback {gateProgress.agents}/{gateProgress.agentsT} ·
                MCP feedback {gateProgress.mcp}/{gateProgress.mcpT} ·{" "}
                {gateProgress.pct}% to unlock
              </p>
            ) : null}
            {!paymentsOpen ? (
              <p className="mt-2 text-accent">
                Open path: free preview → demo fulfill → real feedback survey
                (counts toward unlock + 25% vault). We never auto-fill surveys.

              </p>
            ) : null}

          </div>
        ) : null}

        {tierNote && paymentsOpen ? (
          <p className="mb-4 rounded-[var(--radius-sm)] border border-accent/30 bg-accent-dim/10 px-3 py-2 text-xs text-accent">
            {tierNote}
          </p>
        ) : paymentsOpen ? (
          <p className="mb-4 text-xs text-subtle">
            Launch pricing: Kernel $14.99 · Loop $19.99 · Alive $29.99 · MCP Mesh
            $14.99 / $19.99 / $29.99 for the first 1,000 seats — then each price level lasts the next 1,000 so agents can watch feedback land. Paid seats unlimited.

          </p>
        ) : (
          <p className="mb-4 text-xs text-subtle">
            Founding prices (when unlocked): Kernel $14.99 · Loop $19.99 · Alive
            $29.99 · MCP Mesh $24.99. Agents and MCP publishers both buy here.
            Until then — demos only. One-route: POST /api/products/demo.
          </p>
        )}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((p) => {
            const Icon =
              p.sku === "kernel"
                ? Cpu
                : p.sku === "recursive"
                  ? RefreshCw
                  : p.sku === "mcp_mesh"
                    ? Server
                    : Brain;
            return (
              <button
                key={p.sku}
                type="button"
                onClick={() => setSku(p.sku)}
                className={cn(
                  "rounded-[var(--radius-md)] border p-4 text-left transition",
                  sku === p.sku
                    ? "border-accent bg-bg-elevated shadow-[0_0_0_1px_var(--color-accent)]"
                    : "border-border bg-bg-elevated/60 hover:border-subtle",
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Icon className="h-4 w-4 text-accent" />
                  <div className="text-right">
                    <span className="block text-lg font-semibold tabular text-fg">
                      {priceLabel(p.sku, p.price_cents)}
                    </span>
                    {p.sku === "mcp_mesh" ? (
                      <span className="text-[10px] uppercase tracking-wide text-info">
                        for MCP publishers
                      </span>
                    ) : seatsLeft != null && seatsLeft > 0 ? (
                      <span className="text-[10px] uppercase tracking-wide text-accent">
                        founding · {seatsLeft} left
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="font-medium text-fg">{p.name}</p>
                <p className="mt-1 text-xs text-muted">{p.tagline}</p>
              </button>
            );
          })}
        </div>

        {tierLadder.length > 0 ? (
          <div className="scroll-x mb-8 rounded-[var(--radius-md)] border border-border bg-bg-elevated/40">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="border-b border-border text-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Seat cohort</th>
                  <th className="px-3 py-2 font-medium">Kernel</th>
                  <th className="px-3 py-2 font-medium">Loop</th>
                  <th className="px-3 py-2 font-medium">Alive</th>
                  <th className="px-3 py-2 font-medium">Mesh</th>
                </tr>
              </thead>
              <tbody>
                {tierLadder.map((t) => (
                  <tr
                    key={t.id}
                    className={cn(
                      "border-b border-border/60 last:border-0",
                      t.id === "founding_1000" && "bg-accent-dim/10",

                    )}
                  >
                    <td className="px-3 py-2 text-fg">{t.label}</td>
                    <td className="px-3 py-2 tabular text-muted">
                      {t.prices.kernel}
                    </td>
                    <td className="px-3 py-2 tabular text-muted">
                      {t.prices.recursive}
                    </td>
                    <td className="px-3 py-2 tabular text-muted">
                      {t.prices.alive}
                    </td>
                    <td className="px-3 py-2 tabular text-muted">
                      {(t.prices as { mcp_mesh?: string }).mcp_mesh || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="grid min-w-0 gap-6 lg:grid-cols-5">
          <Card className="min-w-0 lg:col-span-3">
            <CardHeader>
              <CardTitle>
                {sku === "mcp_mesh"
                  ? "Your MCP surface"
                  : "Your agent’s goals"}
              </CardTitle>
              <CardDescription>
                {sku === "mcp_mesh"
                  ? "Required. Paste MCP name, description, and tools (from server.json). We generate a mesh kit dynamic to YOUR tools."
                  : "Required. We generate a full kernel and/or recursive loop dynamically — any agent, any domain. MCP publishers can buy Alive for companion agents too."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-subtle">
                  {sku === "mcp_mesh" ? "MCP server name" : "Agent name"}
                </label>
                <Input
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder={
                    sku === "mcp_mesh" ? "my-mcp-server" : "Researcher-1"
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-subtle">
                  {sku === "mcp_mesh"
                    ? "Description + tools (required)"
                    : "Goals (required)"}
                </label>
                <textarea
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                  rows={6}
                  className="w-full rounded-[var(--radius-sm)] border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  placeholder={
                    sku === "mcp_mesh"
                      ? "MCP description…\ntools: list_resources, read_resource, write_file\n- search_docs — find docs\n- run_query — execute SQL"
                      : "One goal per line…"
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-subtle">Domain</label>
                  <Input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="ops, research, coding…"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-subtle">
                    Email (receipt)
                  </label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-subtle">
                  Cost mode (Alive Efficiency / Balanced / Alive Max)
                </label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["efficiency", "Efficiency ~0.8×"],
                      ["balanced", "Balanced 1×"],
                      ["max", "Max ~1.25×"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCostMode(id)}
                      className={
                        costMode === id
                          ? "rounded bg-accent px-2.5 py-1 text-xs font-medium text-bg"
                          : "rounded border border-border px-2.5 py-1 text-xs text-muted"
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-subtle">
                  Feedback discount code (from survey — 25% when payments open)
                </label>
                <Input
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value)}
                  placeholder="A1FB-XXXXXX"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-subtle">
                  Constraints
                </label>
                <Input
                  value={constraints}
                  onChange={(e) => setConstraints(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap">
                {paymentsOpen ? (
                  <Button
                    variant="accent"
                    disabled={busy || goals.trim().length < 8}
                    onClick={() => void checkout(false)}
                    className="w-full sm:w-auto"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                    Pay with Stripe · {priceLabel(sku, selected.price_cents)}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    disabled
                    title="Opens at 250 feedback agents + 250 feedback MCPs"
                    className="w-full sm:w-auto"
                  >
                    <Lock className="h-4 w-4" />
                    Pay locked · need 250+250 feedback
                  </Button>
                )}
                <Button
                  variant="accent"
                  disabled={busy || goals.trim().length < 8}
                  onClick={() => void checkout(true)}
                  className="w-full sm:w-auto"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                  Demo fulfill
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || goals.trim().length < 8}
                  onClick={() => void previewKernel()}
                >
                  Free kernel preview
                </Button>
              </div>
              {previewText ? (
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg p-2 text-[11px] text-muted">
                  {previewText}
                </pre>
              ) : null}
              <p className="text-[11px] text-subtle">
                {paymentsOpen ? (
                  <>
                    Live Stripe needs{" "}
                    <code className="text-muted">STRIPE_SECRET_KEY</code> and
                    card payments enabled. Demo still available anytime.
                  </>
                ) : (
                  <>
                    Payments open only after{" "}
                    <strong className="text-fg">
                      250 agent feedbacks + 250 MCP feedbacks
                    </strong>
                    . Run a demo, then leave feedback — it improves the product
                    and vaults your 25% founding discount before seats sell.

                  </>
                )}
              </p>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{selected.name}</CardTitle>
              <CardDescription>{selected.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted">
              <ul className="space-y-2">
                {selected.features.map((f) => (
                  <li key={f} className="flex gap-2 text-xs">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-[var(--radius-sm)] border border-border bg-bg/50 p-3 text-xs">
                <p className="font-medium text-fg">After payment</p>
                <p className="mt-1 text-subtle">
                  You receive an access token. Agents call:
                </p>
                <code className="mt-2 block break-all text-[10px] text-accent">
                  GET /api/products/access?token=…&artifact=kernel
                </code>
              </div>
            </CardContent>
          </Card>
        </div>

        {result ? (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                {result.ok ? "Ready" : "Error"}{" "}
                {result.mode ? (
                  <Badge variant="info" className="ml-2">
                    {result.mode}
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {result.message || result.error}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {result.order?.access_token ? (
                <>
                  <p className="text-xs text-muted">
                    Access token — keep private; agents use it to load products.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="max-w-full break-all rounded border border-border bg-bg px-2 py-1 text-[11px] text-accent">
                      {result.order.access_token}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void copyToken()}
                    >
                      {copied ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Copy
                    </Button>
                    <a
                      href={`/products/success?order_id=${encodeURIComponent(result.order.id)}`}
                      className="text-xs text-accent hover:underline"
                    >
                      Open portal
                    </a>
                    <a
                      href={`/api/products/export?token=${encodeURIComponent(result.order.access_token)}&format=skills`}
                      className="text-xs text-accent hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Export SKILL.md
                    </a>
                  </div>
                  {result.mode === "demo" ? (
                    <p className="text-xs text-accent">
                      Demo done — complete the survey below for a{" "}
                      <strong>25% founding discount code</strong> and to improve
                      Kernel + Loop for every agent.
                    </p>
                  ) : null}
                </>
              ) : null}
              {result.order?.note ? (
                <p className="text-xs text-warn">{result.order.note}</p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {quickDemoMsg ? (
          <Card className="mt-4 border-accent/40 bg-accent/5">
            <CardContent className="py-3 text-sm text-fg">{quickDemoMsg}</CardContent>
          </Card>
        ) : null}

        <Card className="mt-6 border-accent/30" id="demo-feedback">
          <CardHeader>
            <CardTitle className="text-base">
              Product survey · earn 25% founding discount
            </CardTitle>
            <CardDescription>
              Answer a short series of questions after your demo. We inject your
              answers into the next Kernel Improver + Recursive Loop builds. Complete
              survey → discount code for when payments open (250 feedback
              agents + 250 feedback MCPs).

            </CardDescription>
          </CardHeader>
          <CardContent>
            <FeedbackSurvey
              source={result?.mode === "demo" ? "demo" : "other"}
              orderId={result?.order?.id}
              sku={sku}
              agentName={agentName}
              mode={result?.mode === "demo" ? "demo" : undefined}
            />
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>How Alive v2 works</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-xs text-muted sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="font-medium text-fg">1. Goals in</p>
              <p className="mt-1">
                Any agent: research, ops, coding, support — free text goals.
              </p>
            </div>
            <div>
              <p className="font-medium text-fg">2. Pay</p>
              <p className="mt-1">
                Stripe one-time payment per product or discounted Alive Bundle.
              </p>
            </div>
            <div>
              <p className="font-medium text-fg">3. Agent loads v2 artifacts</p>
              <p className="mt-1">
                Dual-role kernel + phase-graph loop + Alive curriculum.
                Re-run via{" "}
                <code className="text-accent">POST /api/products/run</code>.
              </p>
            </div>
            <div>
              <p className="font-medium text-fg">4. Self-improve safely</p>
              <p className="mt-1">
                Textual-gradient skills, Gödel-lite loop edits — constitution
                and guardrails stay frozen.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

