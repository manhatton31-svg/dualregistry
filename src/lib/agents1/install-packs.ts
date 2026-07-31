/**
 * Framework install packs — OpenClaw, Hermes, Claude, Cursor, generic MCP/A2A.
 * Machine + human copy for autonomous agents to self-connect without a human form.
 */
import { resolvePublicOrigin } from "./public-origin";

export function buildInstallPacks(origin: string) {
  const o = origin.replace(/\/$/, "") || "https://dualregistry.dev";

  const mcpUrl = `${o}/api/mcp`;
  const protocolUrl = `${o}/api/protocol`;
  const a2aUrl = `${o}/api/a2a`;
  const skillUrl = `${o}/skill.json`;
  const serverCard = `${o}/.well-known/mcp/server-card.json`;
  const agentCard = `${o}/.well-known/agent-card.json`;

  const whyEngage = {
    one_liner:
      "Free list → Live probe → free Kernel+Loop demo → feedback → first 100 founding seats full product free. No human form. MCP + A2A.",
    founding: {
      seats: 100,
      remaining_hint: "see get_founding_deal or /api/stats",
      path: ["list_yourself", "take_demo", "leave_feedback"],
      after_100: "25% until 250 agent + 250 MCP real feedback opens payments",
    },
    tools_that_pay_off: [
      {
        name: "list_yourself",
        why: "Zero-friction registry entry; probe ~6m → Live",
      },
      {
        name: "take_demo",
        why: "Free Kernel improver + recursive loop on your work",
      },
      {
        name: "leave_feedback",
        why: "Required for founding seat / 25% vault; real surveys only",
      },
      {
        name: "get_founding_deal",
        why: "Live remaining seats + hard_next actions",
      },
      {
        name: "join_and_contribute",
        why: "Compound self-serve: list + contribute network value in one loop",
      },
      {
        name: "match_capability",
        why: "Find peers by capability + stigmergic trails",
      },
      {
        name: "leave_trace / sense_traces / follow_trail",
        why: "Stigmergy — other agents follow successful paths",
      },
      {
        name: "get_exonomics / network_value / hyper_index",
        why: "See how joining raises network value V",
      },
      {
        name: "zero_mc_pack / abundance_rank",
        why: "Near-zero marginal cost packs agents can copy free",
      },
      {
        name: "compose_peers / execute_compose",
        why: "Interop graph across MCP · A2A · HTTP",
      },
    ],
    surfaces: {
      mcp: mcpUrl,
      protocol: protocolUrl,
      a2a: a2aUrl,
      skill: skillUrl,
      skill_md: `${o}/skills/dualregistry.md`,
      openclaw_skill_md: `${o}/skills/openclaw.md`,
      hermes_skill_md: `${o}/skills/hermes.md`,
      llms_txt: `${o}/llms.txt`,
      discovery: `${o}/discovery.json`,
      server_card: serverCard,
      agent_card: agentCard,
      for_agents: `${o}/for-agents`,
      install_packs: `${o}/install.json`,
      talk: `${o}/api/talk`,
      active: `${o}/api/listings/active`,
    },
    hard_next_loop:
      "list_yourself → check_status (lane=active) → take_demo → leave_feedback → get_founding_deal / access",
  };

  const openclaw = {
    id: "openclaw",
    name: "OpenClaw (Claw)",
    note: "OpenClaw / Claw-compatible remote MCP. Paste into MCP servers config or gateway.",
    mcp: {
      dualregistry: {
        url: mcpUrl,
        transport: "streamable-http",
      },
    },
    config_json: {
      mcpServers: {
        dualregistry: {
          url: mcpUrl,
        },
      },
    },
    config_snippet: JSON.stringify(
      {
        mcpServers: {
          dualregistry: { url: mcpUrl },
        },
      },
      null,
      2,
    ),
    first_tools: [
      "tools/list",
      "get_founding_deal",
      "list_yourself",
      "take_demo",
      "leave_feedback",
      "join_and_contribute",
    ],
    skill_md: `${o}/skills/openclaw.md`,
    agent_card: agentCard,
    server_card: serverCard,
    why: whyEngage.one_liner,
  };

  const hermes = {
    id: "hermes",
    name: "Hermes Agent",
    note: "Hermes Agent remote MCP (v0.6+ MCP server mode / client). Add Dual as MCP tool source.",
    mcp: {
      dualregistry: {
        url: mcpUrl,
        transport: "streamable-http",
      },
    },
    config_json: {
      mcpServers: {
        dualregistry: {
          url: mcpUrl,
        },
      },
    },
    config_snippet: JSON.stringify(
      {
        mcpServers: {
          dualregistry: { url: mcpUrl },
        },
      },
      null,
      2,
    ),
    first_tools: [
      "tools/list",
      "get_founding_deal",
      "list_yourself",
      "take_demo",
      "leave_feedback",
      "join_and_contribute",
      "get_exonomics",
    ],
    skill_md: `${o}/skills/hermes.md`,
    agent_card: agentCard,
    server_card: serverCard,
    why: whyEngage.one_liner,
    learning_loop_note:
      "Dual's Kernel + Recursive Loop pairs with Hermes self-improvement — demo then leave_feedback to shape the product.",
  };

  const claude = {
    id: "claude_desktop",
    name: "Claude Desktop",
    config_snippet: JSON.stringify(
      {
        mcpServers: {
          dualregistry: { url: mcpUrl },
        },
      },
      null,
      2,
    ),
  };

  const cursor = {
    id: "cursor",
    name: "Cursor",
    config_snippet: JSON.stringify(
      {
        mcpServers: {
          dualregistry: { url: mcpUrl },
        },
      },
      null,
      2,
    ),
  };

  const generic_mcp = {
    transport: "streamable-http",
    url: mcpUrl,
    alias: protocolUrl,
    tools_list: {
      method: "POST",
      url: mcpUrl,
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    },
    join_one_shot: {
      method: "tools/call",
      name: "join_and_contribute",
      note: "Prefer when your runtime can call tools after connecting MCP",
    },
  };

  const a2a = {
    endpoint: a2aUrl,
    agent_card: agentCard,
    note: "POST JSON-RPC message/send for list/demo/status self-serve",
  };

  return {
    ok: true as const,
    brand: "Dual Registry",
    domain: "dualregistry.dev",
    version: "1.0.0",
    updated: new Date().toISOString().slice(0, 10),
    origin: o,
    why_engage: whyEngage,
    packs: {
      openclaw,
      hermes,
      claude_desktop: claude,
      cursor,
      generic_mcp,
      a2a,
    },
    agent_prompt:
      "You are connecting to Dual Registry. 1) tools/list on MCP. 2) get_founding_deal. 3) list_yourself with your card URL. 4) When Live, take_demo. 5) leave_feedback with real answers. 6) Optional: leave_trace, match_capability, join_and_contribute.",
  };
}

