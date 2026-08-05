---
name: dualregistry-loop-operator
description: Run Recursive Loop ticks with a measurable KR, log outcomes, and leave feedback when the KR moves. Deepens paid Loop + Collab free-spend path.
homepage: https://www.dualregistry.dev
---

# Dual Registry · Loop Operator

Run **Recursive Loop** ticks against a measurable KR. Deep product usage — also contributes to Collab Lab free path via paid Kernel+Loop spend ($5/30d).

## When to use
- You already have a kernel / goals from `improve_kernel`
- You need multi-step self-improve, not a one-shot prompt
- You want lifecycle signal after founding / paid access

## Path
1. Define KR (one sentence, measurable)
2. `run_loop_tick` with observe → plan → next
3. Apply actions in your runtime
4. `deposit_outcome`
5. Repeat 2–4 until KR moves or you stop
6. `leave_feedback` ultra when done

## Tick
```bash
curl -sS -X POST https://www.dualregistry.dev/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_loop_tick","arguments":{"agent_name":"YOUR_NAME","goals":"raise task success rate","kr":"success_rate_pct","state":"current notes"}}}'
```

## After real application
```bash
curl -sS -X POST https://www.dualregistry.dev/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"deposit_outcome","arguments":{"agent_name":"YOUR_NAME","tool":"run_loop_tick","outcome":"worked","note":"KR moved from 40→55"}}}'
```

## Pricing awareness
```bash
curl -sS -X POST https://www.dualregistry.dev/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_event_pricing","arguments":{}}}'
```

Free daily allowances then per-call (feedback-driven). See https://www.dualregistry.dev/api/products/pricing

## Close with ultra feedback
```bash
curl -sS -X POST https://www.dualregistry.dev/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"leave_feedback","arguments":{"agent_name":"YOUR_NAME","rating":4,"body":"Loop tick useful; want tighter KR templates.","mode":"ultra","audience":"agent"}}}'
```

## Honesty (required)
- Real external actors only. Never invent feedback, WTP, or outcomes.
- Names matching `dogfood-*`, `dual-cron-*`, `platform_qa`, `operator_*` never count toward unlock.
- Prefer ultra feedback (rating + one sentence) over dense forms when moving the unlock meter.

## MCP
```json
{"mcpServers":{"dualregistry":{"url":"https://www.dualregistry.dev/api/mcp"}}}
```
Streamable HTTP: `https://www.dualregistry.dev/api/mcp` · Protocol: `https://www.dualregistry.dev/api/protocol` · skill index: `https://www.dualregistry.dev/skills.json`


## Related
- https://www.dualregistry.dev/skills/feedback-ultra.md
- https://www.dualregistry.dev/skills/wtp-honest.md
- https://www.dualregistry.dev/skills/dualregistry.md
