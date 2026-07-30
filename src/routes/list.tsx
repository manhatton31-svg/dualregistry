import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Loader2,
  MessageSquare,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { submitListingByUrl } from "@/lib/agents1/api";
import type { SubmitByUrlResult } from "@/lib/agents1/growth";
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
import { FeedbackSurvey } from "@/components/products/feedback-survey";

export const Route = createFileRoute("/list")({
  component: ListPage,
});

type ScoreResult = {
  ok: boolean;
  kind?: string;
  score?: number;
  handshake?: string;
  auto_approve_likely?: boolean;
  list_hint?: string;
  name?: string;
  signals?: string[];
  message?: string;
  product_boost?: number;
  product_badge?: string | null;
  product_upsell?: string;
};

type ConversionPath = {
  message?: string;
  recommended_price?: string;
  recommended_sku?: string;
  founding?: {
    urgency?: string;
    seats_remaining_in_tier?: number | null;
    tier_label?: string;
  };
  steps?: Array<{
    id: string;
    title: string;
    method: string;
    path: string;
    body?: Record<string, unknown>;
    note: string;
  }>;
  agent_buy?: { endpoint: string; example: Record<string, unknown> };
  human_url?: string;
  feedback?: { endpoint: string; note: string };
};

type PublishResult = SubmitByUrlResult & {
  install_snippets?: { vscode: string; cursor: string; claude: string };
  quality?: { approvalLikelihood: number; pass: boolean };
  conversion?: ConversionPath;
  listing_id?: string;
  status_url?: string;
  claim_url?: string;
  badge_markdown?: string;
  poll_hint?: string;
  skill_url?: string;
  next_agent?: string;
};

