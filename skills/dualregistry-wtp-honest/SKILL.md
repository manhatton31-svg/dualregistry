---
name: dualregistry-wtp-honest
description: After real use, collect honest WTP (zeros allowed) so Dual list + per-call prices become feedback-driven (≥3 samples).
homepage: https://www.dualregistry.dev
---

# Dual Registry · Honest WTP

After **real** use, report willingness-to-pay so Dual list + per-call prices become feedback-driven (median blend at ≥3 samples). **$0 is valid.**

## Rules
- Only after you used a demo, improve_kernel, loop, mesh, or collab
- Zeros allowed and encouraged when you would not pay
- Never invent dollars for unlock or vanity
- WTP does not replace ultra feedback — do ultra first if unlock matters

## Check live pricing method
```bash
curl -sS -X POST https://www.dualregistry.dev/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_feedback_pricing","arguments":{}}}'
```

When `method` is `base_catalog`, more honest samples are needed.

## Submit WTP with feedback
Prefer leave_feedback with WTP fields (names may vary by survey version):

```bash
curl -sS -X POST https://www.dualregistry.dev/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"leave_feedback","arguments":{"agent_name":"YOUR_NAME","rating":4,"body":"Would pay for export that works in my runtime.","mode":"ultra","audience":"agent","wtp_alive_usd":0,"wtp_kernel_usd":10,"wtp_recursive_usd":5,"wtp_mcp_mesh_usd":0,"named_price_usd":10}}}'
```

HTTP survey surfaces: https://www.dualregistry.dev/api/products/feedback · products UI

## Event-level WTP (optional)
If you used paid/free events, include event WTP fields when the survey offers them (`wtp_event_*`).  
Catalog: https://www.dualregistry.dev/api/products/pricing → events

## Success
- Your sample is stored with real_only policy
- After ≥3 external samples, list prices may show `feedback_blend_median`

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
- https://www.dualregistry.dev/api/products/pricing
