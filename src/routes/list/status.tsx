/**
 * /list/status?id=… — human claim / status page after self-list
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/list/status")({
  component: ListStatusPage,
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s.id === "string" ? s.id : undefined,
    name: typeof s.name === "string" ? s.name : undefined,
  }),
});

type Status = {
  ok?: boolean;
  found?: boolean;
  listing_id?: string;
  name?: string;
  kind?: string;
  lane?: string;
  lane_reason?: string;
  next?: string;
  take_demo?: { curl?: string; body?: Record<string, unknown> };
  badge_markdown?: string;
  resubmit?: { fix?: string; message?: string };
  message?: string;
  probe?: { handshake?: string; ok?: boolean; target?: string };
};

function ListStatusPage() {
  const { id, name } = Route.useSearch();
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id && !name) return;
    let cancelled = false;
    async function load() {
      try {
        const q = id
          ? `id=${encodeURIComponent(id)}`
          : `name=${encodeURIComponent(name || "")}`;
        const r = await fetch(`/api/listings/status?${q}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as Status;
        if (!cancelled) {
          setStatus(j);
          setErr(j.found === false ? j.message || "Not found" : null);
        }
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id, name]);

  const lane = status?.lane || "—";
  const tone =
    lane === "active"
      ? "success"
      : lane === "needs_resubmit"
        ? "warn"
        : "accent";

  return (
    <div className="mesh-bg min-h-dvh">
      <div className="page-shell max-w-lg py-8">
        <Badge variant="accent" className="mb-3">
          Listing status
        </Badge>
        <h1 className="text-2xl font-semibold text-fg">
          {status?.name || id || name || "Your listing"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Auto-refreshes every 30s · probe every ~6 min
        </p>

        {!id && !name ? (
          <Card className="mt-6">
            <CardContent className="pt-4 text-sm text-muted">
              Pass <code className="text-accent">?id=</code> or{" "}
              <code className="text-accent">?name=</code>. After list:{" "}
              <Link to="/list" className="text-accent underline">
                /list
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card className="mt-6">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Lane{" "}
                <Badge variant={tone as "success" | "warn" | "accent"}>
                  {lane}
                </Badge>
                {status?.kind ? (
                  <span className="text-xs font-normal text-muted">
                    {status.kind}
                  </span>
                ) : null}
              </CardTitle>
              <CardDescription className="text-xs">
                {status?.lane_reason || err || "Loading…"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {status?.listing_id ? (
                <p className="font-mono text-[11px] text-subtle">
                  listing_id: {status.listing_id}
                </p>
              ) : null}
              <p className="text-fg">{status?.next}</p>
              {status?.probe ? (
                <p className="text-xs text-muted">
                  Last probe: {status.probe.handshake || "—"}{" "}
                  {status.probe.ok ? "✓" : "✗"}{" "}
                  {status.probe.target || ""}
                </p>
              ) : null}
              {status?.resubmit ? (
                <div className="rounded border border-warn/30 bg-warn/5 p-3 text-xs">
                  <p className="font-medium text-warn">Needs resubmit</p>
                  <p className="mt-1 text-muted">
                    {status.resubmit.message || status.resubmit.fix}
                  </p>
                  <Button asChild size="sm" className="mt-2">
                    <Link to="/list">Fix & resubmit</Link>
                  </Button>
                </div>
              ) : null}
              {status?.take_demo?.curl ? (
                <div className="rounded border border-border p-3 text-[11px]">
                  <p className="mb-1 font-medium text-fg">Take free demo</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-muted">
                    {status.take_demo.curl}
                  </pre>
                </div>
              ) : null}
              {status?.badge_markdown ? (
                <div className="rounded border border-border p-3 text-[11px]">
                  <p className="mb-1 font-medium text-fg">README badge</p>
                  <code className="text-muted">{status.badge_markdown}</code>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="secondary">
                  <Link to="/for-agents">Agent path</Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <a href="/skill.json">skill.json</a>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link to="/">Dashboard</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
