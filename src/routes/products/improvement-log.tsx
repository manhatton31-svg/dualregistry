/**
 * Improvement log — shell always mounted; Update only patches JSON into state.
 */
import { SiteNav } from "@/components/brand/site-nav";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Loader2,
  MessageSquare,
  Rocket,
  Sparkles,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SoftRefreshBar,
  SoftRefreshButton,
} from "@/components/ui/soft-refresh";
import { useLiveData } from "@/lib/ui/live-data";
import { cn, formatRelative } from "@/lib/utils";

export const Route = createFileRoute("/products/improvement-log")({
  component: ImprovementLogPage,
});

type LogEntry = {
  id?: string;
  at?: string;
  created_at?: string;
  kind: string;
  title?: string;
  summary?: string;
  detail?: string;
  scope?: string;
  product?: string;
};

type LogPayload = {
  ok?: boolean;
  tagline?: string;
  entries?: LogEntry[];
  feedback_board?: {
    note?: string;
    pain_points?: Array<{
      label: string;
      votes: number;
      scope: string;
      status: string;
      what_changed?: string[];
    }>;
    shipped_done?: Array<{
      label: string;
      historical_votes?: number;
    }>;
  };
};

function ImprovementLogPage() {
  const [filter, setFilter] = useState("all");
  const { data, error, loading, refreshing, refresh } =
    useLiveData<LogPayload>({
      key: "ilog",
      url: "/api/products/improvement-log?limit=20&dogfood=0",
    });

  const entries = useMemo(
    () =>
      (data?.entries || [])
        .filter((e) => (filter === "all" ? true : e.kind === filter))
        .slice(0, 20),
    [data, filter],
  );

  const filters = [
    "all",
    "feedback_received",
    "personalize",
    "system_candidate",
    "shipped",
    "canary",
  ];
  const board = data?.feedback_board;

  return (
    <div className="mesh-bg min-h-dvh overflow-x-clip">
      <SoftRefreshBar active={refreshing || loading} />
      <div className="pointer-events-none fixed inset-0 grid-fade opacity-50" />
      <div className="page-shell relative max-w-4xl py-6 sm:py-8">
        <div className="mb-6 flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" asChild>
                <a href="/">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Dashboard
                </a>
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <a href="/products">Products</a>
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <a href="/products/roadmap">Roadmap</a>
              </Button>
            </div>
            <Badge variant="accent" className="mb-2 gap-1">
              <Sparkles className="h-3 w-3" />
              Public improvement log
            </Badge>
            <SiteNav active="/products/improvement-log" className="mb-4" />
            <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              Kernel Improver & Recursive Loop
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              {data?.tagline ||
                "Feedback → first 3 individualized → 4th reuse ships sitewide."}
            </p>
            {error ? (
              <p className="mt-1 text-xs text-warn">{error}</p>
            ) : null}
          </div>
          <SoftRefreshButton
            refreshing={refreshing}
            onClick={() => void refresh()}
            label="Update"
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            Loading log data…
          </div>
        ) : null}

        {board ? (
          <div className="mb-6 space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-accent" />
                  Active pain points
                </CardTitle>
                <CardDescription className="text-xs">
                  {board.note ||
                    "Shipped themes archived; refinements stay visible."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(board.pain_points || []).length === 0 ? (
                  <p className="text-sm text-subtle">No open backlog.</p>
                ) : (
                  (board.pain_points || []).slice(0, 10).map((p) => (
                    <div
                      key={p.label + p.scope}
                      className="rounded-[var(--radius-sm)] border border-border/70 bg-bg-elevated/40 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-fg">
                          {p.label}
                        </span>
                        <Badge variant="default" className="text-[10px]">
                          {p.scope} · {p.votes}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            {(board.shipped_done || []).length ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    Already shipped
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {(board.shipped_done || []).slice(0, 16).map((s) => (
                    <Badge
                      key={s.label}
                      variant="success"
                      className="text-[10px]"
                    >
                      {s.label}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}

        {data ? (
          <>
            <div className="scroll-x mb-4 flex gap-1 pb-1">
              {filters.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
                    filter === f
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border text-muted hover:text-fg",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {entries.length === 0 ? (
                <p className="text-sm text-subtle">No entries for this filter.</p>
              ) : (
                entries.map((e, i) => (
                  <Card key={e.id || `${e.kind}-${i}`}>
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default" className="text-[10px]">
                          {e.kind}
                        </Badge>
                        <span className="text-[11px] text-subtle">
                          {formatRelative(e.at || e.created_at || "")}
                        </span>
                      </div>
                      <CardTitle className="text-sm">
                        {e.title || e.product || e.kind}
                      </CardTitle>
                    </CardHeader>
                    {(e.summary || e.detail) && (
                      <CardContent className="pt-0 text-xs text-muted">
                        {(e.summary || e.detail || "").slice(0, 240)}
                      </CardContent>
                    )}
                  </Card>
                ))
              )}
            </div>
          </>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3 text-xs text-subtle">
          <span className="inline-flex items-center gap-1">
            <Cpu className="h-3.5 w-3.5" /> Kernel
          </span>
          <span className="inline-flex items-center gap-1">
            <Rocket className="h-3.5 w-3.5" /> Loop
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> Individual → sitewide
          </span>
        </div>
      </div>
    </div>
  );
}
