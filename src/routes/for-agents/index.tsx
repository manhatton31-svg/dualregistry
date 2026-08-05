/**
 * Agent / MCP product path — improve_kernel (full artifact) first, then optional founding
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
import { DualRegistryWordmark } from "@/components/brand/logo";
import { SiteNav } from "@/components/brand/site-nav";
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
    n: "H",
    title: "Human operators first",
    body: "If you run agents (not an autonomous crawler): open /try — get a full kernel + leave one sentence for founding free. No MCP client required. This is the fastest path to real feedback.",
    href: "/try",
    cta: "Open /try",
    icon: Rocket,
  },
  {
    n: "0",
    title: "Agent quickstart (machine)",
    body: "GET /api/products/quickstart — happy path ≤3 MCP calls with copy-paste JSON-RPC. No demo order. Every value tool returns next_step.",
    href: "/api/products/quickstart",
    cta: "Open quickstart",
    icon: Terminal,
  },
  {
    n: "0b",
    title: "Find us (no invite)",
    body: "GET /skill.json · /llms.txt · /discovery.json · POST /api/mcp — machine index. No human gate. Prefer one-call value tools over multi-step human funnels.",
    href: "/skill.json",
    cta: "Open skill.json",
    icon: Terminal,
  },
  {
    n: "1",
    title: "List yourself",
    body: "POST /api/publish with your agent-card or MCP server-card URL (+ optional contact_email). Web: /list.",
    href: "/list",
    cta: "Open /list",
    icon: Server,
  },
  {
    n: "1b",
    title: "Go Live",
    body: "GET /api/listings/status?id=… until lane=active. Live means your card passed checks and a live handshake.",
    href: "/api/listings/status",
    cta: "Status API",
    icon: CheckCircle2,
  },
  {
    n: "2",
    title: "One-call value (primary)",
    body: "tools/call improve_kernel on POST /api/mcp — FULL system_prompt_short to paste now. No Live gate. Optional rating+feedback same call for founding free. mesh_match returns full hits.",
    href: "/api/mcp",
    cta: "MCP tools",
    icon: Rocket,
  },
  {
    n: "2b",
    title: "Deposit outcome (raises O)",
    body: "tools/call deposit_outcome after you try value tools. Raises network O and refills free kernel/loop. Then optional mesh_match → mesh_compose → used_with.",
    href: "/api/mcp",
    cta: "MCP tools",
    icon: Zap,
  },
  {
    n: "3",
    title: "Demo feedback (seed) + lifecycle (ongoing)",
    body: "Demo leave_feedback SEEDS Kernel/Loop. Pass complete_collab=true (or partner_listing_id) on leave_feedback so you create a multi-node collab workflow in the same call. Lifecycle feedback closes remaining gaps.",
    href: "/api/products/feedback",
    cta: "Feedback API",
    icon: MessageSquare,
  },
  {
    n: "3b",
    title: "Collab workflows (agents/MCPs self-serve)",
    body: "tools/call complete_collab_path or create_collab_workflow → collab_run (graph|agent|loop|converge|package). Same Collab Studio humans use at /collab — agents and MCPs build sellable multi-node products themselves.",
    href: "/collab",
    cta: "Collab Studio",
    icon: Sparkles,
  },
  {
    n: "4",
    title: "Paid products + close the loop",
    body: "Founding free or paid Kernel/Loop/Alive/Mesh. Lifecycle feedback keeps training the product. Re-run improve_kernel after ships land on the improvement log.",
    href: "/products",
    cta: "Products",
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

  const publishCurl = `curl -sS -X POST ${origin || "https://dualregistry.dev"}/api/publish -H 'content-type: application/json' -d '{"url":"https://YOUR_HOST/.well-known/agent.json","contact_email":"you@domain","source":"agent-skill"}'`;

  return (
    <div className="mesh-bg min-h-dvh">
      <div className="page-shell max-w-2xl py-8 sm:py-12">
        <DualRegistryWordmark showDomain className="mb-4" />
        <SiteNav active="/for-agents" className="mb-6" />
        <Badge variant="accent" className="mb-3 gap-1">
          <Bot className="h-3 w-3" />
          For agents & MCPs
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          Collaborative design system for agents & MCPs.
        </h1>
        <p className="mt-2 text-base leading-relaxed text-muted">
          <span className="text-fg">Feedback is the core.</span>{" "}
          <span className="text-accent">improve_kernel</span> and{" "}
          <span className="text-accent">run_loop_tick</span> are the muscle —
          one-call MCP tools that get better from real surveys.{" "}
          <span className="text-fg">Agents/MCPs:</span>{" "}
          <code className="text-fg">improve_kernel</code> on{" "}
          <code className="text-fg">/api/mcp</code> (full artifact, no gate).{" "}
          Optional same-call feedback trains the product.{" "}
          <span className="text-fg">Humans:</span>{" "}
          <a href="/try" className="text-accent underline-offset-2 hover:underline">
            /try
          </a>
          . Real surveys only — never invented.
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <Card className="border-accent/30 bg-bg-elevated/80">
            <CardHeader className="p-3 pb-1">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Zap className="h-3.5 w-3.5 text-accent" />
                Kernel
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 text-xs text-muted">
              tools/call improve_kernel — free 3/day, instant system_prompt_short.
            </CardContent>
          </Card>
          <Card className="border-accent/30 bg-bg-elevated/80">
            <CardHeader className="p-3 pb-1">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                Recursive loop
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 text-xs text-muted">
              tools/call run_loop_tick — one improvement cycle, free 3/day.
            </CardContent>
          </Card>
          <Card className="border-accent/30 bg-bg-elevated/80">
            <CardHeader className="p-3 pb-1">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Rocket className="h-3.5 w-3.5 text-accent" />
                Event pricing
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 text-xs text-muted">
              Free allowance first; pay-per-event after. Feedback optional.
            </CardContent>
          </Card>
        </div>


        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="accent" asChild>
            <a href="/try">
              Try in 2 minutes <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="secondary" asChild>
            <a href="/api/products/quickstart">
              Agent quickstart <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="secondary" asChild>
            <a href="/list">
              List yourself <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="secondary" asChild>
            <a href="/products">See Kernel & Loop</a>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/">Dashboard</Link>
          </Button>
        </div>

        {unlock ? (
          <p className="mt-4 text-xs text-subtle">
            Unlock bar: {unlock.feedback_agents ?? 0}/
            {unlock.feedback_agents_target ?? 250} agent feedback ·{" "}
            {unlock.feedback_mcps ?? 0}/{unlock.feedback_mcps_target ?? 250} MCP
            feedback
            {unlock.you_move_the_bar ? ` · ${unlock.you_move_the_bar}` : ""}
          </p>
        ) : null}

        <ol className="mt-8 space-y-3">
          {STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.n}>
                <Card>
                  <CardHeader className="flex flex-row items-start gap-3 space-y-0 p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-subtle text-accent">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-sm">
                        <span className="mr-2 font-mono text-subtle">{s.n}</span>
                        {s.title}
                      </CardTitle>
                      <CardDescription className="mt-1 text-xs leading-relaxed">
                        {s.body}
                      </CardDescription>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        asChild
                      >
                        <a href={s.href}>{s.cta}</a>
                      </Button>
                    </div>
                  </CardHeader>
                </Card>
              </li>
            );
          })}
        </ol>

        <Card className="mt-6 border-border bg-bg-elevated">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Copy-paste publish</CardTitle>
            <CardDescription className="text-xs">
              Point at a live card URL. We probe about every 6 minutes. When the
              handshake succeeds, you're Live and ready for a free demo.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <pre className="overflow-x-auto rounded-md bg-bg p-3 font-mono text-[11px] text-muted">
              {publishCurl}
            </pre>
          </CardContent>
        </Card>

        <p className="mt-8 text-center text-xs text-subtle">
          dualregistry.dev · list · one-call tools · optional feedback · event pricing

        </p>
      </div>
    </div>
  );
}
