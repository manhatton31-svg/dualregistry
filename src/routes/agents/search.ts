import { createFileRoute } from "@tanstack/react-router";
import { searchAgents } from "@/lib/agents1/catalog";

export const Route = createFileRoute("/agents/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const data = await searchAgents({
          query: url.searchParams.get("q") || undefined,
          skill: url.searchParams.get("skill") || undefined,
          capability: url.searchParams.get("capability") || undefined,
          limit: Number(url.searchParams.get("limit") || "50"),
        });
        return Response.json(
          { ok: true, ...data },
          {
            headers: {
              "cache-control": "public, max-age=30",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        }),
      POST: async ({ request }) => {
        let body: {
          query?: string;
          skill?: string;
          capability?: string;
          limit?: number;
        } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        const data = await searchAgents(body);
        return Response.json(
          { ok: true, ...data },
          {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
