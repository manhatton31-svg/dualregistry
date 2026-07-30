import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, Loader2, Rocket, Zap } from "lucide-react";
import {
  fetchGrowthStatus,
  triggerGrowthCycle,
  submitListingByUrl,
} from "@/lib/agents1/api";
import type {
  GrowthPublicStatus,
  SubmitByUrlResult,
} from "@/lib/agents1/growth";
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
import { SoftRefreshButton } from "@/components/ui/soft-refresh";
import { formatRelative } from "@/lib/utils";

export function GrowthPanel() {
  const [status, setStatus] = useState<GrowthPublicStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const busy = useRef(false);
  const statusRef = useRef<GrowthPublicStatus | null>(null);

  const load = useCallback(async (user = false) => {
    if (busy.current) return;
    busy.current = true;
    if (user) setRefreshing(true);
    try {
      const next = (await fetchGrowthStatus()) as GrowthPublicStatus;
      statusRef.current = next;
      setStatus(next); // patch numbers only
      setMsg(null);
    } catch (e) {
      if (!statusRef.current) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    } finally {
      busy.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load(false);
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function runNow() {
    setRunning(true);
    try {
      const next = (await triggerGrowthCycle()) as GrowthPublicStatus;
      statusRef.current = next;
      setStatus(next);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function submitUrl() {
    if (!url.trim()) return;
    try {
      const r = (await submitListingByUrl({
        data: { url: url.trim() },
      })) as SubmitByUrlResult;
      setMsg(r.message);
      if (r.ok) setUrl("");
      await load(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin text-accent" /> Loading growth…
      </div>
    );
  }

  const s = status as GrowthPublicStatus & {
    scheduler?: { enabled?: boolean };
    daily_ops?: Record<string, unknown>;
  } | null;
  const ft = s?.free_tier;
  const ops = (s?.daily_ops || {}) as Record<string, unknown>;
  const putPct =
    ft && ft.put.budget > 0
      ? Math.min(100, Math.round((ft.put.used / ft.put.budget) * 100))
      : 0;
  const getPct =
    ft && ft.get.budget > 0
      ? Math.min(100, Math.round((ft.get.used / ft.get.budget) * 100))
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-subtle">
          Growth · numbers update in place every 30s
        </p>
        <SoftRefreshButton
          refreshing={refreshing || running}
          onClick={() => void load(true)}
          label="Update"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Gauge className="h-4 w-4 text-accent" />
              Free-tier budget
            </CardTitle>
            <CardDescription className="text-xs">
              KV PUT/GET under Cloudflare free limits
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div>
              <div className="mb-1 flex justify-between text-muted">
                <span>PUT</span>
                <span className="tabular">
                  {ft ? `${ft.put.used}/${ft.put.budget}` : "—"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${putPct}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-muted">
                <span>GET</span>
                <span className="tabular">
                  {ft ? `${ft.get.used}/${ft.get.budget}` : "—"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-info transition-[width] duration-300"
                  style={{ width: `${getPct}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Rocket className="h-4 w-4 text-info" />
              Daily ops
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted">
            <p>
              Cycle{" "}
              <span className="text-fg">
                {ops.last_cycle_at
                  ? formatRelative(String(ops.last_cycle_at))
                  : ops.updated_at
                    ? formatRelative(String(ops.updated_at))
                    : "not yet"}
              </span>
            </p>
            <p>
              Harvested{" "}
              <span className="tabular text-fg">
                {Number(ops.harvested ?? ops.harvest_count ?? 0)}
              </span>{" "}
              · submitted{" "}
              <span className="tabular text-fg">
                {Number(ops.submitted ?? ops.submit_count ?? 0)}
              </span>
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={running}
              onClick={() => void runNow()}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Run growth cycle
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Submit listing URL</CardTitle>
          <CardDescription className="text-xs">
            Agent card or MCP server URL
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/.well-known/agent.json"
            className="min-w-0 flex-1"
          />
          <Button size="sm" variant="accent" onClick={() => void submitUrl()}>
            Submit
          </Button>
        </CardContent>
        {msg ? <p className="px-4 pb-3 text-xs text-muted">{msg}</p> : null}
        {s?.scheduler ? (
          <p className="px-4 pb-3 text-[11px] text-subtle">
            Scheduler{" "}
            <Badge variant="default" className="text-[10px]">
              {s.scheduler.enabled ? "on" : "idle"}
            </Badge>
          </p>
        ) : null}
      </Card>
    </div>
  );
}
