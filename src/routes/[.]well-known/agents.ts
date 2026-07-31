import { createFileRoute } from "@tanstack/react-router";
import { listPublicAgents } from "@/lib/agents1/catalog";
import { agents1AgentCard } from "@/lib/agents1/a2a-card";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

/** A2A registry proposal: GET /.well-known/agents — searchable registered cards */
export const Route = createFileRoute("/.well-known/agents")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const q = url.searchParams.get("q") || undefined;
        const skill = url.searchParams.get("skill") || undefined;
        const data = await listPublicAgents({ q, skill, limit: 100 });
        return Response.json(
          {
            registry: agents1AgentCard(origin),
            total: data.total,
            agents: data.items.map((a) => ({
              name: a.name,
              description: a.description,
              url: a.url,
              agent_card_url: a.agent_card_url,
              skills: a.skills,
              capabilities: a.capabilities,
              protocols: a.protocols,
              safety_score: a.safety_score,
            })),
            search: `${origin}/agents/search`,
            public: `${origin}/agents/public`,
          },
          {
            headers: {
              "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
              "cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "vercel-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
