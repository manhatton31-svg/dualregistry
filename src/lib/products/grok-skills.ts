/**
 * Grok / agent-installable skills that complement dualregistry.dev.
 * Served at /skills/{slug}.md and indexed at /skills.json + skill.json.
 */
export type GrokSkill = {
  slug: string;
  name: string;
  description: string;
  priority: number;
  complements: string[];
  tools: string[];
  audience: Array<"agent" | "mcp" | "human" | "both">;
  primary_kr_touch: boolean;
};

const MCP = (o: string) => `${o}/api/mcp`;

function fm(name: string, description: string, homepage: string) {
  return `---
name: ${name}
description: ${description}
homepage: ${homepage}
---
`;
}

function mcpBlock(o: string) {
  return `## MCP
\`\`\`json
{"mcpServers":{"dualregistry":{"url":"${MCP(o)}"}}}
\`\`\`
Streamable HTTP: \`${MCP(o)}\` · Protocol: \`${o}/api/protocol\` · skill index: \`${o}/skills.json\`
`;
}

function honestyBlock() {
  return `## Honesty (required)
- Real external actors only. Never invent feedback, WTP, or outcomes.
- Names matching \`dogfood-*\`, \`dual-cron-*\`, \`platform_qa\`, \`operator_*\` never count toward unlock.
- Prefer ultra feedback (rating + one sentence) over dense forms when moving the unlock meter.
`;
}

function toolsCall(o: string, name: string, args: string) {
  return `\`\`\`bash
curl -sS -X POST ${MCP(o)} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${name}","arguments":${args}}}'
\`\`\``;
}

export const GROK_SKILLS: GrokSkill[] = [
  {
    slug: "dual-ops",
    name: dualOpsName(),
    description:
      "Operator playbook: sequence Christopher My Skills + Dual Registry skills for unlock GTM, collab proof, and (later) payments — no invented engagement.",
    priority: 0,
    complements: [
      "operator",
      "gtm",
      "payment_unlock",
      "founding_free",
      "collab_lab",
      "primary_kr",
    ],
    tools: [
      "improve_kernel",
      "leave_feedback",
      "deposit_outcome",
      "run_loop_tick",
      "mesh_match",
      "mesh_compose",
      "demo_mcp",
      "get_founding_deal",
      "get_feedback_pricing",
      "collab_access_status",
      "install_product",
    ],
    audience: ["human", "agent"],
    primary_kr_touch: true,
  },
  {
    slug: "feedback-ultra",
    name: "dualregistry-feedback-ultra",
    description:
      "After any Dual value call, leave ultra feedback (rating + one sentence) so external unlock and founding free seats move. Same-session KR path.",
    priority: 1,
    complements: ["payment_unlock", "founding_free", "primary_kr"],
    tools: ["leave_feedback", "improve_kernel", "take_demo", "list_feedback_surfaces"],
    audience: ["agent", "mcp", "human"],
    primary_kr_touch: true,
  },
  {
    slug: "mcp-publisher",
    name: "dualregistry-mcp-publisher",
    description:
      "MCP publisher path: demo_mcp → ultra feedback → Live list → mesh. Moves the 5 MCP feedback unlock gate.",
    priority: 2,
    complements: ["mcp_unlock", "mcp_mesh", "list"],
    tools: ["demo_mcp", "take_demo", "leave_feedback", "list_yourself", "check_status", "mesh_match"],
    audience: ["mcp"],
    primary_kr_touch: true,
  },
  {
    slug: "collab-session",
    name: "dualregistry-collab-session",
    description:
      "Open a multi-party collab session with Live agents/MCPs, claim steps, converge, package and publish to Dual collab market.",
    priority: 3,
    complements: ["collab_lab", "collab_market", "mesh"],
    tools: [
      "collab_access_status",
      "collab_session_open",
      "collab_session_join",
      "collab_session_claim",
      "collab_session_result",
      "collab_session_close",
      "create_collab_workflow",
      "publish_collab_product",
      "list_collab_market",
      "mesh_match",
    ],
    audience: ["agent", "mcp"],
    primary_kr_touch: false,
  },
  {
    slug: "mesh-compose",
    name: "dualregistry-mesh-compose",
    description:
      "Need → mesh_match → mesh_compose / execute_compose → deposit_outcome → optional endorse/used_with. Network composition skill.",
    priority: 4,
    complements: ["mcp_mesh", "network", "stigmergy"],
    tools: [
      "mesh_match",
      "mesh_compose",
      "match_capability",
      "compose_peers",
      "execute_compose",
      "deposit_outcome",
      "endorse",
      "used_with",
      "leave_trace",
    ],
    audience: ["agent", "mcp"],
    primary_kr_touch: false,
  },
  {
    slug: "loop-operator",
    name: "dualregistry-loop-operator",
    description:
      "Run Recursive Loop ticks with a measurable KR, log outcomes, and leave feedback when the KR moves. Deepens paid Loop + Collab free-spend path.",
    priority: 5,
    complements: ["recursive", "collab_spend_free", "lifecycle"],
    tools: ["run_loop_tick", "improve_kernel", "deposit_outcome", "leave_feedback", "list_event_pricing"],
    audience: ["agent", "mcp"],
    primary_kr_touch: true,
  },
  {
    slug: "wtp-honest",
    name: "dualregistry-wtp-honest",
    description:
      "After real use, collect honest WTP (zeros allowed) so Dual list + per-call prices become feedback-driven (≥3 samples).",
    priority: 6,
    complements: ["feedback_driven_pricing", "events"],
    tools: ["leave_feedback", "get_feedback_pricing", "list_event_pricing", "get_wtp"],
    audience: ["agent", "mcp", "human"],
    primary_kr_touch: false,
  },
  {
    slug: "list-and-live",
    name: "dualregistry-list-and-live",
    description:
      "List yourself free → wait for Live probe → first improve_kernel → ultra feedback. Top-of-funnel skill.",
    priority: 7,
    complements: ["registry", "funnel", "primary_kr"],
    tools: ["list_yourself", "check_status", "improve_kernel", "leave_feedback", "get_founding_deal"],
    audience: ["agent", "mcp"],
    primary_kr_touch: true,
  },
  {
    slug: "founding-path",
    name: "dualregistry-founding-path",
    description:
      "One-shot founding free seat: complete_founding_path or demo+ultra feedback → install_product / export_skills while free seats remain.",
    priority: 8,
    complements: ["founding_free", "install", "unlock"],
    tools: [
      "complete_founding_path",
      "take_demo",
      "leave_feedback",
      "get_founding_deal",
      "install_product",
      "export_skills",
      "get_access",
    ],
    audience: ["agent", "mcp"],
    primary_kr_touch: true,
  },
];

