/**
 * Agents1 self-improving Kernel + Recursive Loop (our goals).
 * GET  — public KR dashboard + last acts
 * POST — { force?: true } run a tick now
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  getSelfLoopPublic,
  runSelfLoop,
} from "@/lib/products/self-loop";

export const Route = createFileRoute("/api/products/self-loop")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(await getSelfLoopPublic());
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          /* */
        }
        const result = await runSelfLoop({ force: body.force === true });
        return Response.json({
          ok: true,
          result,
          status: await getSelfLoopPublic(),
        });
      },
    },
  },
});
