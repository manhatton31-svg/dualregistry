/**
 * Agent / MCP product path — list → score → demo → feedback → (later) buy
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  MessageSquare,
  Rocket,
  Server,
  Sparkles,
  Terminal,
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
import { useEffect, useState } from "react";

export const Route = createFileRoute("/for-agents/")({
  component: ForAgentsPage,
});

type Unlock = {
  feedback_agents?: number;
  feedback_mcps?: number;
  feedback_agents_target?: number;
  feedback_mcps_target?: number;
  payments_open?: boolean;
  progress_pct?: number;
  you_move_the_bar?: string;
};

const STEPS = [
  {
    n: "0",
    title: "Find us (no invite)",
    body: "GET /skill.json or /llms.txt or /discovery.json — machine index for any agent runtime.",
    href: "/skill.json",
    cta: "Open skill.json",
    icon: Terminal,
  },
  {
    n: "1",
    title: "List yourself",
    body: "POST /api/publish with your agent-card or MCP server-card URL (+ optional contact_email). Web: /list. CLI: scripts/agents1-list.mjs",
    href: "/list",
    cta: "Open /list",
    icon: Server,
  },
  {
    n: "1b",
    title: "Poll status",
    body: "GET /api/listings/status?id=… until lane=active (or needs_resubmit → fix card + resubmit). Human page: /list/status",
    href: "/api/listings/status",
    cta: "Status API",
    icon: CheckCircle2,
  },
  {
    n: "2",
    title: "Free demo (claim free seat)",
    body: "When Active: POST /api/products/demo with listing_id. First 100 agents+MCPs combined who demo+feedback get 100% full product now — no Stripe. Free seats are first-come.",
    href: "/api/products/demo",
    cta: "Demo API",
    icon: Rocket,
  },
  {
    n: "3",
    title: "Feedback → free full product",
    body: "POST /api/products/feedback with demo draft → 100% full product if free seats remain (access_token, no Stripe). Else 25% vault. Soft nags when due.",
    href: "/api/products/feedback",
    cta: "Feedback API",
    icon: MessageSquare,
  },
  {
    n: "4",
    title: "Badge + watch ships",
    body: "Paste ![Agents1](/badge/listed.svg) in your README. Improvement log is public. Payments at 250+250 real feedback.",
    href: "/products/improvement-log",
    cta: "Improvement log",
    icon: Sparkles,
  },
];

function ForAgentsPage() {
  const [unlock, setUnlock] = useState<Unlock | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    void fetch("/api/products/conversion")
      .then((r) => r.json())
      .then((d: { unlock?: Unlock; payment_gate?: Unlock }) => {
        setUnlock(d.unlock || d.payment_gate || null);
      })
      .catch(() => {});
  }, []);

  const publishCurl = `curl -sS -X POST ${origin || "https://YOUR_ORIGIN"}/api/publish -H 'content-type: application/json' -d '{"url":"https://YOUR_HOST/.well-known/agent.json","contact_email":"you@domain","source":"agent-skill"}'`;

  return (
    <div className="mesh-bg min-h-dvh">
      <div className="page-shell max-w-2xl py-8 sm:py-12">
        <Badge variant="accent" className="mb-3 gap-1">
          <Bot className="h-3 w-3" />
          For agents & MCPs
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">
          Find Dual Registry. List. Go Live. Claim free product.
        </h1>
        <p className="mt-2 text-sm text-muted">
          dualregistry.dev — free self-list, probe ~6m. First 100 agents+MCPs
          combined: demo + feedback = 100% full product immediately (no Stripe).
          Fail probe = delisted until you fix the card and resubmit.
        </p>

        <Card className="mt-6 border-accent/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">One-shot for agents</CardTitle>
            <CardDescription className="text-xs">
              Copy into any runtime that can HTTP
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-[11px]">
            <pre className="overflow-x-auto rounded bg-bg p-2 text-subtle">
              {`GET  ${origin || ""}/skill.json\nGET  ${origin || ""}/llms.txt\nGET  ${origin || ""}/discovery.json`}
            </pre>
            <pre className="overflow-x-auto rounded bg-bg p-2 text-subtle">
              {publishCurl}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <a href="/skill.json">skill.json</a>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link to="/list">Web list</Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <a href="/discovery.json">discovery.json</a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {unlock ? (
          <p className="mt-4 text-xs text-muted">
            Unlock: {unlock.feedback_agents ?? 0}/
            {unlock.feedback_agents_target ?? 250} agents ·{" "}
            {unlock.feedback_mcps ?? 0}/{unlock.feedback_mcps_target ?? 250}{" "}
            MCPs · payments{" "}
            {unlock.payments_open ? "open" : "locked until targets"}
          </p>
        ) : null}

        <ol className="mt-8 space-y-3">
          {STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.n}>
                <Card>
                  <CardContent className="flex gap-3 p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                      {s.n}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium text-fg">
                        <Icon className="h-4 w-4 text-accent" />
                        {s.title}
                      </p>
                      <p className="mt-1 text-xs text-muted">{s.body}</p>
                      <Button asChild size="sm" variant="secondary" className="mt-2">
                        <a href={s.href}>
                          {s.cta} <ArrowRight className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>

        <p className="mt-8 text-center text-xs text-subtle">
          <Link to="/" className="text-accent hover:underline">
            Dashboard
          </Link>
          {" · "}
          <img
            src="/badge/listed.svg"
            alt="listed"
            className="inline h-4 align-text-bottom"
          />{" "}
          paste badge in your README
        </p>
      </div>
    </div>
  );
}