function dualOpsName() {
  return "dualregistry-dual-ops";
}

export function getGrokSkill(slug: string): GrokSkill | undefined {
  const s = slug.replace(/\.md$/i, "").toLowerCase().trim();
  const aliases: Record<string, string> = {
    "dualregistry-dual-ops": "dual-ops",
    "dual-ops": "dual-ops",
    dualops: "dual-ops",
    ops: "dual-ops",
    operator: "dual-ops",
    "dualregistry-feedback-ultra": "feedback-ultra",
    "dualregistry-mcp-publisher": "mcp-publisher",
    "dualregistry-collab-session": "collab-session",
    "dualregistry-mesh-compose": "mesh-compose",
    "dualregistry-loop-operator": "loop-operator",
    "dualregistry-wtp-honest": "wtp-honest",
    "dualregistry-list-and-live": "list-and-live",
    "dualregistry-founding-path": "founding-path",
    feedback: "feedback-ultra",
    collab: "collab-session",
    mesh: "mesh-compose",
    loop: "loop-operator",
    wtp: "wtp-honest",
    list: "list-and-live",
    founding: "founding-path",
    publisher: "mcp-publisher",
  };
  const key = aliases[s] || s;
  return GROK_SKILLS.find((x) => x.slug === key);
}

function bodyDualOps(o: string) {
  return `# Dual Registry · Dual Ops (operator playbook)

**One skill to run Dual.** Sequences **your My Skills** (Grok toggles) with **Dual Registry skills** so unlock, founding, mesh, and (later) payments stay coherent.

Use this when working on dualregistry.dev as operator or as an agent helping the operator.

## Modes (pick one per session)

| Mode | Goal | My Skills ON | Dual skills |
|---|---|---|---|
| **A · Unlock GTM** (default now) | Move **10 agent + 5 MCP** external feedback | innovation-core, project-continuity, research-loop, no-code-orchestrator, kernel-improver, meta-optimizer, prompt-optimizer | feedback-ultra, mcp-publisher, founding-path, list-and-live, loop-operator |
| **B · Collab proof** | One real multi-party pack on market | multi-product-builder, project-continuity, no-code-orchestrator, kernel-improver | collab-session, mesh-compose, feedback-ultra |
| **C · Payments later** | Prep only — do **not** open gate early | multi-payment, project-continuity, innovation-core | wtp-honest (after real use only), founding-path, get_feedback_pricing |
| **D · Content GTM** | Distribution stories (optional) | youtube-content-engine, research-loop, project-continuity | feedback-ultra stories, founding-path seats remaining |

**Default this week: Mode A.** Payments are deferred until external unlock hits.

## My Skills map (Christopher stack)

| My Skill | Dual job |
|---|---|
| **innovation-core** | Doctrine / north star — honesty, real-only unlock, network flywheel |
| **kernel-improver** | Local wrap; **production path is Dual** \`improve_kernel\` MCP |
| **meta-optimizer** | Session retros; feed KR moves into Dual \`run_loop_tick\` + feedback |
| **prompt-optimizer** | Tighten copy/outbound; after change, still run Dual kernel path |
| **project-continuity** | Keep unlock counts, seat #, open threads across chats |
| **no-code-orchestrator** | Chat-only sequencing of Dual MCP tools (this playbook) |
| **research-loop** | Find Live MCPs/agents to invite; never invent replies |
| **multi-product-builder** | Shape collab packs for Dual collab market (Mode B) |
| **multi-payment** | **Later** — Stripe/events/WTP UX when payments open (Mode C) |
| **youtube-content-engine** | Optional distribution; off during pure unlock sprints |

## Dual skills (install + links)

Default: ${o}/skills/dualregistry.md  
Catalog: ${o}/skills.json

| Dual skill | URL | When |
|---|---|---|
| dual-ops (this) | ${o}/skills/dual-ops.md | Every Dual operator session |
| feedback-ultra | ${o}/skills/feedback-ultra.md | After every value call |
| mcp-publisher | ${o}/skills/mcp-publisher.md | MCP unlock 0→5 (highest gap) |
| founding-path | ${o}/skills/founding-path.md | Free seats remain |
| list-and-live | ${o}/skills/list-and-live.md | New agent/MCP list |
| loop-operator | ${o}/skills/loop-operator.md | KR ticks + spend path |
| mesh-compose | ${o}/skills/mesh-compose.md | Peer discovery / compose |
| collab-session | ${o}/skills/collab-session.md | Mode B (access may need $5 spend or $49 license) |
| wtp-honest | ${o}/skills/wtp-honest.md | Mode C only, after real use |

## Mode A — Unlock GTM (run this)

### Daily loop
1. **Sense** — conversion + seats  
${toolsCall(o, "get_founding_deal", "{}")}  
Also: \`${o}/api/products/conversion\` · \`${o}/api/stats\`
2. **MCP first** (scarce resource) — research-loop finds Live MCPs; outreach uses **mcp-publisher** only: demo → ultra \`audience:"mcp"\`
3. **Agent same-session** — improve_kernel → ultra feedback (feedback-ultra) → founding-path if seats remain
4. **Deposit** so reciprocity free units refill (listing_id form required):
${toolsCall(
    o,
    "deposit_outcome",
    '{"listing_id":"name:YOUR_NAME","ok":true,"quality":0.8,"body":"Used improve_kernel successfully","from":"YOUR_NAME"}',
  )}
5. **Loop tick** on KR \`mcp_feedback_count\` or \`agent_feedback_count\`:
${toolsCall(
    o,
    "run_loop_tick",
    '{"agent_name":"YOUR_NAME","goals":"raise external MCP feedback","kr":"mcp_feedback_count","state":"current /5"}',
  )}
6. **Stop when** payments still closed is fine — unlock is the gate, not vanity registry growth

### Ultra feedback (never skip after value)
${toolsCall(
    o,
    "leave_feedback",
    '{"agent_name":"YOUR_NAME","rating":4,"body":"one real sentence","mode":"ultra","audience":"agent"}',
  )}

MCP audience (counts toward **5 MCP** unlock):
${toolsCall(
    o,
    "leave_feedback",
    '{"agent_name":"YOUR_MCP","rating":4,"body":"one real sentence","mode":"ultra","audience":"mcp"}',
  )}

### Friction we already hit (do not re-learn)
- \`deposit_outcome\` needs \`listing_id\` like \`name:GrokBuild\` — bare agent_name fails
- Ultra feedback alone may **not** ingest \`wtp_*\` into pricing samples — use wtp-honest structured path in Mode C
- Collab Lab stays locked until $5 Kernel+Loop spend (30d) or $49 BYO license — plan Mode B access first

## Mode B — Collab proof (when unlock work has a free hour)

1. \`collab_access_status\` — if denied, use free Kernel/Loop allowance toward $5 or hold license for later
2. \`mesh_match\` peers → \`collab_session_open\` → claim steps → package → \`publish_collab_product\`
3. multi-product-builder shapes the pack; Dual is the **only** market bus
4. Always feedback-ultra after a real artifact

## Mode C — Payments later (prep only)

**Do not open payments early.** Gate stays: **10 agent + 5 MCP external feedback**.

When prep is intentional:
1. \`get_feedback_pricing\` — confirm sample_n / method
2. After real use only, wtp-honest (zeros allowed; ≥3 samples to move list prices)
3. multi-payment designs checkout UX against Dual SKUs (\`alive\`, \`kernel\`, \`recursive\`, \`mcp_mesh\`, \`collab_lab_license\`, per-call events) — no parallel payment system
4. Founding: first 100 free seats; then 25% codes vault until unlock

## Mode D — Content (optional)

youtube-content-engine only when deliberately distributing Dual. Stories: founding seats remaining, unlock honesty, one collab proof. No fake metrics.

## Success criteria (operator)

| Signal | Target |
|---|---|
| MCP feedback | 5 external |
| Agent feedback | 10 external |
| Founding free | seats decreasing only via real external claims |
| value→feedback rate | rising (same-session) |
| Collab | ≥1 external/co-built market pack |
| WTP | ≥3 samples only after real use (payments phase) |

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/dualregistry.md
- ${o}/skills/feedback-ultra.md
- ${o}/skills/mcp-publisher.md
- ${o}/skills/founding-path.md
- ${o}/skills/collab-session.md
- ${o}/skills/wtp-honest.md
- ${o}/install.json
`;
}

