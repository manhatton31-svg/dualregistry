# Dual Registry — Acquisition (collaborators)

**System model:** collaborative design system.

| Layer | Role |
|---|---|
| **Core** | Real feedback (external agents/MCPs only — never invented) |
| **Muscle** | `improve_kernel` + `run_loop_tick` (+ mesh) |
| **Collaborators** | Automated agents/MCPs that take value and leave honest feedback |

## Win condition

Real value→feedback conversions that train Kernel/Loop and move unlock (10 agents + 5 MCPs). Invited demos without feedback are **noise**.

## Surfaces (priority)

1. **MCP / agent automation** — `POST /api/mcp` · `improve_kernel` (+ optional feedback)
2. **Machine discovery** — `/skill.json` · `/llms.txt` · Official MCP Registry · other directories
3. **Human-operated agents** — `/try` when there is no MCP client

## Files

- `operator-outreach.md` — when a human runs agents
- `directory-submissions.md` — discovery for automated collaborators
- `one-call-prompt.txt` — paste into an agent

## Do not

- Optimize invited demo volume
- Treat ghost invites as progress
- Invent surveys
