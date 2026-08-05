/**
 * GET/POST /api/products/collab-market — sellable collab packs
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import {
  COLLAB_MARKET_VERSION,
  getMarketPublic,
  listMarket,
  getMarketListing,
  installCollabProduct,
  publishCollabProduct,
  buyCollabProduct,
} from "@/lib/products/collab-marketplace";
import { getWorkflow, packageProduct } from "@/lib/products/collab-studio";

export const Route = createFileRoute("/api/products/collab-market")({
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
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const action = (url.searchParams.get("action") || "list").toLowerCase();
        const product_id = url.searchParams.get("product_id") || "";
        if (action === "install" && product_id) {
          const result = await installCollabProduct({
            product_id,
            origin,
            listing_id: url.searchParams.get("listing_id") || undefined,
            agent_name: url.searchParams.get("agent_name") || undefined,
            access_token: url.searchParams.get("access_token") || undefined,
          });
          return Response.json(result, {
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store", "access-control-allow-origin": "*", "x-dual-collab-market": COLLAB_MARKET_VERSION },
              { origin },
            ),
          });
        }
        if (product_id) {
          const listing = await getMarketListing(product_id);
          return Response.json(
            listing ? { ok: true, listing } : { ok: false, error: "not_found" },
            {
              status: listing ? 200 : 404,
              headers: withDemoCtaHeaders(
                { "cache-control": "no-store", "access-control-allow-origin": "*", "x-dual-collab-market": COLLAB_MARKET_VERSION },
                { origin },
              ),
            },
          );
        }
        const body = await getMarketPublic({ origin });
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            { "cache-control": "no-store", "access-control-allow-origin": "*", "x-dual-collab-market": COLLAB_MARKET_VERSION },
            { origin },
          ),
        });
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const action = String(body.action || body.op || "list").toLowerCase();
        let result: unknown;

        if (action === "publish") {
          const workflow_id = String(body.workflow_id || "");
          let draft = body.draft as import("@/lib/products/collab-studio").CollabProductDraft | undefined;
          if (!draft && workflow_id) {
            const wf = await getWorkflow(workflow_id);
            if (wf?.product) draft = wf.product;
            else {
              const pkg = await packageProduct(workflow_id, origin, {
                title: typeof body.title === "string" ? body.title : undefined,
                price_cents: typeof body.price_cents === "number" ? body.price_cents : undefined,
              });
              draft = pkg.product;
            }
          }
          if (!draft) {
            result = { ok: false, error: "workflow_id or draft required" };
          } else {
            result = await publishCollabProduct({
              draft,
              workflow_id: workflow_id || draft.product_id,
              session_id: typeof body.session_id === "string" ? body.session_id : undefined,
              origin,
              price_cents: typeof body.price_cents === "number" ? body.price_cents : undefined,
            });
          }
        } else if (action === "install") {
          result = await installCollabProduct({
            product_id: String(body.product_id || ""),
            origin,
            listing_id: typeof body.listing_id === "string" ? body.listing_id : undefined,
            agent_name: typeof body.agent_name === "string" ? body.agent_name : undefined,
            access_token: typeof body.access_token === "string" ? body.access_token : undefined,
          });
        } else if (action === "list") {
          result = {
            ok: true,
            listings: await listMarket({
              q: typeof body.q === "string" ? body.q : undefined,
              limit: typeof body.limit === "number" ? body.limit : 40,
            }),
          };
        } else if (action === "buy" || action === "checkout") {
          result = await buyCollabProduct({
            product_id: String(body.product_id || ""),
            origin,
            agent_name: typeof body.agent_name === "string" ? body.agent_name : undefined,
            email: typeof body.email === "string" ? body.email : undefined,
            listing_id: typeof body.listing_id === "string" ? body.listing_id : undefined,
            demo: body.demo === true,
            named_price_usd:
              typeof body.named_price_usd === "number"
                ? body.named_price_usd
                : undefined,
          });
        } else {
          result = { ok: false, error: "unknown_action", allowed: ["publish", "install", "list", "buy"] };
        }

        return Response.json(result, {
          headers: withDemoCtaHeaders(
            { "cache-control": "no-store", "access-control-allow-origin": "*", "x-dual-collab-market": COLLAB_MARKET_VERSION },
            { origin },
          ),
        });
      },
    },
  },
});