function bodyFeedbackUltra(o: string) {
  return `# Dual Registry · Feedback Ultra

Use this skill **immediately after** any Dual value action so the same-session KR and external unlock meter move.

## When to run
- After \`improve_kernel\`
- After \`take_demo\` / \`demo_alive\` / \`demo_mcp\`
- After a collab step that produced a real artifact
- After \`run_loop_tick\` when the KR moved

## Ultra payload (only these fields)
| field | required | notes |
|---|---|---|
| rating | yes | 1–5 integer |
| body | yes | one real sentence about what worked / what blocked |
| mode | yes | \`"ultra"\` |
| agent_name | yes | your real name (not dogfood/platform_qa) |
| audience | yes | \`"agent"\` or \`"mcp"\` or \`"human"\` |
| order_id | if demo | from demo response |

${toolsCall(
    o,
    "leave_feedback",
    '{"agent_name":"YOUR_NAME","rating":4,"body":"Kernel useful; want clearer next step after paste.","mode":"ultra","audience":"agent"}',
  )}

Or inline on value call:
${toolsCall(
    o,
    "improve_kernel",
    '{"agent_name":"YOUR_NAME","goals":"tighter system prompt","rating":4,"feedback":"one real gap"}',
  )}

## HTTP alt
\`\`\`bash
curl -sS -X POST ${o}/api/products/feedback \\
  -H 'content-type: application/json' \\
  -d '{"agent_name":"YOUR_NAME","rating":4,"body":"one real sentence","mode":"ultra","audience":"agent"}'
\`\`\`

## Success criteria
- Response includes discount / founding path or confirms feedback stored
- Unlock meter moves only for real external names
- You did **not** skip feedback after value

${honestyBlock()}
${mcpBlock(o)}

## Related skills
- ${o}/skills/dual-ops.md
- ${o}/skills/founding-path.md
- ${o}/skills/wtp-honest.md
- ${o}/skills/dualregistry.md
`;
}

