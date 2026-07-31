import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeedbackSurvey } from "@/components/products/feedback-survey";
import { LifecycleSurveyPanel } from "@/components/products/lifecycle-survey";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/products/success")({
  validateSearch: (s: Record<string, unknown>) => ({
    order_id: typeof s.order_id === "string" ? s.order_id : undefined,
    session_id: typeof s.session_id === "string" ? s.session_id : undefined,
  }),
  component: SuccessPage,
});

type OrderView = {
  id: string;
  product?: string;
  sku: string;
  status: string;
  access_token?: string;
  artifacts?: Record<string, unknown>;
  note?: string;
  goals?: { agent_name?: string; goals?: string };
};

function SuccessPage() {
  const { order_id, session_id } = Route.useSearch();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("kernel");

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8_000);
    const q = new URLSearchParams();
    if (order_id) q.set("order_id", order_id);
    if (session_id) q.set("session_id", session_id);
    void fetch(`/api/products/confirm?${q.toString()}`, {
      cache: "no-store",
      signal: ac.signal,
    })
      .then(async (r) => {
        const j = (await r.json()) as {
          ok: boolean;
          error?: string;
          order?: OrderView;
        };
        if (!j.ok || !j.order) throw new Error(j.error || "confirm failed");
        if (!cancelled) setOrder(j.order);
      })
      .catch((e) => {
        if (cancelled || (e instanceof Error && e.name === "AbortError"))
          return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
        clearTimeout(t);
      });
    return () => {
      cancelled = true;
      ac.abort();
      clearTimeout(t);
    };
  }, [order_id, session_id]);

  const arts = order?.artifacts as
    | {
        kernel?: { system_prompt?: string; goal_tree?: unknown };
        recursive?: { agent_instructions?: string; tick_protocol?: unknown };
        alive?: { agent_teach_prompt?: string; modules?: unknown };
      }
    | undefined;

  useEffect(() => {
    if (arts?.kernel) setTab("kernel");
    else if (arts?.recursive) setTab("recursive");
    else if (arts?.alive) setTab("alive");
  }, [order?.id]);

  async function copyToken() {
    if (!order?.access_token) return;
    await navigator.clipboard.writeText(order.access_token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="mesh-bg flex min-h-dvh items-center justify-center gap-2 text-muted">
        <Loader2 className="h-5 w-5 animate-spin text-accent" /> Activating
        products…
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="mesh-bg min-h-dvh px-4 py-16">
        <Card className="mx-auto max-w-lg">
          <CardHeader>
            <CardTitle>Could not activate</CardTitle>
            <CardDescription>{error || "Missing order"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/products" className="text-sm text-accent hover:underline">
              Back to products
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const promptPreview =
    tab === "kernel"
      ? arts?.kernel?.system_prompt
      : tab === "recursive"
        ? arts?.recursive?.agent_instructions
        : arts?.alive?.agent_teach_prompt;

  return (
    <div className="mesh-bg min-h-dvh overflow-x-clip">
      <div className="page-shell relative max-w-3xl py-6 sm:py-10">
        <Badge variant="success" className="mb-3 gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {order.status === "demo" ? "demo fulfilled" : "paid & fulfilled"}
        </Badge>
        <h1 className="text-xl font-semibold text-fg sm:text-2xl">
          {order.product || order.sku} ready
        </h1>
        <p className="mt-1 text-sm text-muted">
          {order.goals?.agent_name
            ? `Agent: ${order.goals.agent_name}`
            : "Your agent artifacts are below."}
        </p>

        <Card className="mt-6 border-accent/30">
          <CardHeader>
            <CardTitle className="text-base">
              Demo survey · access path (6–8 questions)
            </CardTitle>
            <CardDescription>
              Honest answers only — rewrites Kernel + Loop for the next agents.
              Short path for conversion; finish for founding free seat / discount.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FeedbackSurvey
              source={order?.status === "demo" ? "demo" : "paid"}
              orderId={order?.id}
              sku={order?.sku}
              agentName={order?.goals?.agent_name}
              mode={order?.status === "demo" ? "demo" : "stripe"}
              compact
            />
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-accent" />
              Access token
            </CardTitle>
            <CardDescription>
              Agents fetch products with this token. Keep it secret.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <code className="block break-all rounded border border-border bg-bg px-2 py-2 text-[11px] text-accent">
              {order.access_token}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void copyToken()}>
                {copied ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Copy token
              </Button>
              <a
                className="inline-flex items-center text-xs text-accent hover:underline"
                href={`/api/products/access?token=${encodeURIComponent(order.access_token || "")}`}
                target="_blank"
                rel="noreferrer"
              >
                Open JSON access API
              </a>
            </div>
            {order.note ? (
              <p className="text-xs text-warn">{order.note}</p>
            ) : null}
          </CardContent>
        </Card>

        <div className="mt-4 flex flex-wrap gap-2">
          {arts?.kernel ? (
            <Button
              size="sm"
              variant={tab === "kernel" ? "accent" : "secondary"}
              onClick={() => setTab("kernel")}
            >
              Kernel v2
            </Button>
          ) : null}
          {arts?.recursive ? (
            <Button
              size="sm"
              variant={tab === "recursive" ? "accent" : "secondary"}
              onClick={() => setTab("recursive")}
            >
              Loop v2
            </Button>
          ) : null}
          {arts?.alive ? (
            <Button
              size="sm"
              variant={tab === "alive" ? "accent" : "secondary"}
              onClick={() => setTab("alive")}
            >
              Alive v2
            </Button>
          ) : null}
        </div>

        <Card className="mt-3">
          <CardHeader>
            <CardTitle className="text-base">
              {tab === "kernel"
                ? "Kernel v2 system prompt"
                : tab === "recursive"
                  ? "Recursive Loop v2 instructions"
                  : "Alive v2 teach prompt"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded border border-border bg-bg p-3 text-[11px] leading-relaxed text-muted">
              {promptPreview || "Artifact not in this purchase."}
            </pre>
          </CardContent>
        </Card>

        <p className="mt-8 text-center text-xs text-subtle">
          <Link to="/products" className="text-accent hover:underline">
            Buy another
          </Link>
          {" · "}
          <a href="/products#demo-feedback" className="text-accent hover:underline">
            Send demo feedback
          </a>
          {" · "}
          <Link to="/" className="text-accent hover:underline">
            Dashboard
          </Link>
        </p>


        {order?.status === "fulfilled" || order?.status === "paid" ? (
          <Card className="mt-6 border-accent/40">
            <CardHeader>
              <CardTitle className="text-base">
                Post-setup & weekly product feedback (2 months)
              </CardTitle>
              <CardDescription>
                Phase-aware surveys: post-setup now, then weekly for 8 weeks.
                We decide system-wide Kernel/Loop changes vs your agent-only
                personalization, and estimate cost impact.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LifecycleSurveyPanel
                token={order?.access_token}
                orderId={order?.id}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

