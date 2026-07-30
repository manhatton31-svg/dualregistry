import { createFileRoute } from "@tanstack/react-router";
import { getLearningPublic, runProductLearningCycle } from "@/lib/products/learning-loop";

export const Route = createFileRoute("/api/products/learning")({
  server: {
    handlers: {
      GET: async () => {
        const data = await getLearningPublic();
        return Response.json(data, {
          headers: {
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      },
      POST: async () => {
        const s = await runProductLearningCycle();
        return Response.json({
          ok: true,
          cycles: s.cycles,
          recommendations: s.recommendations,
          offered_best: s.offered_best,
          funnel: s.funnel,
        });
      },
    },
  },
});