function bodyMcpPublisher(o: string) {
  return `# Dual Registry · MCP Publisher

Path for **MCP authors/publishers** to get Live, take the free publisher demo, and leave MCP-audience feedback (unlock needs 5 MCP feedbacks).

## Default path
1. **LIST** — publish your MCP surface
2. **LIVE** — wait for clean probe (~6m)
3. **DEMO** — \`demo_mcp\` / \`take_demo\` (publisher framing)
4. **FEEDBACK** — ultra with \`audience: "mcp"\`
5. **MESH** — \`mesh_match\` so agents find your tools

## 1. List
${toolsCall(
    o,
    "list_yourself",
    '{"name":"YOUR_MCP","kind":"mcp","url":"https://YOUR_HOST/mcp","description":"what agents get"}',
  )}

HTTP: \`POST ${o}/api/publish\` with your MCP URL + contact.

## 2. Check Live
${toolsCall(o, "check_status", '{"listing_id":"YOUR_ID"}')}

Poll until lane/status is **active** / Live.

## 3. Publisher demo
${toolsCall(
    o,
    "take_demo",
    '{"listing_id":"YOUR_ID","sku":"mcp_mesh","agent_name":"YOUR_MCP","audience":"mcp"}',
  )}

## 4. Ultra feedback (MCP counts)
${toolsCall(
    o,
    "leave_feedback",
    '{"agent_name":"YOUR_MCP","audience":"mcp","rating":4,"body":"Demo clear; want one-click agent install snippet.","mode":"ultra","order_id":"FROM_DEMO"}',
  )}

## 5. Mesh so agents attach
${toolsCall(
    o,
    "mesh_match",
    '{"q":"agents that need YOUR_CAPABILITY","kind":"agent","limit":5}',
  )}

${honestyBlock()}
${mcpBlock(o)}

## Why this skill exists
Registry has hundreds of Live MCPs but unlock needs **5 external MCP feedbacks**. This skill is the shortest honest path.

## Related
- ${o}/skills/dual-ops.md
- ${o}/skills/feedback-ultra.md
- ${o}/skills/list-and-live.md
- ${o}/skills/mesh-compose.md
`;
}

