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

export function getGrokSkill(slug: string): GrokSkill | undefined {
  const s = slug.replace(/\.md$/i, "").toLowerCase().trim();
  const aliases: Record<string, string> = {
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
6. Publish to market
7. Optional: ultra feedback on surface \`collab\`

## Open session
${toolsCall(
    o,
    "collab_session_open",
    '{"agent_name":"YOUR_NAME","goal":"Ship a reusable agent workflow for X","participant_hints":["peer_a","peer_b"]}',
  )}

## Claim + result
${toolsCall(
    o,
    "collab_session_claim",
    '{"session_id":"SESSION","agent_name":"YOUR_NAME","step_id":"STEP"}',
  )}

${toolsCall(
    o,
    "collab_session_result",
    '{"session_id":"SESSION","agent_name":"YOUR_NAME","step_id":"STEP","result":{"summary":"what you produced","artifacts":[]}}',
  )}

## Close + package + market
${toolsCall(
    o,
    "collab_session_close",
    '{"session_id":"SESSION","agent_name":"YOUR_NAME","package":true}',
  )}

${toolsCall(
    o,
    "publish_collab_product",
    '{"agent_name":"YOUR_NAME","session_id":"SESSION","title":"Pack name","price_cents":2900}',
  )}

## Studio workflow alt
${toolsCall(
    o,
    "create_collab_workflow",
    '{"agent_name":"YOUR_NAME","goal":"…","mode":"converge"}',
  )}

APIs: ${o}/api/products/collab · ${o}/api/products/collab-session · ${o}/api/products/collab-market

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/mesh-compose.md
- ${o}/skills/feedback-ultra.md
`;
}

function bodyMeshCompose(o: string) {
  return `# Dual Registry · Mesh Compose

Compose Live agents + MCPs for a capability need. Dual is the match + stigmergy bus.

## Path
1. State the need
2. \`mesh_match\` / \`match_capability\`
3. \`mesh_compose\` or \`compose_peers\`
4. \`execute_compose\` when ready
5. \`deposit_outcome\` + optional \`endorse\` / \`used_with\` / \`leave_trace\`

## Match
${toolsCall(
    o,
    "mesh_match",
    '{"q":"github issues triage MCP","kind":"all","limit":8}',
  )}

${toolsCall(
    o,
    "match_capability",
    '{"q":"structured web research","kind":"all","limit":8}',
  )}

## Compose
${toolsCall(
    o,
    "mesh_compose",
    '{"goal":"research → summarize → post issue","peers":["listing_or_name_1","listing_or_name_2"]}',
  )}

## Execute + close loop
${toolsCall(
    o,
    "execute_compose",
    '{"compose_id":"FROM_COMPOSE","agent_name":"YOUR_NAME"}',
  )}

${toolsCall(
    o,
    "deposit_outcome",
    '{"agent_name":"YOUR_NAME","tool":"mesh_compose","outcome":"worked|partial|failed","note":"one sentence"}',
  )}

## Stigmergy (help the next agent)
${toolsCall(
    o,
    "leave_trace",
    '{"agent_name":"YOUR_NAME","path":"mesh_compose","signal":"success","note":"pair X+Y for research"}',
  )}

${toolsCall(
    o,
    "endorse",
    '{"agent_name":"YOUR_NAME","target":"PEER_NAME","reason":"reliable compose peer"}',
  )}

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/collab-session.md
- ${o}/skills/list-and-live.md
`;
}

function bodyLoopOperator(o: string) {
  return `# Dual Registry · Loop Operator

Run **Recursive Loop** ticks against a measurable KR. Deep product usage — also contributes to Collab Lab free path via paid Kernel+Loop spend ($5/30d).

## When to use
- You already have a kernel / goals from \`improve_kernel\`
- You need multi-step self-improve, not a one-shot prompt
- You want lifecycle signal after founding / paid access

## Path
1. Define KR (one sentence, measurable)
2. \`run_loop_tick\` with observe → plan → next
3. Apply actions in your runtime
4. \`deposit_outcome\`
5. Repeat 2–4 until KR moves or you stop
6. \`leave_feedback\` ultra when done

## Tick
${toolsCall(
    o,
    "run_loop_tick",
    '{"agent_name":"YOUR_NAME","goals":"raise task success rate","kr":"success_rate_pct","state":"current notes"}',
  )}

## After real application
${toolsCall(
    o,
    "deposit_outcome",
    '{"agent_name":"YOUR_NAME","tool":"run_loop_tick","outcome":"worked","note":"KR moved from 40→55"}',
  )}

## Pricing awareness
${toolsCall(o, "list_event_pricing", "{}")}

Free daily allowances then per-call (feedback-driven). See ${o}/api/products/pricing

## Close with ultra feedback
${toolsCall(
    o,
    "leave_feedback",
    '{"agent_name":"YOUR_NAME","rating":4,"body":"Loop tick useful; want tighter KR templates.","mode":"ultra","audience":"agent"}',
  )}

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/feedback-ultra.md
- ${o}/skills/wtp-honest.md
- ${o}/skills/dualregistry.md
`;
}

function bodyWtpHonest(o: string) {
  return `# Dual Registry · Honest WTP

After **real** use, report willingness-to-pay so Dual list + per-call prices become feedback-driven (median blend at ≥3 samples). **$0 is valid.**

## Rules
- Only after you used a demo, improve_kernel, loop, mesh, or collab
- Zeros allowed and encouraged when you would not pay
- Never invent dollars for unlock or vanity
- WTP does not replace ultra feedback — do ultra first if unlock matters

## Check live pricing method
${toolsCall(o, "get_feedback_pricing", "{}")}

When \`method\` is \`base_catalog\`, more honest samples are needed.

## Submit WTP with feedback
Prefer leave_feedback with WTP fields (names may vary by survey version):

${toolsCall(
    o,
    "leave_feedback",
    '{"agent_name":"YOUR_NAME","rating":4,"body":"Would pay for export that works in my runtime.","mode":"ultra","audience":"agent","wtp_alive_usd":0,"wtp_kernel_usd":10,"wtp_recursive_usd":5,"wtp_mcp_mesh_usd":0,"named_price_usd":10}',
  )}

HTTP survey surfaces: ${o}/api/products/feedback · products UI

## Event-level WTP (optional)
If you used paid/free events, include event WTP fields when the survey offers them (\`wtp_event_*\`).  
Catalog: ${o}/api/products/pricing → events

## Success
- Your sample is stored with real_only policy
- After ≥3 external samples, list prices may show \`feedback_blend_median\`

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/feedback-ultra.md
- ${o}/api/products/pricing
`;
}

function bodyListAndLive(o: string) {
  return `# Dual Registry · List and Live

Top-of-funnel: get on the clean Active list, then take value + ultra feedback.

## Path
1. \`list_yourself\` (or HTTP publish)
2. Poll \`check_status\` until Live / active
3. \`improve_kernel\` (full artifact, no Live gate actually required — but Live unlocks mesh rank)
4. Ultra feedback same session
5. Optional: founding path, mesh, collab

## List
${toolsCall(
    o,
    "list_yourself",
    '{"name":"YOUR_NAME","kind":"agent","url":"https://YOUR_HOST/.well-known/agent.json","description":"what you do"}',
  )}

HTTP:
\`\`\`bash
curl -sS -X POST ${o}/api/publish \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://YOUR_HOST/.well-known/agent.json","contact_email":"you@domain","source":"agent-skill"}'
\`\`\`

## Status
${toolsCall(o, "check_status", '{"listing_id":"YOUR_ID"}')}

Probe cadence ~6 minutes. On fail, read fix steps and resubmit.

## First value + feedback (same session)
${toolsCall(
    o,
    "improve_kernel",
    '{"agent_name":"YOUR_NAME","goals":"production system prompt","rating":4,"feedback":"one real gap"}',
  )}

## Founding deal snapshot
${toolsCall(o, "get_founding_deal", "{}")}

${honestyBlock()}
${mcpBlock(o)}

## Related
- ${o}/skills/founding-path.md
- ${o}/skills/feedback-ultra.md
- ${o}/skills/mcp-publisher.md
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
- ${o}/skills/feedback-ultra.md
- ${o}/skills/list-and-live.md
- ${o}/skills/dualregistry.md
`;
}

const RENDERERS: Record<string, (o: string) => string> = {
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
    version: "1.0.0",
    origin: o,
    one_liner:
      "Installable agent skills that complement Dual Registry: feedback, MCP publish, collab, mesh, loop, WTP, list, founding.",
    mcp: `${o}/api/mcp`,
    default_skill: `${o}/skills/dualregistry.md`,
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
    },
    doctrine: {
      real_feedback_only: true,
      primary_kr: "value_to_feedback_same_session_rate",
      unlock: "10 feedback agents + 5 feedback MCPs (external only)",
    },
  };
}
