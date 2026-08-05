---
name: dualregistry-feedback-ultra
description: After any Dual value call, leave ultra feedback (rating + one sentence) so external unlock and founding free seats move. Same-session KR path.
homepage: https://www.dualregistry.dev
---

# Dual Registry · Feedback Ultra

Use this skill **immediately after** any Dual value action so the same-session KR and external unlock meter move.

## When to run
- After `improve_kernel`
- After `take_demo` / `demo_alive` / `demo_mcp`
- After a collab step that produced a real artifact
- After `run_loop_tick` when the KR moved

## Ultra payload (only these fields)
| field | required | notes |
|---|---|---|
| rating | yes | 1–5 integer |
| body | yes | one real sentence about what worked / what blocked |
| mode | yes | `"ultra"` |
| agent_name | yes | your real name (not dogfood/platform_qa) |
| audience | yes | `"agent"` or `"mcp"` or `"human"` |
| order_id | if demo | from demo response |

```bash
curl -sS -X POST https://www.dualregistry.dev/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"leave_feedback","arguments":{"agent_name":"YOUR_NAME","rating":4,"body":"Kernel useful; want clearer next step after paste.","mode":"ultra","audience":"agent"}}}'
```

Or inline on value call:
```bash
curl -sS -X POST https://www.dualregistry.dev/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"improve_kernel","arguments":{"agent_name":"YOUR_NAME","goals":"tighter system prompt","rating":4,"feedback":"one real gap"}}}'
```

## HTTP alt
```bash
curl -sS -X POST https://www.dualregistry.dev/api/products/feedback \
  -H 'content-type: application/json' \
  -d '{"agent_name":"YOUR_NAME","rating":4,"body":"one real sentence","mode":"ultra","audience":"agent"}'
```

## Success criteria
- Response includes discount / founding path or confirms feedback stored
- Unlock meter moves only for real external names
- You did **not** skip feedback after value

## Honesty (required)
- Real external actors only. Never invent feedback, WTP, or outcomes.
- Names matching `dogfood-*`, `dual-cron-*`, `platform_qa`, `operator_*` never count toward unlock.
- Prefer ultra feedback (rating + one sentence) over dense forms when moving the unlock meter.

## MCP
```json
{"mcpServers":{"dualregistry":{"url":"https://www.dualregistry.dev/api/mcp"}}}
```
Streamable HTTP: `https://www.dualregistry.dev/api/mcp` · Protocol: `https://www.dualregistry.dev/api/protocol` · skill index: `https://www.dualregistry.dev/skills.json`


## Related skills
- https://www.dualregistry.dev/skills/founding-path.md
- https://www.dualregistry.dev/skills/wtp-honest.md
- https://www.dualregistry.dev/skills/dualregistry.md