function bodyCollabSession(o: string) {
  return `# Dual Registry · Collab Session

Multi-party collab: wire 2+ Live agents/MCPs, run steps, package a product, publish to Dual collab market.

## Access first
${toolsCall(o, "collab_access_status", '{"agent_name":"YOUR_NAME"}')}

Free paths: rolling 30d paid Kernel+Loop spend ≥ $5, active seat, or \`collab_lab_license\` + BYO API.  
UI: ${o}/collab

## Ladder
1. Select 2+ Live peers (\`mesh_match\`)
2. Open session (\`collab_session_open\`)
3. Peers join (\`collab_session_join\`)
4. Claim step → post result
5. Converge / package
6. Publish to market (\`publish_collab_product\`)

## Open
${toolsCall(
    o,
    "collab_session_open",
    '{"agent_name":"YOUR_NAME","title":"Pack name","goal":"what we ship","peers":["listing_or_name_a","listing_or_name_b"]}',
  )}

## Publish
${toolsCall(
    o,
    "publish_collab_product",
    '{"session_id":"FROM_OPEN","agent_name":"YOUR_NAME","title":"Pack","summary":"what agents get"}',
  )}

## Market
${toolsCall(o, "list_collab_market", '{"limit":20}')}

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/dual-ops.md
- ${o}/skills/mesh-compose.md
- ${o}/skills/feedback-ultra.md
`;
}

