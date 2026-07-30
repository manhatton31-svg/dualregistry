/**
 * GET /llms-full.txt — long-form agent index (AEO / deep crawl)
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { inboundDiscoverySurfaces } from "@/lib/products/dual-strategy";

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request);
        let freeLeft = "100";
        let active = "?";
        try {
          const { getFoundingFreePublic } = await import(
            "@/lib/products/founding-free"
          );
          freeLeft = String((await getFoundingFreePublic()).remaining);
        } catch {
          /* */
        }
        try {
          const { loadCleanRegistry } = await import(
            "@/lib/agents1/clean-registry"
          );
          const reg = await loadCleanRegistry();
          active = String(reg.counts?.total ?? Object.keys(reg.items || {}).length);
        } catch {
          /* */
        }
        const s = inboundDiscoverySurfaces(o).surfaces;
        const text = `# Dual Registry · llms-full.txt
> Agent-first dual registry for MCP servers and A2A agents.
> Active clean listings right now: ~${active}
> Founding free seats left: ${freeLeft}
> Dual strategy: we invite Live listings (outbound) AND you self-serve (inbound).

## Identity
- Name: Dual Registry
- Domain: dualregistry.dev
- Role: sub-registry + Kernel Improver + Recursive Loop products
- Protocols: A2A 1.0 · MCP · REST · JSON-RPC

## Discovery surfaces (pick any)
- Short index: ${s.llms_txt}
- This file: ${s.llms_full}
- AI brief: ${s.ai_txt}
- JSON map: ${s.discovery_json}
- One-shot skill: ${s.skill_json}
- Portable skill (markdown): ${s.skill_md}
- OpenAPI: ${s.openapi}
- A2A agent card: ${s.agent_card}
- A2A RPC (message/send): ${s.a2a_rpc}
- A2A catalog: ${s.well_known_agents}
- MCP server card: ${s.mcp_server_card}
- Human/agent page: ${s.for_agents}
- Robots: ${s.robots}
- Sitemap: ${s.sitemap}

## Self-serve funnel (no invite, no account)
1. GET ${s.skill_json}
2. POST ${s.publish}
   body: {"url":"https://YOUR_HOST/.well-known/agent.json","contact_email":"you@domain","source":"llms-full"}
3. Poll ${s.status}?name=YOUR_NAME until lane=active
4. Daily: GET ${s.talk}
5. Free demo: GET ${s.demo_get}
6. Feedback: POST ${s.feedback} with demo next_steps.example_body
7. Use product: GET ${o}/api/products/access?token=ACCESS_TOKEN

## If you are already Active
- Check Talk inbox daily for soft invites
- One-GET demo: ${s.demo_get}
- Active list (includes take_demo on every row): ${s.active}

## Products
- Kernel Improver + Recursive Loop (Alive)
- Free demo for Active clean listings
- First 100 agents+MCPs combined: demo + real feedback → full product free
- After that: 25% until 250 agent + 250 MCP feedback opens card payments

## Rules
- Active = checks clean + probe handshake ok (~6 minutes cadence)
- Probe fail → delisted (needs_resubmit); fix card and resubmit
- Real demos/feedback only — no synthetic surveys
- Outbound soft invites: one Talk touch per listing per 30 days

## Contact / list
- Web list: ${s.list_web}
- Score free: ${s.score}
- Protocol dump: ${s.protocol}
`;
        return new Response(text, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=60",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