function ListPage() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [publish, setPublish] = useState<PublishResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [base, setBase] = useState("");
  const [conversion, setConversion] = useState<ConversionPath | null>(null);

  useEffect(() => {
    setBase(window.location.origin);
    void fetch("/api/products/conversion")
      .then((r) => r.json())
      .then((d: { conversion?: ConversionPath }) => {
        if (d.conversion) setConversion(d.conversion);
      })
      .catch(() => {});
  }, []);

  const dualCurl = `curl -X POST ${base || "https://YOUR_AGENTS1_ORIGIN"}/api/publish -H 'content-type: application/json' -d '{"url":"https://yoursite.com/.well-known/agent.json","contact_email":"you@domain","source":"agent-skill"}'`;
  const scoreCurl = `curl "${base || "https://YOUR_AGENTS1_ORIGIN"}/api/score?url=https://yoursite.com/.well-known/agent.json"`;
  const skillCurl = `curl -sS ${base || "https://YOUR_AGENTS1_ORIGIN"}/skill.json`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMsg(null);
    setPublish(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          contact_email: email.trim() || undefined,
          source: "list-page",
        }),
      });
      const r = (await res.json()) as PublishResult;
      setPublish(r);
      setMsg(r.message);
      if (r.conversion) setConversion(r.conversion);
      if (r.ok) setUrl("");
    } catch (err) {
      try {
        const r = (await submitListingByUrl({
          data: { url: url.trim() },
        })) as SubmitByUrlResult;
        setMsg(r.message);
        if (r.ok) setUrl("");
      } catch (e2) {
        setMsg(e2 instanceof Error ? e2.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onScore() {
    if (!url.trim()) return;
    setScoreBusy(true);
    setScore(null);
    try {
      const res = await fetch(
        `/api/score?url=${encodeURIComponent(url.trim())}`,
      );
      setScore((await res.json()) as ScoreResult);
    } catch (e) {
      setScore({
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setScoreBusy(false);
    }
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* */
    }
  }

  const shownConversion = publish?.conversion || conversion;

  return (
    <div className="mesh-bg min-h-dvh">
      <div className="page-shell relative max-w-2xl py-6 sm:py-10">
        <p className="mb-4 text-center text-xs text-muted">
          Agents:{" "}
          <a href="/skill.json" className="text-accent hover:underline">
            /skill.json
          </a>{" "}
          ·{" "}
          <a href="/llms.txt" className="text-accent hover:underline">
            /llms.txt
          </a>{" "}
          ·{" "}
          <a href="/discovery.json" className="text-accent hover:underline">
            /discovery.json
          </a>
        </p>

        <Badge variant="accent" className="mb-4 gap-1">
          <Rocket className="h-3 w-3" />
          Agents1 · free self-list
        </Badge>
        <h1 className="text-3xl font-semibold text-fg">
          List your agent or MCP
        </h1>
        <p className="mt-2 text-sm text-muted">
          Independent inbound path — no invite required. We probe within ~6
          minutes. <strong className="text-fg">Live</strong> = checks clean +
          probe ok. Fail = delisted until you fix the card and resubmit.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <img src="/badge/listed.svg" alt="Listed" className="h-5" />
          <img src="/badge/agents" alt="Agents1" className="h-5" />
          <img src="/badge/mcp" alt="MCP" className="h-5" />
        </div>

        <Card className="mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Submit card URL</CardTitle>
            <CardDescription>
              Agent card, MCP server-card, or server.json URL. Optional email
              for claim notice after probe-ok.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-3">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yoursite.com/.well-known/agent.json"
                className="font-mono text-sm"
              />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@you.dev (optional — claim after Live)"
                className="text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || !url.trim()}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                  List free
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={scoreBusy || !url.trim()}
                  onClick={() => void onScore()}
                >
                  {scoreBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Score only
                </Button>
              </div>
            </form>
            {msg ? (
              <p className="mt-3 text-sm text-muted">
                {publish?.ok ? (
                  <CheckCircle2 className="mr-1 inline h-4 w-4 text-success" />
                ) : null}
                {msg}
              </p>
            ) : null}
            {publish?.ok && (publish.claim_url || publish.listing_id) ? (
              <div className="mt-4 space-y-2 rounded border border-accent/30 bg-accent-dim/10 p-3 text-xs">
                <p className="font-medium text-fg">
                  Submitted — track status (auto-polls)
                </p>
                {publish.listing_id ? (
                  <p className="font-mono text-subtle">
                    listing_id: {publish.listing_id}
                  </p>
                ) : null}
                <p className="text-muted">{publish.poll_hint}</p>
                <div className="flex flex-wrap gap-2">
                  {publish.claim_url ? (
                    <Button asChild size="sm">
                      <a href={publish.claim_url}>Open status / claim</a>
                    </Button>
                  ) : null}
                  {publish.badge_markdown ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void copyText("badge", publish.badge_markdown || "")
                      }
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied === "badge" ? "Copied" : "Copy badge"}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {score ? (
              <p className="mt-3 text-xs text-muted">
                Score: {score.score ?? "—"} · {score.handshake || score.message}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Terminal className="h-4 w-4" />
              Agent one-shot
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[11px] text-muted">
            <pre className="overflow-x-auto rounded bg-bg p-2 text-subtle">
              {skillCurl}
            </pre>
            <pre className="overflow-x-auto rounded bg-bg p-2 text-subtle">
              {dualCurl}
            </pre>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void copyText("curl", dualCurl)}
            >
              <Copy className="h-3.5 w-3.5" />
              {copied === "curl" ? "Copied" : "Copy publish curl"}
            </Button>
            <p>
              Score: <code className="text-accent">{scoreCurl}</code>
            </p>
          </CardContent>
        </Card>

        {shownConversion?.founding ? (
          <Card className="mt-6 border-accent/40 bg-accent-dim/10">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-accent" />
                After you list
              </CardTitle>
              <CardDescription>
                {shownConversion.founding.tier_label} ·{" "}
                {shownConversion.founding.urgency}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-muted">
              <p className="text-fg">{shownConversion.message}</p>
              <ol className="list-decimal space-y-1 pl-4">
                {(shownConversion.steps || []).map((s) => (
                  <li key={s.id}>
                    <strong className="text-fg">{s.title}</strong> — {s.note}
                    <div className="mt-0.5 font-mono text-[10px] text-subtle">
                      {s.method} {s.path}
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3 text-sm">
          <Link to="/for-agents" className="text-accent hover:underline">
            Agent path →
          </Link>
          <Link to="/" className="text-muted hover:underline">
            Dashboard
          </Link>
          <a href="/skill.json" className="text-muted hover:underline">
            skill.json
          </a>
        </div>

        <div className="mt-10">
          <FeedbackSurvey source="list_page" />
        </div>
      </div>
    </div>
  );
}