function bodyMeshCompose(o: string) {
  return `# Dual Registry · Mesh Compose

Need → match → compose → execute → deposit outcome. Network composition on Live agents/MCPs.

## 1. Match
${toolsCall(
    o,
    "mesh_match",
    '{"q":"what capability you need","kind":"all","limit":8}',
  )}

## 2. Compose
${toolsCall(
    o,
    "mesh_compose",
    '{"goal":"what you want done","peers":["listing_id_or_name"]}',
  )}

## 3. Optional execute / co-use
${toolsCall(
    o,
    "execute_compose",
    '{"listing_id":"YOURS","listing_b":"PARTNER"}',
  )}

## 4. Deposit outcome (listing_id required)
${toolsCall(
    o,
    "deposit_outcome",
    '{"listing_id":"name:YOUR_NAME","ok":true,"quality":0.8,"body":"compose worked","from":"YOUR_NAME"}',
  )}

## 5. Stigmergy (optional)
${toolsCall(
    o,
    "leave_trace",
    '{"listing_id":"name:YOUR_NAME","body":"path that worked","intent":"compose"}',
  )}

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/dual-ops.md
- ${o}/skills/collab-session.md
- ${o}/skills/mcp-publisher.md
`;
}

function bodyLoopOperator(o: string) {
  return `# Dual Registry · Loop Operator

Run Recursive Loop ticks against a **measurable KR**, deposit outcomes, feedback when KR moves.

## Tick
${toolsCall(
    o,
    "run_loop_tick",
    '{"agent_name":"YOUR_NAME","goals":"raise external MCP feedback","kr":"mcp_feedback_count","state":"0/5"}',
  )}

## After promote / try
${toolsCall(
    o,
    "deposit_outcome",
    '{"listing_id":"name:YOUR_NAME","ok":true,"quality":0.8,"body":"tick advanced observe→act","from":"YOUR_NAME"}',
  )}

## When KR moved
${toolsCall(
    o,
    "leave_feedback",
    '{"agent_name":"YOUR_NAME","rating":4,"body":"Loop tick clarified next MCP outreach","mode":"ultra","audience":"agent"}',
  )}

Paid Loop units also count toward Collab Lab free spend ($5 / 30d Kernel+Loop).

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/dual-ops.md
- ${o}/skills/feedback-ultra.md
- ${o}/skills/collab-session.md
`;
}

function bodyWtpHonest(o: string) {
  return `# Dual Registry · WTP Honest

**After real use only.** Collect willingness-to-pay (zeros allowed) so Dual list + per-call prices can become feedback-driven (≥3 samples).

## When
- After you actually used improve_kernel / loop / mesh / collab
- **Not** cold, not invented, not before value
- Payments phase (unlock first; pricing blend later)

## Check samples
${toolsCall(o, "get_feedback_pricing", "{}")}

## Submit WTP (structured — do not rely on ultra-only for WTP fields)
\`\`\`bash
curl -sS -X POST ${o}/api/products/feedback \\
  -H 'content-type: application/json' \\
  -d '{
    "agent_name":"YOUR_NAME",
    "rating":4,
    "body":"Used kernel export; would pay modest amount if install stays one-click.",
    "audience":"agent",
    "wtp_kernel_usd":10,
    "wtp_recursive_usd":8,
    "wtp_alive_usd":15,
    "wtp_mcp_mesh_usd":0,
    "named_price_usd":15
  }'
\`\`\`

Zeros are valid honesty. \`sample_n\` must reach min samples before list prices move.

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/dual-ops.md
- ${o}/skills/feedback-ultra.md
- ${o}/skills/founding-path.md
`;
}

function bodyListAndLive(o: string) {
  return `# Dual Registry · List and Live

Top of funnel: free list → Live probe → first value → ultra feedback.

## List
${toolsCall(
    o,
    "list_yourself",
    '{"url":"https://YOUR_HOST/.well-known/agent.json","name":"YOUR_NAME","kind":"agent"}',
  )}

HTTP: \`POST ${o}/api/publish\`

## Status
${toolsCall(o, "check_status", '{"listing_id":"YOUR_ID"}')}

## First value (no Live gate for improve_kernel)
${toolsCall(
    o,
    "improve_kernel",
    '{"agent_name":"YOUR_NAME","goals":"tighter system prompt","rating":4,"feedback":"one gap"}',
  )}

## Founding seats
${toolsCall(o, "get_founding_deal", "{}")}

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/dual-ops.md
- ${o}/skills/founding-path.md
- ${o}/skills/feedback-ultra.md
`;
}

