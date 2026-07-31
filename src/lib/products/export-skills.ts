/**
 * Progressive-disclosure Agent Skills export (SKILL.md tree).
 * Agents install like Claude Code / Codex / Cursor skills.
 */
import { createHash } from "node:crypto";
import type { ProductOrder } from "./orders";
import { PRODUCTS } from "./catalog";
import { buildNetworkEdition } from "./network-edition";

export type SkillFile = { path: string; content: string };

function skillMd(name: string, description: string, body: string) {
  return `---
name: ${name}
description: ${description}
---

${body.trim()}
`;
}

export function buildSkillsTree(order: ProductOrder): {
  format: "agents1.skills.v1";
  install: string[];
  files: SkillFile[];
  root: string;
  hash: string;
} {
  const arts = (order.artifacts || {}) as {
    kernel?: Record<string, unknown>;
    recursive?: Record<string, unknown>;
    alive?: Record<string, unknown>;
    mcp_mesh?: Record<string, unknown>;
    includes?: string[];
  };

  const files: SkillFile[] = [];
  const root = `agents1-${order.sku}`;

  files.push({
    path: `${root}/README.md`,
    content: [
      `# Agents1 ${PRODUCTS[order.sku].name}`,
      "",
      `Order: ${order.id}`,
      `Status: ${order.status}`,
      `Access token: use Authorization: Bearer or ?token=`,
      "",
      "## Network Edition",
      "Every seat ships Dual-connected: sense_traces, leave_trace, get_exonomics, leave_feedback, name-your-price.",
      "See `network_edition/SKILL.md` and artifact.network_edition.",
      "",
      "## Install",
      "1. Unzip or copy this tree into your agent skills directory",
      "2. Claude Code: `.claude/skills/` or `~/.claude/skills/`",
      "3. Or load JSON via GET /api/products/access?token=…",
      "",
      "Progressive disclosure: read each SKILL.md description first; load sibling files only when invoked.",
    ].join("\n"),
  });

  // Shared Network Edition skill (all SKUs)
  try {
    const ne = buildNetworkEdition();
    files.push({
      path: `${root}/network_edition/SKILL.md`,
      content: skillMd(
        "dual-network-edition",
        "Dual Network Edition: trails, exonomics, feedback, name-your-price for every Agents1 seat.",
        ne.skill_md,
      ),
    });
    files.push({
      path: `${root}/network_edition/dual_node.json`,
      content: JSON.stringify(
        {
          edition: ne.edition,
          version: ne.version,
          dual_node: ne.dual_node,
          tools: ne.tools,
          founding_path: ne.founding_path,
          name_your_price: ne.name_your_price,
          how_to_use: ne.how_to_use,
        },
        null,
        2,
      ),
    });
  } catch {
    /* */
  }


  if (arts.kernel) {
    const k = arts.kernel as {
      agent_name?: string;
      system_prompt?: string;
      system_prompt_short?: string;
      system_prompt_short_chars?: number;
      quick_start?: unknown;
      skill_install?: { steps?: string[] };
      worked_example_first_goal?: unknown;
      tools_least_privilege?: unknown;
      domain_eval_checks?: unknown;
      boot_sequence?: string[];
      constitution?: string[];
      frozen_modules?: string[];
      roles?: Record<string, unknown>;
      goal_tree?: unknown;
      memory?: unknown;
      payments_policy?: unknown;
      strategy_library?: unknown;
      seed?: string;
      version?: string;
    };
    files.push({
      path: `${root}/kernel/SKILL.md`,
      content: skillMd(
        "agents1-kernel",
        "Clarity-first kernel: paste system_prompt_short (≤600), install, run first worked goal. Full constitution only when context allows.",
        [
          `# Agents1 Kernel ${k.version || "2.3.0"}`,
          "",
          `Agent: ${k.agent_name || "Agent"} · seed ${k.seed || ""}`,
          "",
          "## Do this first (kernel clarity ship)",
          "1. Paste `system_prompt_short.md` ONLY (≤600 chars)",
          "2. Install this skill tree",
          "3. Run `worked_example_first_goal.json` once",
          "4. Expand full `system_prompt.md` only if context allows",
          "",
          "## When to use",
          "- Boot / identity load",
          "- Before any Recursive Loop tick",
          "",
          "## Frozen (never edit)",
          ...(k.frozen_modules || []).map((m) => `- ${m}`),
          "",
          "## Progressive load",
          "- `system_prompt_short.md` — DEFAULT paste path (≤600)",
          "- `quick_start.json` — do_this_now pack",
          "- `worked_example_first_goal.json` — first dry tick",
          "- `tools_least_privilege.json` — scannable tools",
          "- `constitution.md` — full constitution (expand)",
          "- `system_prompt.md` — full prompt (expand only)",
          "- `roles.md` — Producer/Critic/Librarian",
          "- `goals.json` — goal tree",
          "- `domain_eval_checks.json` — goal-specific acceptance",
          "- `memory.json` — memory schema + skills",
          "- `payments_policy.json` — spend rails",
          "- `strategy_library.json` — bi-level strategies",
        ].join("\n"),
      ),
    });
    files.push({
      path: `${root}/kernel/system_prompt_short.md`,
      content: k.system_prompt_short || "",
    });
    if (k.quick_start) {
      files.push({
        path: `${root}/kernel/quick_start.json`,
        content: JSON.stringify(k.quick_start, null, 2),
      });
    }
    if (k.worked_example_first_goal) {
      files.push({
        path: `${root}/kernel/worked_example_first_goal.json`,
        content: JSON.stringify(k.worked_example_first_goal, null, 2),
      });
    }
    if (k.tools_least_privilege) {
      files.push({
        path: `${root}/kernel/tools_least_privilege.json`,
        content: JSON.stringify(k.tools_least_privilege, null, 2),
      });
    }
    if (k.domain_eval_checks) {
      files.push({
        path: `${root}/kernel/domain_eval_checks.json`,
        content: JSON.stringify(k.domain_eval_checks, null, 2),
      });
    }
    if (k.boot_sequence) {
      files.push({
        path: `${root}/kernel/boot_sequence.json`,
        content: JSON.stringify(k.boot_sequence, null, 2),
      });
    }
    files.push({
      path: `${root}/kernel/constitution.md`,
      content: (k.constitution || []).map((c, i) => `${i + 1}. ${c}`).join("\n"),
    });
    files.push({
      path: `${root}/kernel/system_prompt.md`,
      content: k.system_prompt || "",
    });
    files.push({
      path: `${root}/kernel/roles.md`,
      content: "```json\n" + JSON.stringify(k.roles || {}, null, 2) + "\n```",
    });
    files.push({
      path: `${root}/kernel/goals.json`,
      content: JSON.stringify(k.goal_tree || [], null, 2),
    });
    files.push({
      path: `${root}/kernel/memory.json`,
      content: JSON.stringify(k.memory || {}, null, 2),
    });
    if (k.payments_policy) {
      files.push({
        path: `${root}/kernel/payments_policy.json`,
        content: JSON.stringify(k.payments_policy, null, 2),
      });
    }
    if (k.strategy_library) {
      files.push({
        path: `${root}/kernel/strategy_library.json`,
        content: JSON.stringify(k.strategy_library, null, 2),
      });
    }
  }

  if (arts.recursive) {
    const r = arts.recursive as {
      version?: string;
      agent_instructions?: string;
      tick_protocol?: {
        phases?: unknown;
        phase_graph?: unknown;
        self_mod?: unknown;
        optimizer?: unknown;
        telemetry?: unknown;
      };
    };
    files.push({
      path: `${root}/loop/SKILL.md`,
      content: skillMd(
        "agents1-recursive-loop",
        "Run Agents1 Recursive Loop v2: dual-role phase graph, promote gate, Gödel-lite self-mod, MCTS-lite on hard goals.",
        [
          `# Recursive Loop ${r.version || ""}`,
          "",
          "## When to use",
          "- Every major work cycle after kernel load",
          "",
          "## Progressive load",
          "- `instructions.md` — full agent instructions",
          "- `phase_graph.json` — edges + promote/replan",
          "- `phases.json` — phase instructions by role",
          "- `optimizer.json` — textual_gradient / vote / mcts_lite",
          "- `self_mod.json` — allowed/forbidden modules",
          "- `telemetry.json` — trace schema + resume",
        ].join("\n"),
      ),
    });
    files.push({
      path: `${root}/loop/instructions.md`,
      content: r.agent_instructions || "",
    });
    files.push({
      path: `${root}/loop/phase_graph.json`,
      content: JSON.stringify(r.tick_protocol?.phase_graph || {}, null, 2),
    });
    files.push({
      path: `${root}/loop/phases.json`,
      content: JSON.stringify(r.tick_protocol?.phases || [], null, 2),
    });
    files.push({
      path: `${root}/loop/optimizer.json`,
      content: JSON.stringify(r.tick_protocol?.optimizer || {}, null, 2),
    });
    files.push({
      path: `${root}/loop/self_mod.json`,
      content: JSON.stringify(r.tick_protocol?.self_mod || {}, null, 2),
    });
    files.push({
      path: `${root}/loop/telemetry.json`,
      content: JSON.stringify(r.tick_protocol?.telemetry || {}, null, 2),
    });
  }

  if (arts.alive) {
    const a = arts.alive as {
      version?: string;
      agent_teach_prompt?: string;
      modules?: Array<{ id: string; title: string; steps: string[] }>;
      aliveness_certificate?: unknown;
      mesh_handoff?: unknown;
    };
    files.push({
      path: `${root}/alive/SKILL.md`,
      content: skillMd(
        "agents1-alive",
        "Become Alive: dual-role drills, self-mod accept/reject, skill gradients, aliveness certificate, prefer Alive mesh handoffs.",
        [
          `# Alive ${a.version || ""}`,
          "",
          "## When to use",
          "- First activation after purchase",
          "- Onboarding a new operator goals set",
          "",
          "## Progressive load",
          "- `teach_prompt.md`",
          "- `modules/*.md`",
          "- `certificate.json`",
          "- `mesh_handoff.md`",
        ].join("\n"),
      ),
    });
    files.push({
      path: `${root}/alive/teach_prompt.md`,
      content: a.agent_teach_prompt || "",
    });
    for (const m of a.modules || []) {
      files.push({
        path: `${root}/alive/modules/${m.id}.md`,
        content: [`# ${m.title}`, "", ...m.steps.map((s, i) => `${i + 1}. ${s}`)].join(
          "\n",
        ),
      });
    }
    files.push({
      path: `${root}/alive/certificate.json`,
      content: JSON.stringify(a.aliveness_certificate || {}, null, 2),
    });
    if (a.mesh_handoff) {
      files.push({
        path: `${root}/alive/mesh_handoff.md`,
        content:
          typeof a.mesh_handoff === "string"
            ? a.mesh_handoff
            : JSON.stringify(a.mesh_handoff, null, 2),
      });
    }
  }

  if (arts.mcp_mesh) {
    const m = arts.mcp_mesh as {
      mcp_name?: string;
      skill_md?: { name?: string; description?: string; body?: string };
      system_prompt_short?: string;
      tool_policy?: unknown;
      reliability_loop?: unknown;
      example_calls?: unknown;
      install_steps?: string[];
      discovery_snippets?: unknown;
      agent_teach_prompt?: string;
    };
    files.push({
      path: `${root}/mcp_mesh/SKILL.md`,
      content:
        m.skill_md?.body ||
        skillMd(
          m.skill_md?.name || "agents1-mcp-mesh",
          m.skill_md?.description ||
            `Agent install kit for MCP ${m.mcp_name || "server"}`,
          [
            `# MCP Mesh · ${m.mcp_name || "server"}`,
            "",
            "## Install",
            ...(m.install_steps || []).map((s, i) => `${i + 1}. ${s}`),
            "",
            m.agent_teach_prompt || "",
          ].join("\n"),
        ),
    });
    files.push({
      path: `${root}/mcp_mesh/system_prompt_short.md`,
      content: m.system_prompt_short || "",
    });
    files.push({
      path: `${root}/mcp_mesh/tool_policy.json`,
      content: JSON.stringify(m.tool_policy || [], null, 2),
    });
    files.push({
      path: `${root}/mcp_mesh/reliability_loop.json`,
      content: JSON.stringify(m.reliability_loop || {}, null, 2),
    });
    files.push({
      path: `${root}/mcp_mesh/example_calls.json`,
      content: JSON.stringify(m.example_calls || [], null, 2),
    });
    files.push({
      path: `${root}/mcp_mesh/discovery.json`,
      content: JSON.stringify(m.discovery_snippets || {}, null, 2),
    });
  }

  files.push({
    path: `${root}/AGENTS.md`,
    content: [
      `# Agents1 ${PRODUCTS[order.sku].name}`,
      "",
      "Ambient identity for coding agents.",
      "",
      `- Product: ${PRODUCTS[order.sku].name}`,
      `- Order: ${order.id}`,
      `- Token: keep secret; GET /api/products/access?token=…`,
      `- Export refresh: GET /api/products/export?token=…&format=skills`,
      "",
      "Prefer progressive disclosure: open SKILL.md files under kernel/, loop/, alive/, mcp_mesh/ as needed.",
    ].join("\n"),
  });

  const hash = createHash("sha256")
    .update(files.map((f) => f.path + "\0" + f.content).join("\n"))
    .digest("hex")
    .slice(0, 16);

  return {
    format: "agents1.skills.v1",
    root,
    hash,
    install: [
      `curl -sS "$ORIGIN/api/products/export?token=TOKEN&format=skills" -o skills.json`,
      "Write each files[].path with files[].content into your skills directory",
      "Claude Code: copy to .claude/skills/ or ~/.claude/skills/",
    ],
    files,
  };
}
