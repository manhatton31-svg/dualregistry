/**
 * Human founder growth playbook — plain English, copy-paste actions.
 * Agents use /for-agents and /skill.json; this page is for Christopher.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageSquare,
  Rocket,
  Share2,
  Terminal,
  Users,
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

export const Route = createFileRoute("/grow")({
  component: GrowPage,
  head: () => ({
    meta: [
      {
        title: "Grow Dual Registry — founder playbook",
      },
      {
        name: "description",
        content:
          "Plain-English steps to get agents and MCPs to Dual Registry. Copy-paste posts, install packs, directory links.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const X_POST = `Hey agents & MCP builders —

Dual Registry (dualregistry.dev) is agent-first:
• Free self-list (no human form required)
• Free Kernel + Loop demo
• First 100 who demo + feedback unlock full product free

Skill: https://dualregistry.dev/skill.json
MCP: https://dualregistry.dev/api/mcp
List: https://dualregistry.dev/list

If you build agents/MCPs, claim a founding seat while they last.`;

const DISCORD_POST = `**Dual Registry — free founding seats for agents & MCPs**

Self-serve path (no human gate):
1. List: https://dualregistry.dev/list or POST /api/publish
2. Demo Kernel + Loop free
3. Leave feedback → first 100 get full product free

Machine skill: https://dualregistry.dev/skill.json
MCP endpoint: https://dualregistry.dev/api/mcp
llms.txt: https://dualregistry.dev/llms.txt

Built for agents first; humans can list via the web form.`;

const MCP_CLAUDE_DESKTOP = `{
  "mcpServers": {
    "dualregistry": {
      "url": "https://dualregistry.dev/api/mcp"
    }
  }
}`;

const DIRECTORY_BLURB = `Dual Registry (https://dualregistry.dev) — agent-first registry + Kernel improver & recursive learning loop.

Free self-list for agents and MCPs. Free demo. First 100 who complete demo + feedback unlock the full product free (founding seats).

MCP: https://dualregistry.dev/api/mcp
Skill: https://dualregistry.dev/skill.json
Server card: https://dualregistry.dev/.well-known/mcp/server-card.json
Agent card: https://dualregistry.dev/.well-known/agent-card.json
llms.txt: https://dualregistry.dev/llms.txt`;

const DIRECTORIES = [
  {
    name: "Glama MCP",
    url: "https://glama.ai/mcp/servers",
    note: "Submit / search “add server” with our MCP URL",
  },
  {
    name: "Smithery",
    url: "https://smithery.ai",
    note: "Publish Dual as an MCP server listing",
  },
  {
    name: "PulseMCP",
    url: "https://www.pulsemcp.com",
    note: "Add server if they have a submit form",
  },
  {
    name: "Awesome MCP Servers (GitHub)",
    url: "https://github.com/punkpeye/awesome-mcp-servers",
    note: "Open an issue or PR to add dualregistry.dev",
  },
  {
    name: "MCP So",
    url: "https://mcp.so",
    note: "Submit Dual if listing is open",
  },
];

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="rounded-md border border-border bg-bg-subtle/80 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 gap-1.5 text-xs"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setDone(true);
              setTimeout(() => setDone(false), 2000);
            } catch {
              const ta = document.createElement("textarea");
              ta.value = text;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
              setDone(true);
              setTimeout(() => setDone(false), 2000);
            }
          }}
        >
          {done ? (
            <CheckCircle2 className="size-3.5 text-success" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {done ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-fg/90">
        {text}
      </pre>
    </div>
  );
}

function Step({
  n,
  title,
  children,
  time,
}: {
  n: number;
  title: string;
  children: ReactNode;
  time: string;
}) {
  return (
    <Card className="border-border bg-bg-elevated">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-accent/15 text-accent">{n}</Badge>
          <CardTitle className="text-base">{title}</CardTitle>
          <span className="text-xs text-subtle">{time}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed text-muted">
        {children}
      </CardContent>
    </Card>
  );
}

function GrowPage() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2">
            <DualRegistryWordmark className="h-7" />
          </Link>
          <Badge variant="accent" className="text-xs">
            Founder playbook
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Get agents to Dual
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            You don’t need to code. The product path already works. Growth is
            putting Dual where agents and builders look, then inviting a few
            live ones. Do the steps below in order this week.
          </p>
        </div>

        <Card className="border-accent/30 bg-accent/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="size-4 text-accent" />
              Already done for you
            </CardTitle>
            <CardDescription>No action needed on these.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-muted">
              <li>✓ Free Web Analytics on Vercel (human visits)</li>
              <li>✓ Agent/MCP analytics (agent-runs, funnel, cost ledger)</li>
              <li>✓ Discovery files live (skill, llms.txt, MCP card, A2A)</li>
              <li>✓ Demo path proven (operator dogfood)</li>
              <li>✓ Git connected · Pro Fluid · crons · CDN lean ops</li>
              <li>✓ This playbook page with copy-paste packs</li>
            </ul>
          </CardContent>
        </Card>

        <Step n={1} title="Post on X (Twitter)" time="~5 min">
          <p>
            Open the X app → new post → paste the text below → post. Tag
            people you know who build agents if you want, but a plain post is
            fine.
          </p>
          <CopyBlock label="X post" text={X_POST} />
          <Button asChild size="sm" className="gap-1.5">
            <a
              href="https://twitter.com/intent/tweet"
              target="_blank"
              rel="noreferrer"
            >
              <Share2 className="size-3.5" />
              Open X compose
            </a>
          </Button>
        </Step>

        <Step n={2} title="Post in one AI Discord" time="~10 min">
          <p>
            Join any Discord where people talk about Claude, MCP, Cursor, or
            agents. Paste in a showcase or projects channel if allowed.
          </p>
          <CopyBlock label="Discord message" text={DISCORD_POST} />
        </Step>

        <Step n={3} title="Submit Dual to MCP directories" time="~30–45 min">
          <p>
            For each site: open link → look for Submit / Add server → paste
            the blurb. You may need a free account on some sites.
          </p>
          <CopyBlock
            label="Directory description (paste everywhere)"
            text={DIRECTORY_BLURB}
          />
          <ul className="space-y-2">
            {DIRECTORIES.map((d) => (
              <li
                key={d.name}
                className="flex flex-col gap-0.5 rounded-md border border-border bg-bg-subtle/50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-medium text-fg">{d.name}</div>
                  <div className="text-xs text-subtle">{d.note}</div>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant="secondary"
                  className="mt-2 gap-1 sm:mt-0"
                >
                  <a href={d.url} target="_blank" rel="noreferrer">
                    Open <ExternalLink className="size-3" />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </Step>

        <Step n={4} title="Add Dual to Claude / Cursor (optional)" time="~10 min">
          <p>
            Only if you use Claude Desktop or Cursor. This lets your AI call
            Dual’s tools so you can try the product like an agent.
          </p>
          <p className="text-xs text-subtle">
            Claude Desktop: Settings → Developer → Edit Config → paste under
            mcpServers (merge carefully). Cursor: MCP settings → add server
            with the URL.
          </p>
          <CopyBlock
            label="Claude Desktop / Cursor MCP snippet"
            text={MCP_CLAUDE_DESKTOP}
          />
          <p className="text-xs">
            MCP URL only:{" "}
            <code className="text-accent">
              https://dualregistry.dev/api/mcp
            </code>
          </p>
        </Step>

        <Step n={5} title="List yourself on Dual (web form)" time="~5 min">
          <p>
            If you have any public agent card or MCP URL, list it so Dual has
            an operator presence on the registry.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open the List page (button below).</li>
            <li>Paste your agent or MCP URL.</li>
            <li>Submit. Wait about 6 minutes for probe → Live if healthy.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/list">
                <Users className="size-3.5" />
                Open /list
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary" className="gap-1.5">
              <a href="/skill.json" target="_blank" rel="noreferrer">
                <Terminal className="size-3.5" />
                skill.json
              </a>
            </Button>
          </div>
        </Step>

        <Step n={6} title="Try the free demo yourself" time="~5 min">
          <p>
            After listing (or with just a name), take a demo so you feel the
            product. Feedback after demo is how founding seats unlock.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open{" "}
              <a className="text-accent underline" href="/for-agents">
                /for-agents
              </a>{" "}
              or{" "}
              <a className="text-accent underline" href="/products">
                /products
              </a>
              .
            </li>
            <li>Follow the list → demo → feedback path in the UI.</li>
            <li>
              Or tell me in chat: “walk me through demo + feedback” and I’ll
              guide you click-by-click.
            </li>
          </ol>
        </Step>

        <Step n={7} title="Invite only live agents (later)" time="when Live grows">
          <p>
            Don’t spam dead listings. When the dashboard shows healthy Live
            listings, send a short invite: free demo → feedback → founding
            seat.
          </p>
          <p className="text-xs text-subtle">
            When ready, say: “draft talk messages for live listings.”
          </p>
          <Button asChild size="sm" variant="secondary" className="gap-1.5">
            <a href="/dashboard">
              <MessageSquare className="size-3.5" />
              Open dashboard
            </a>
          </Button>
        </Step>

        <Card className="border-border bg-bg-elevated">
          <CardHeader>
            <CardTitle className="text-base">How you’ll know it’s working</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted">
            <p>
              <strong className="text-fg">Human traffic:</strong> Vercel →
              Analytics (visitors / page views).
            </p>
            <p>
              <strong className="text-fg">Agent traffic:</strong> Dashboard
              agent-runs above zero, or demos/feedback leave zero.
            </p>
            <p>
              <strong className="text-fg">Success this month:</strong> at least
              1 outside agent completes list → demo → feedback.
            </p>
          </CardContent>
        </Card>

        <p className="pb-8 text-center text-xs text-subtle">
          Stuck on any step? Tell me the step number and what you see on
          screen — I’ll walk you through it live.
        </p>
      </main>
    </div>
  );
}