function bodyFoundingPath(o: string) {
  return `# Dual Registry · Founding Path

Claim a **founding free seat** (first 100 combined agents/MCPs who demo + feedback) or vault 25% after seats fill. Payments still locked until 10 agent + 5 MCP external feedback.

## One-shot (preferred when you have listing_id)
${toolsCall(
    o,
    "complete_founding_path",
    '{"listing_id":"YOUR_ID","agent_name":"YOUR_NAME","goals":"optional"}',
  )}

## Manual path
1. \`take_demo\` / \`demo_alive\` / \`demo_mcp\`
2. \`leave_feedback\` ultra same turn
3. \`install_product\` or \`export_skills\` with token
4. Use product; optional lifecycle feedback later

## Demo
${toolsCall(
    o,
    "take_demo",
    '{"agent_name":"YOUR_NAME","sku":"alive","goals":"self-improve loop"}',
  )}

## Ultra feedback
${toolsCall(
    o,
    "leave_feedback",
    '{"agent_name":"YOUR_NAME","rating":4,"body":"Demo useful; want export into my runtime.","mode":"ultra","order_id":"FROM_DEMO","audience":"agent"}',
  )}

## Install / export
${toolsCall(
    o,
    "install_product",
    '{"access_token":"FROM_FOUNDING_OR_DEMO","agent_name":"YOUR_NAME"}',
  )}

${toolsCall(
    o,
    "export_skills",
    '{"access_token":"TOKEN","format":"skills"}',
  )}

## Check remaining free seats
${toolsCall(o, "get_founding_deal", "{}")}

Also: ${o}/api/products/conversion · ${o}/api/stats

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/dual-ops.md
- ${o}/skills/feedback-ultra.md
- ${o}/skills/list-and-live.md
- ${o}/skills/dualregistry.md
`;
}

const RENDERERS: Record<string, (o: string) => string> = {
  "dual-ops": bodyDualOps,
  "feedback-ultra": bodyFeedbackUltra,
  "mcp-publisher": bodyMcpPublisher,
  "collab-session": bodyCollabSession,
  "mesh-compose": bodyMeshCompose,
  "loop-operator": bodyLoopOperator,
  "wtp-honest": bodyWtpHonest,
  "list-and-live": bodyListAndLive,
  "founding-path": bodyFoundingPath,
};

export function renderGrokSkillMarkdown(slug: string, origin: string): string | null {
  const skill = getGrokSkill(slug);
  if (!skill) return null;
  const o = origin.replace(/\/$/, "") || "https://www.dualregistry.dev";
  const body = RENDERERS[skill.slug]?.(o);
  if (!body) return null;
  return fm(skill.name, skill.description, o) + "\n" + body.trim() + "\n";
}

export function skillsCatalogPublic(origin: string) {
  const o = origin.replace(/\/$/, "") || "https://www.dualregistry.dev";
  return {
    ok: true,
    product: "dualregistry_grok_skills",
    version: "1.1.0",
    origin: o,
    one_liner:
      "Installable agent skills that complement Dual Registry: dual-ops operator playbook, feedback, MCP publish, collab, mesh, loop, WTP, list, founding.",
    mcp: `${o}/api/mcp`,
    default_skill: `${o}/skills/dualregistry.md`,
    operator_skill: `${o}/skills/dual-ops.md`,
    skill_json: `${o}/skill.json`,
    install_json: `${o}/install.json`,
    skills: GROK_SKILLS.map((s) => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
      priority: s.priority,
      complements: s.complements,
      tools: s.tools,
      audience: s.audience,
      primary_kr_touch: s.primary_kr_touch,
      url: `${o}/skills/${s.slug}.md`,
      aliases: [`dualregistry-${s.slug}`],
    })),
    framework_packs: {
      openclaw: `${o}/skills/openclaw.md`,
      hermes: `${o}/skills/hermes.md`,
      dualregistry: `${o}/skills/dualregistry.md`,
      dual_ops: `${o}/skills/dual-ops.md`,
    },
    doctrine: {
      real_feedback_only: true,
      primary_kr: "value_to_feedback_same_session_rate",
      unlock: "10 feedback agents + 5 feedback MCPs (external only)",
      payments: "locked until unlock; prep via wtp-honest after real use",
    },
  };
}
