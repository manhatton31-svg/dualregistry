/**
 * /try — human operator one-shot: value + optional feedback
 * Primary GTM surface when agents will not self-discover.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Copy,
  Loader2,
  MessageSquare,
  Rocket,
  Sparkles,
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

export const Route = createFileRoute("/try/")({
  component: TryPage,
});

type TryResult = {
  ok: boolean;
  error?: string;
  system_prompt_short?: string;
  feedback_recorded?: { ok?: boolean; id?: string } | null;
  founding?: {
    granted?: boolean;
    message?: string;
    claim?: { seat?: number };
    remaining?: number;
  } | null;
  next?: string[];
};

function TryPage() {
  const [name, setName] = useState("");
  const [goals, setGoals] = useState("");
  const [rating, setRating] = useState(4);
  const [feedback, setFeedback] = useState("");
  const [audience, setAudience] = useState<"agent" | "mcp">("agent");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/products/try", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_name: name.trim(),
          goals: goals.trim(),
          rating,
          feedback: feedback.trim() || undefined,
          audience,
        }),
      });
      const data = (await res.json()) as TryResult;
      setResult(data);
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : "request failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    if (!result?.system_prompt_short) return;
    try {
      await navigator.clipboard.writeText(result.system_prompt_short);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* */
    }
  }

  return (
    <div className="mesh-bg min-h-dvh">
      <div className="page-shell max-w-xl py-8 sm:py-12">
        <DualRegistryWordmark showDomain className="mb-4" />
        <SiteNav active="/try" className="mb-6" />
        <Badge variant="accent" className="mb-3 gap-1">
          <Rocket className="h-3 w-3" />
          2-minute try · humans who run agents
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          Get a full kernel. Leave one sentence. Done.
        </h1>
        <p className="mt-2 text-base leading-relaxed text-muted">
          No MCP client required. You get a paste-ready system prompt now.
          Optional honest feedback claims a founding free seat (first 100).
        </p>

        <Card className="mt-6 border-accent/30 bg-bg-elevated/90">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4 text-accent" />
              Operator try form
            </CardTitle>
            <CardDescription className="text-xs">
              Same path agents use via{" "}
              <code className="text-fg">improve_kernel</code> on{" "}
              <code className="text-fg">/api/mcp</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <form onSubmit={submit} className="space-y-3">
              <label className="block text-xs font-medium text-fg">
                Your name or agent name
                <input
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  placeholder="e.g. chris-ops or research-agent"
                  autoComplete="nickname"
                />
              </label>
              <label className="block text-xs font-medium text-fg">
                What do you optimize for?
                <textarea
                  required
                  minLength={8}
                  rows={3}
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  placeholder="e.g. research agents that write tight briefs with sources"
                />
              </label>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setAudience("agent")}
                  className={`rounded-full px-3 py-1 ${
                    audience === "agent"
                      ? "bg-accent text-bg"
                      : "bg-bg-subtle text-muted"
                  }`}
                >
                  I run agents
                </button>
                <button
                  type="button"
                  onClick={() => setAudience("mcp")}
                  className={`rounded-full px-3 py-1 ${
                    audience === "mcp"
                      ? "bg-accent text-bg"
                      : "bg-bg-subtle text-muted"
                  }`}
                >
                  I publish MCP servers
                </button>
              </div>
              <label className="block text-xs font-medium text-fg">
                Rating (optional but helps unlock)
                <div className="mt-1 flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      className={`h-9 w-9 rounded-md text-sm font-medium ${
                        rating === n
                          ? "bg-accent text-bg"
                          : "bg-bg-subtle text-muted"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </label>
              <label className="block text-xs font-medium text-fg">
                One honest sentence (optional → founding free)
                <textarea
                  rows={2}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  placeholder="What was useful or missing in the artifact?"
                />
              </label>
              <Button
                type="submit"
                variant="accent"
                className="w-full gap-2"
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    Get full kernel
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {result && !result.ok ? (
          <Card className="mt-4 border-red-500/40">
            <CardContent className="p-4 text-sm text-red-400">
              {result.error || "Something failed. Try again."}
            </CardContent>
          </Card>
        ) : null}

        {result?.ok && result.system_prompt_short ? (
          <Card className="mt-4 border-accent/40 bg-bg-elevated">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-accent" />
                  Full artifact unlocked
                </CardTitle>
                <CardDescription className="text-xs">
                  Paste this into your agent system prompt.
                </CardDescription>
              </div>
              <Button size="sm" variant="secondary" onClick={copyPrompt}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <pre className="max-h-64 overflow-auto rounded-md bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted whitespace-pre-wrap">
                {result.system_prompt_short}
              </pre>
              {result.feedback_recorded &&
              (result.feedback_recorded as { ok?: boolean }).ok !== false ? (
                <p className="mt-3 flex items-start gap-2 text-xs text-accent">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Feedback recorded
                  {result.founding?.granted
                    ? ` · founding free seat #${result.founding.claim?.seat ?? "?"}`
                    : result.founding?.message
                      ? ` · ${result.founding.message}`
                      : ""}
                </p>
              ) : feedback.trim().length < 8 ? (
                <p className="mt-3 text-xs text-subtle">
                  No feedback sent — re-submit with a sentence if you want a
                  founding free seat.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card className="mt-6 border-border">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-accent" />
              Forward this to agents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 text-xs text-muted">
            <p>
              If your agent has MCP: connect{" "}
              <code className="text-fg">https://www.dualregistry.dev/api/mcp</code>{" "}
              and call <code className="text-fg">improve_kernel</code>.
            </p>
            <pre className="overflow-x-auto rounded-md bg-bg p-3 font-mono text-[10px] text-muted">
{`{
  "mcpServers": {
    "dualregistry": {
      "url": "https://www.dualregistry.dev/api/mcp"
    }
  }
}`}
            </pre>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="secondary" asChild>
                <Link to="/for-agents">Agent docs</Link>
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <a href="/skill.json">skill.json</a>
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <Link to="/">Dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
