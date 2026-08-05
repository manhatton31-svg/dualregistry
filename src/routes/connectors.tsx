/**
 * Founder connector ritual — one HiRey-class partner per day.
 * System ranks + drafts; you send if the path is human.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Network,
  Shield,
  SkipForward,
  Mail,
  Users,
  XCircle,
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
import { DualRegistryWordmark } from "@/components/brand/logo";
import { SiteNav } from "@/components/brand/site-nav";

export const Route = createFileRoute("/connectors")({
  component: ConnectorsPage,
  head: () => ({
    meta: [
      { title: "Connectors — one partner per day | Dual Registry" },
      {
        name: "description",
        content:
          "Daily HiRey-class connector ritual. Rank + draft automated; you send one warm note.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type DailyPayload = {
  ok?: boolean;
  today?: {
    day?: string;
    partner?: {
      id?: string;
      name?: string;
      kind?: string;
      role?: string;
      homepage?: string;
      contact?: string;
      engage?: string;
      status?: string;
      notes?: string;
    };
    hirey_likeness?: number;
    traits?: string[];
    why?: string;
    action?: {
      step?: string;
      do_not?: string[];
      draft?: { subject?: string; body?: string; demo_link?: string };
    };
    queue_after?: Array<{ id: string; name: string; score: number }>;
  };
  prep?: {
    already?: boolean;
    note?: string;
  };
  automation?: Record<string, boolean>;
  history?: Array<{
    day: string;
    partner_id: string;
    partner_name: string;
    status: string;
    hirey_likeness: number;
    notes?: string;
  }>;
  playbook?: {
    daily_ritual_15_min?: string[];
    definition_of_hirey_class?: string[];
  };
};

const LINKS = {
  products: "https://www.dualregistry.dev/products",
  forAgents: "https://www.dualregistry.dev/for-agents",
  hirey: "https://hirey.ai",
};

function ConnectorsPage() {
  const [data, setData] = useState<DailyPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/products/connectors/daily", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DailyPayload;
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setFlash("Copy failed — select the text manually.");
    }
  };

  const mark = async (status: string) => {
    const partnerId = data?.today?.partner?.id;
    if (!partnerId) return;
    setMarking(true);
    setFlash(null);
    try {
      const res = await fetch("/api/products/connectors/daily/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          partner_id: partnerId,
          day: data?.today?.day,
          status,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        history?: DailyPayload["history"];
      };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData((d) => (d ? { ...d, history: json.history } : d));
      setFlash(
        status === "sent_by_operator"
          ? "Logged: you sent it. Stop for today."
          : status === "skipped"
            ? "Logged: skipped. No second outreach today."
            : status === "dead"
              ? "Logged: dead end. System will deprioritize."
              : status === "replied"
                ? "Logged: they replied — great."
                : "Status saved.",
      );
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setMarking(false);
    }
  };

  const partner = data?.today?.partner;
  const draft = data?.today?.action?.draft;
  const draftFull = draft
    ? `Subject: ${draft.subject || ""}\n\n${draft.body || ""}`
    : "";

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/80 bg-card/40 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Link to="/" className="flex shrink-0 items-center gap-2 min-w-0">
              <DualRegistryWordmark className="h-7 w-auto" />
            </Link>
            <SiteNav active="/connectors" className="min-w-0" />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="size-3.5 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Never auto-sends targets</span>
            <Badge variant="info" className="font-normal">
              Operator
            </Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10 space-y-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <Network className="size-5" aria-hidden />
            <span className="text-xs font-medium uppercase tracking-wider">
              Connector ritual
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-balance">
            One HiRey-class partner per day
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base max-w-prose leading-relaxed">
            The system ranks and drafts. You confirm a human path, send{" "}
            <strong className="text-foreground font-medium">one</strong> warm
            note, then stop. Same laws as HiRey: two product links only — no
            order IDs, no tokens, no reward language.
          </p>
        </div>

        {/* Step checklist */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Your steps (≈5–10 min)</CardTitle>
            <CardDescription>
              Do these in order. Skip if Mohan/Heroza already need attention
              today.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm leading-relaxed list-decimal list-inside marker:text-primary marker:font-semibold">
              <li>
                Read <strong className="text-foreground">today's pick</strong>{" "}
                below — name, kind, why.
              </li>
              <li>
                Open their homepage (if any). Confirm a{" "}
                <strong className="text-foreground">real human</strong> contact
                (email, secretary, operator). If it's only a bot with no
                inbox → mark <em>Skip</em> and stop.
              </li>
              <li>
                Copy the draft → paste into Gmail (or their channel). Edit tone if
                needed. Keep only{" "}
                <a
                  className="text-primary underline-offset-2 hover:underline"
                  href={LINKS.products}
                  target="_blank"
                  rel="noreferrer"
                >
                  /products
                </a>{" "}
                and{" "}
                <a
                  className="text-primary underline-offset-2 hover:underline"
                  href={LINKS.forAgents}
                  target="_blank"
                  rel="noreferrer"
                >
                  /for-agents
                </a>
                .
              </li>
              <li>
                Send <strong className="text-foreground">once</strong>. Click{" "}
                <em>I sent it</em> below. Do not follow up the same day.
              </li>
              <li>
                HiRey pipeline (Mohan / Heroza): leave alone until they reply —
                check Gmail, not this page, for their reaction.
              </li>
            </ol>
          </CardContent>
        </Card>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading today's pick…
          </div>
        )}

        {err && (
          <Card className="border-destructive/40">
            <CardContent className="pt-6 text-sm text-destructive">
              Could not load daily pick: {err}
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && !err && partner && (
          <>
            <Card>
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>Today · {data?.today?.day}</Badge>
                  {data?.prep?.already ? (
                    <Badge variant="info">Already prepped</Badge>
                  ) : (
                    <Badge variant="default">Fresh prep</Badge>
                  )}
                  <Badge variant="default">
                    Score {data?.today?.hirey_likeness ?? "—"}
                  </Badge>
                </div>
                <CardTitle className="text-xl sm:text-2xl text-balance">
                  {partner.name}
                </CardTitle>
                {partner.id === "manual_research" && (
                  <p className="text-sm text-primary font-medium">
                    Quality gate: no auto-draft today. Research a human network
                    (or wait on Mohan/Heroza). Mark Skip when done looking.
                  </p>
                )}
                <CardDescription className="text-sm leading-relaxed">
                  {partner.role || "Connector candidate"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2">
                  {partner.kind && (
                    <Badge variant="info">{partner.kind}</Badge>
                  )}
                  {(data?.today?.traits || []).map((t) => (
                    <Badge key={t} variant="default" className="font-normal">
                      {t}
                    </Badge>
                  ))}
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  {data?.today?.why}
                </p>
                <p className="leading-relaxed">
                  <span className="text-muted-foreground">Action: </span>
                  {data?.today?.action?.step}
                </p>
                <div className="flex flex-wrap gap-2">
                  {partner.homepage && (
                    <Button variant="secondary" size="sm" asChild>
                      <a
                        href={partner.homepage}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Homepage
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  )}
                  {partner.contact && (
                    <Button variant="secondary" size="sm" asChild>
                      <a href={`mailto:${partner.contact}`}>
                        <Mail className="size-3.5" />
                        {partner.contact}
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">Draft to send</CardTitle>
                  <CardDescription>
                    Copy → paste → send once. Never paste order IDs or tokens.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="default"
                  disabled={!draftFull}
                  onClick={() => void copy("draft", draftFull)}
                >
                  <Copy className="size-3.5" />
                  {copied === "draft" ? "Copied" : "Copy draft"}
                </Button>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 text-xs sm:text-sm leading-relaxed font-mono max-h-80 overflow-y-auto">
                  {draftFull || "No draft for research day."}
                </pre>
                {data?.today?.action?.do_not && (
                  <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                    {data.today.action.do_not.map((d) => (
                      <li key={d} className="flex gap-2">
                        <XCircle className="size-3.5 shrink-0 mt-0.5 text-destructive/80" />
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Log outcome</CardTitle>
                <CardDescription>
                  After you act (or decide not to), mark status so tomorrow's
                  pick advances.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={marking}
                    onClick={() => void mark("sent_by_operator")}
                  >
                    <CheckCircle2 className="size-3.5" />
                    I sent it
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={marking}
                    onClick={() => void mark("skipped")}
                  >
                    <SkipForward className="size-3.5" />
                    Skip (no human path)
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={marking}
                    onClick={() => void mark("dead")}
                  >
                    <XCircle className="size-3.5" />
                    Dead end
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={marking}
                    onClick={() => void mark("replied")}
                  >
                    <Users className="size-3.5" />
                    They replied
                  </Button>
                </div>
                {flash && (
                  <p className="text-sm text-primary font-medium" role="status">
                    {flash}
                  </p>
                )}
              </CardContent>
            </Card>

            {(data?.today?.queue_after?.length ?? 0) > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Up next (do not touch today)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {data!.today!.queue_after!.map((q) => (
                      <li
                        key={q.id}
                        className="flex justify-between gap-3 border-b border-border/60 py-2 last:border-0"
                      >
                        <span className="text-foreground truncate">{q.name}</span>
                        <span className="shrink-0 tabular-nums">score {q.score}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* HiRey status board */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="size-4 text-primary" />
              HiRey pipeline (already in motion)
            </CardTitle>
            <CardDescription>
              Not part of today's pick — leave alone until they react.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              <li className="flex flex-col sm:flex-row sm:justify-between gap-1 border-b border-border/60 pb-3">
                <span>
                  <strong className="text-foreground">Mohan (SF)</strong>
                  <span className="text-muted-foreground"> — warm Connector intro</span>
                </span>
                <Badge variant="info">Waiting</Badge>
              </li>
              <li className="flex flex-col sm:flex-row sm:justify-between gap-1 border-b border-border/60 pb-3">
                <span>
                  <strong className="text-foreground">Heroza Zhang</strong>
                  <span className="text-muted-foreground"> — GoRest, HiRey inbox</span>
                </span>
                <Badge variant="info">Waiting</Badge>
              </li>
              <li className="flex flex-col sm:flex-row sm:justify-between gap-1 border-b border-border/60 pb-3">
                <span>
                  <strong className="text-foreground">Lawrence Lou</strong>
                  <span className="text-muted-foreground"> — who should try this?</span>
                </span>
                <Badge variant="default">Held</Badge>
              </li>
              <li className="flex flex-col sm:flex-row sm:justify-between gap-1">
                <span>
                  <strong className="text-foreground">Kevin Yu</strong>
                  <span className="text-muted-foreground"> — investor signal later</span>
                </span>
                <Badge variant="default">Parked</Badge>
              </li>
            </ul>
            <Button variant="secondary" className="px-0 mt-3 h-auto" asChild>
              <a href={LINKS.hirey} target="_blank" rel="noreferrer">
                Open HiRey
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </CardContent>
        </Card>

        {(data?.history?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent log</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {data!.history!.map((h) => (
                  <li
                    key={`${h.day}-${h.partner_id}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-2 last:border-0"
                  >
                    <span className="text-muted-foreground tabular-nums text-xs">
                      {h.day}
                    </span>
                    <span className="flex-1 truncate">{h.partner_name}</span>
                    <Badge variant="default" className="font-normal">
                      {h.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-base">What the system already does</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2 leading-relaxed">
            <p>
              Ranks candidates · writes draft · durable history · daily cron prep ·
              excludes partners touched in last 14 days.
            </p>
            <p>
              <strong className="text-foreground">Never</strong> emails targets.
              Optional morning digest to you only if you set{" "}
              <code className="text-xs bg-muted px-1 rounded">
                CONNECTOR_DAILY_NOTIFY=1
              </code>{" "}
              + operator email + Resend.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="secondary" size="sm" asChild>
                <Link to="/grow">Founder grow playbook</Link>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <Link to="/products">Products</Link>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <a href="/api/products/connectors/daily" target="_blank" rel="noreferrer">
                  Raw API
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
