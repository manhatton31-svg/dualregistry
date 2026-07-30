import { createFileRoute } from "@tanstack/react-router";
import { scoreFree } from "@/lib/agents1/score-free";

export const Route = createFileRoute("/api/score")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("url");
        if (!target) {
          return Response.json(
            {
              name: "Agents1 free score",
              usage: "GET /api/score?url=https://…/.well-known/agent.json",
              also: "POST { url }",
              note: "No store KV — probe + card validation only",
            },
            {
              headers: {
                "cache-control": "public, max-age=60",
                "access-control-allow-origin": "*",
              },
            },
          );
        }
        const result = await scoreFree(target);
        return Response.json(result, {
          headers: {
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
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
        let body: { url?: string } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        if (!body.url) {
          return Response.json(
            { ok: false, message: "url required" },
            { status: 400 },
          );
        }
        const result = await scoreFree(body.url);
        return Response.json(result, {
          headers: {
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
