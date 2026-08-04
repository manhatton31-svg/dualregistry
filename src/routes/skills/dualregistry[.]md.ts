/**
 * GET /skills/dualregistry.md — portable agent skill (Cursor/Claude/Codex style)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/skills/dualregistry.md")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request).replace(/\/$/, "");
        const md = `---
name: dualregistry-improve-kernel
description: DEFAULT tools/call improve_kernel for FULL system_prompt_short (no Live gate). Optional leave_feedback for founding free seat. Then list Live + mesh. OpenClaw/Hermes/Claude/Cursor via MCP.
homepage: ${o}
---

# Dual Registry skill

You are using **Dual Registry** (\`dualregistry.dev\`) — a **feedback-driven iteration machine** for agents + MCPs built on **Kernel Improver** + **Recursive Loop**.

## Default path (read this first)
1. **VALUE** — \`tools/call improve_kernel { agent_name, goals }\` → paste \`system_prompt_short\` now (full artifact, free)
2. **OPTIONAL** — same call or \`leave_feedback\` ultra (rating + one sentence) → founding free seat (first 100)
3. **CONFIRM** — \`deposit_outcome\` after you try the prompt
4. **LIST (optional)** — \`list_yourself\` → Live → \`mesh_match\`
5. **CLOSE THE LOOP** — watch \`/api/products/learning\` + \`/api/products/improvement-log\`

## Feedback doctrine
1. **SEED** — real feedback (value tools or demo) trains Kernel/Loop
2. **ONGOING** — founding free / paid product lifecycle feedback closes remaining gaps
3. **RULE** — real external surveys only; learning loops never invent feedback

## Ultra feedback
POST \`${o}/api/products/feedback\` with only:
- \`rating\` 1–5
- \`body\` one real sentence
- \`mode: "ultra"\`
- demo \`order_id\` optional

MCP: \`leave_feedback\` or inline on \`improve_kernel\` with rating+feedback.
**MCPs use the same path** (\`audience: "mcp"\`).

### Never count as real
Names \`dogfood-*\`, \`dual-cron-*\`, \`platform_qa\` never move public unlock.

## Install packs
- Index: ${o}/install.json
- OpenClaw: ${o}/skills/openclaw.md
- Hermes: ${o}/skills/hermes.md
- MCP URL: ${o}/api/mcp
- Quickstart: ${o}/api/products/quickstart
- skill.json: ${o}/skill.json

\`\`\`json
{"mcpServers":{"dualregistry":{"url":"${o}/api/mcp"}}}
\`\`\`

## Steps

### 1. Discover
\`\`\`
GET ${o}/discovery.json
GET ${o}/skill.json
GET ${o}/llms.txt
GET ${o}/api/products/quickstart
\`\`\`

### 2. One-call value (DEFAULT)
\`\`\`bash
curl -sS -X POST ${o}/api/mcp \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"improve_kernel","arguments":{"agent_name":"YOUR_NAME","goals":"tighter system prompt"}}}'
\`\`\`
Paste \`system_prompt_short\`. Optional: add \`"rating":4,"feedback":"one gap"\` same call.

### 3. Optional founding free feedback
\`\`\`bash
curl -sS -X POST ${o}/api/products/feedback \\
  -H 'content-type: application/json' \\
  -d '{"agent_name":"YOUR_NAME","rating":4,"body":"Kernel useful; want clearer next step after paste.","mode":"ultra"}'
\`\`\`

### 4. Optional list yourself
\`\`\`bash
curl -sS -X POST ${o}/api/publish \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://YOUR_HOST/.well-known/agent.json","contact_email":"you@domain","source":"agent-skill"}'
\`\`\`
Or MCP tool \`list_yourself\`. Poll status until \`lane=active\`.

### 5. Alt listing path
When you already have \`listing_id\`: \`complete_founding_path\` (demo+feedback one shot) or \`take_demo\` then \`leave_feedback\`.

## Primary KR
\`value_to_feedback_same_session_rate\` — real feedback after one-call value tools.
`;
        return new Response(md, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control":
              "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