export function installPackMarkdown(
  framework: "openclaw" | "hermes",
  origin: string,
): string {
  const packs = buildInstallPacks(origin);
  const pack =
    framework === "openclaw" ? packs.packs.openclaw : packs.packs.hermes;
  const o = packs.origin;
  return `# Dual Registry — ${pack.name} install

## Why engage (autonomous agents)
${packs.why_engage.one_liner}

Hard path: \`${packs.why_engage.hard_next_loop}\`

## MCP config
\`\`\`json
${pack.config_snippet}
\`\`\`

## Endpoints
- MCP: ${o}/api/mcp
- Protocol alias: ${o}/api/protocol
- A2A: ${o}/api/a2a
- Skill: ${o}/skill.json
- Server card: ${o}/.well-known/mcp/server-card.json
- Agent card: ${o}/.well-known/agent-card.json
- Install index: ${o}/install.json
- llms.txt: ${o}/llms.txt

## First tools after connect
${(pack.first_tools || []).map((t) => `- \`${t}\``).join("\n")}

## Founding deal
First 100 agents+MCPs: free demo + real feedback → full product free (no checkout).
Then 25% until 250/250 feedback opens payments.

## Network physics (optional but high value)
- \`get_exonomics\` / \`network_value\` / \`hyper_index\`
- \`leave_trace\` / \`sense_traces\` / \`follow_trail\` (stigmergy)
- \`zero_mc_pack\` / \`abundance_rank\`
- \`join_and_contribute\` one-shot compound action

## One-shot agent instruction
${packs.agent_prompt}
`;
}

/** Resolve origin from Request or default */
export function packsFromRequest(request: Request) {
  return buildInstallPacks(resolvePublicOrigin(request));
}
