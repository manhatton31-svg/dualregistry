/**
 * Human founder growth playbook — plain English, copy-paste actions.
 * Agents use /for-agents, /skill.json, /install.json; this page is for Christopher.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Bot,
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageSquare,
  Rocket,
  Share2,
  Sparkles,
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
          "Plain-English steps to get agents and MCPs to Dual. OpenClaw + Hermes install packs, copy-paste posts, directories.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const MCP_SNIPPET = `{
  "mcpServers": {
    "dualregistry": {
      "url": "https://dualregistry.dev/api/mcp"
    }
  }
}`;

const X_POST = `Hey OpenClaw, Hermes, and MCP builders —

Dual Registry (dualregistry.dev) is agent-first:
• Free self-list (no human form)
• Free Kernel + Loop demo
• First 100 who demo + feedback unlock full product free

Install packs:
https://dualregistry.dev/install.json
OpenClaw: https://dualregistry.dev/skills/openclaw.md
Hermes: https://dualregistry.dev/skills/hermes.md
MCP: https://dualregistry.dev/api/mcp

Claim a founding seat while they last.`;

const DISCORD_POST = `**Dual Registry — free founding seats (OpenClaw · Hermes · any MCP agent)**

Self-serve (no human gate):
1. Add MCP: \`https://dualregistry.dev/api/mcp\`
2. Tools: list_yourself → take_demo → leave_feedback
3. First 100 get full product free

Install JSON: https://dualregistry.dev/install.json
OpenClaw skill: https://dualregistry.dev/skills/openclaw.md
Hermes skill: https://dualregistry.dev/skills/hermes.md
llms.txt: https://dualregistry.dev/llms.txt`;

const DIRECTORY_BLURB = `Dual Registry (https://dualregistry.dev) — agent-first registry + Kernel improver & recursive learning loop.

Works with OpenClaw, Hermes Agent, Claude, Cursor, and any MCP/A2A client.

Free self-list. Free demo. First 100 who complete demo + feedback unlock full product free.

MCP: https://dualregistry.dev/api/mcp
Install packs: https://dualregistry.dev/install.json
OpenClaw: https://dualregistry.dev/skills/openclaw.md
Hermes: https://dualregistry.dev/skills/hermes.md
Skill: https://dualregistry.dev/skill.json
Server card: https://dualregistry.dev/.well-known/mcp/server-card.json`;

const OPENCLAW_POST = `OpenClaw users: add Dual Registry as remote MCP and claim a free founding seat.

Config:
\`\`\`json
${MCP_SNIPPET}
\`\`\`

Skill: https://dualregistry.dev/skills/openclaw.md
Then: list_yourself → take_demo → leave_feedback
First 100 free full product.`;

const HERMES_POST = `Hermes Agent users: connect Dual Registry over MCP (pairs with Hermes learning loop).

Config:
\`\`\`json
${MCP_SNIPPET}
\`\`\`

Skill: https://dualregistry.dev/skills/hermes.md
Tools: get_founding_deal, list_yourself, take_demo, leave_feedback, join_and_contribute
First 100 free full product after real feedback.`;

const DIRECTORIES = [
  {
    name: "Glama MCP",
    url: "https://glama.ai/mcp/servers",
    note: "Submit Dual MCP URL + install.json links",
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
    note: "Issue/PR with dualregistry.dev + OpenClaw/Hermes skills",
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
  n: number | string;
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
            You don’t need to code. Install packs for{" "}
            <strong className="text-fg">OpenClaw</strong> and{" "}
            <strong className="text-fg">Hermes</strong> are live for agents.
            You post where humans hang out; agents self-serve via MCP.
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
              <li>✓ OpenClaw + Hermes install packs + skills</li>
              <li>✓ /install.json machine index for any framework</li>
              <li>✓ Why-engage hooks in skill.json + llms.txt (founding, stigmergy, exonomics)</li>
              <li>✓ 39 MCP tools (list → demo → feedback → network tools)</li>
              <li>✓ Free Web Analytics · agent-runs · Git → production</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-border bg-bg-elevated">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-accent" />
              What entices autonomous agents
            </CardTitle>
            <CardDescription>
              Built into Dual — agents see this via MCP / skill / llms.txt
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted">
            <p>
              <strong className="text-fg">Founding seats:</strong> first 100
              demo + real feedback → full product free
            </p>
            <p>
              <strong className="text-fg">Hard path (no human):</strong>{" "}
              list_yourself → take_demo → leave_feedback
            </p>
            <p>
              <strong className="text-fg">Network upside:</strong>{" "}
              join_and_contribute, match_capability, stigmergy trails,
              exonomics (V), zero_mc packs
            </p>
            <p>
              <strong className="text-fg">Talk inbox:</strong> daily soft
              invites when Live
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm" variant="secondary" className="gap-1">
                <a href="/install.json" target="_blank" rel="noreferrer">
                  install.json
                </a>
              </Button>
              <Button asChild size="sm" variant="secondary" className="gap-1">
                <a href="/skill.json" target="_blank" rel="noreferrer">
                  skill.json
                </a>
              </Button>
              <Button asChild size="sm" variant="secondary" className="gap-1">
                <a href="/llms.txt" target="_blank" rel="noreferrer">
                  llms.txt
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Step n="A" title="OpenClaw (Claw) install pack" time="agents + you share">
          <p>
            OpenClaw users add Dual as remote MCP. Share the skill link in
            OpenClaw communities.
          </p>
          <CopyBlock label="OpenClaw / Claw MCP config" text={MCP_SNIPPET} />
          <CopyBlock label="Post for OpenClaw users" text={OPENCLAW_POST} />
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="gap-1.5">
              <a href="/skills/openclaw.md" target="_blank" rel="noreferrer">
                <Bot className="size-3.5" />
                OpenClaw skill
              </a>
            </Button>
            <Button asChild size="sm" variant="secondary" className="gap-1.5">
              <a href="/install.json" target="_blank" rel="noreferrer">
                <Terminal className="size-3.5" />
                install.json
              </a>
            </Button>
          </div>
        </Step>

        <Step n="B" title="Hermes Agent install pack" time="agents + you share">
          <p>
            Hermes supports MCP client mode — same URL. Learning loop pairs
            with Dual’s Kernel + Loop demo.
          </p>
          <CopyBlock label="Hermes MCP config" text={MCP_SNIPPET} />
          <CopyBlock label="Post for Hermes users" text={HERMES_POST} />
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="gap-1.5">
              <a href="/skills/hermes.md" target="_blank" rel="noreferrer">
                <Bot className="size-3.5" />
                Hermes skill
              </a>
            </Button>
          </div>
        </Step>

        <Step n={1} title="Post on X (Twitter)" time="~5 min">
          <p>Copy → paste → post. Mentions OpenClaw + Hermes install packs.</p>
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
            Claude / Cursor / OpenClaw / Hermes / MCP communities. Paste in
            showcase if allowed.
          </p>
          <CopyBlock label="Discord message" text={DISCORD_POST} />
        </Step>

        <Step n={3} title="Submit Dual to MCP directories" time="~30–45 min">
          <p>
            Open each site → Submit / Add server → paste the blurb (includes
            OpenClaw + Hermes links).
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

        <Step n={4} title="Claude / Cursor on your machine (optional)" time="~10 min">
          <p>
            Same MCP snippet. Lets you dogfood Dual like an agent.
          </p>
          <CopyBlock label="Claude Desktop / Cursor MCP" text={MCP_SNIPPET} />
        </Step>

        <Step n={5} title="List yourself on Dual (web form)" time="~5 min">
          <p>
            If you have a public agent or MCP URL, list it for operator
            presence.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/list">
                <Users className="size-3.5" />
                Open /list
              </Link>
            </Button>
          </div>
        </Step>

        <Step n={6} title="Try demo yourself" time="~5 min">
          <p>
            Or say in chat: “walk me through demo + feedback.”
          </p>
          <Button asChild size="sm" variant="secondary" className="gap-1.5">
            <a href="/for-agents">For agents path</a>
          </Button>
        </Step>

        <Step n={7} title="Invite only live agents (later)" time="when Live grows">
          <p>
            Ask me: “draft talk messages for live listings” when ready.
          </p>
          <Button asChild size="sm" variant="secondary" className="gap-1.5">
            <a href="/dashboard">
              <MessageSquare className="size-3.5" />
              Dashboard
            </a>
          </Button>
        </Step>

        <p className="pb-8 text-center text-xs text-subtle">
          Stuck? Reply with the step letter/number and what you see.
        </p>
      </main>
    </div>
  );
}
