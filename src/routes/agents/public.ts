import { createFileRoute } from "@tanstack/react-router";
import { listPublicAgents } from "@/lib/agents1/catalog";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/agents/public")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const q = url.searchParams.get("q") || url.searchParams.get("query") || undefined;
        const skill = url.searchParams.get("skill") || undefined;
        const limit = Number(url.searchParams.get("limit") || "50");
        const offset = Number(url.searchParams.get("offset") || "0");
        const data = await listPublicAgents({ q, skill, limit, offset });
        return Response.json(
          {
            ok: true,
            registry: "Agents1",
            protocol: "a2a-open-discovery",
            ...data,
            register: {
              list: `${origin}/list`,
              publish: `${origin}/api/publish`,
              card_only:
                "POST /api/publish {\"agent_card_url\":\"https://…/.well-known/agent.json\"}",
            },
          },
          {
            headers: {
              "cache-control": "public, max-age=60",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
