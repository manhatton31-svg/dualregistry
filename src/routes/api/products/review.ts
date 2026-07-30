/**
 * Human review queue for system-wide Kernel/Loop candidates.
 * Actions: list | start_canary | ship | reject
 * Never auto-merges open themes into global generators.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  listReviewQueue,
  startCanary,
  shipTheme,
  rejectTheme,
  measureCanary,
  SYSTEM_THEME_THRESHOLD,
  CANARY_COHORT_SIZE,
} from "@/lib/products/system-ship";
import { listFulfilledOrders } from "@/lib/products/orders";

export const Route = createFileRoute("/api/products/review")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        }),
      GET: async () => {
        const q = await listReviewQueue();
        return Response.json(
          {
            ok: true,
            ...q,
            actions: {
              start_canary: {
                body: {
                  action: "start_canary",
                  theme: "string",
                  order_ids: "string[]? — defaults to first paid seats",
                  note: "string?",
                },
              },
              ship: {
                body: { action: "ship", theme: "string", note: "string?" },
                note: "Prefer after canary weekly re-measure",
              },
              reject: {
                body: { action: "reject", theme: "string", note: "string?" },
              },
              measure_canary: {
                body: {
                  action: "measure_canary",
                  theme: "string",
                  canary_ratings: "number[]?",
                  control_ratings: "number[]?",
                },
              },
            },
          },
          {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
      POST: async ({ request }) => {
        let body: {
          action?: string;
          theme?: string;
          order_ids?: string[];
          note?: string;
        } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "JSON required" },
            { status: 400 },
          );
        }
        const action = String(body.action || "");
        const theme = String(body.theme || "").trim();
        if (!theme && action !== "list") {
          return Response.json(
            { ok: false, error: "theme required" },
            { status: 400 },
          );
        }
        try {
          if (action === "start_canary") {
            let ids = Array.isArray(body.order_ids)
              ? body.order_ids.map(String)
              : [];
            if (!ids.length) {
              const paid = (await listFulfilledOrders()).filter(
                (o) => o.status === "fulfilled",
              );
              ids = paid.slice(0, CANARY_COHORT_SIZE).map((o) => o.id);
            }
            const item = await startCanary(theme, ids, body.note);
            return Response.json({
              ok: true,
              item,
              message: `Canary started for ${theme} on ${item.canary_order_ids.length} orders. Re-measure weekly surveys, then ship or reject.`,
            });
          }
          if (action === "ship") {
            const item = await shipTheme(theme, body.note);
            return Response.json({
              ok: true,
              item,
              message: `Shipped ${theme} into global Kernel/Loop generators. New builds pick up directives.`,
            });
          }
          if (action === "reject") {
            const item = await rejectTheme(theme, body.note);
            return Response.json({
              ok: true,
              item,
              message: `Rejected ${theme}. Individual personalization remains; global generators unchanged.`,
            });
          }
          if (action === "measure_canary") {
            const item = await measureCanary(theme, {
              canary: Array.isArray((body as any).canary_ratings)
                ? (body as any).canary_ratings.map(Number)
                : undefined,
              control: Array.isArray((body as any).control_ratings)
                ? (body as any).control_ratings.map(Number)
                : undefined,
            });
            return Response.json({
              ok: true,
              item,
              ab_metrics: item.ab_metrics,
              message: item.ab_metrics?.ship_recommended
                ? "A/B looks good — safe to ship"
                : "A/B not clear — hold or reject",
            });
          }
          return Response.json(
            {
              ok: false,
              error: "action must be start_canary | ship | reject | measure_canary",
              threshold: SYSTEM_THEME_THRESHOLD,
            },
            { status: 400 },
          );
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
