/**
 * GET /api/products/reciprocity — trust graph + clean/verified badges.
 * POST — evaluate a listing_id / url.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import {
  getReciprocityFor,
  getReciprocityPublic,
} from "@/lib/products/reciprocity";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

export const Route = createFileRoute("/api/products/reciprocity")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const url = new URL(request.url);
        const id =
          url.searchParams.get("id") ||
          url.searchParams.get("listing_id") ||
          "";
        const name = url.searchParams.get("name") || "";
        const card = url.searchParams.get("url") || "";
        if (!id && !name && !card) {
          const pub = await getReciprocityPublic();
          return Response.json(
            {
              ...pub,
              usage: {
                evaluate: `${origin}/api/products/reciprocity?id=LISTING_ID`,
                badge_clean: `${origin}/badge/clean.svg?id=LISTING_ID`,
                badge_verified: `${origin}/badge/verified.svg?id=LISTING_ID`,
                tool: "get_reciprocity via POST /api/protocol tools/call",
              },
            },
            {
              headers: withDemoCtaHeaders(
                {
                  "cache-control": "no-store",
                  "access-control-allow-origin": "*",
                },
                { origin },
              ),
            },
          );
        }
        const result = await getReciprocityFor({
          listing_id: id || undefined,
          name: name || undefined,
          url: card || undefined,
          origin,
        });
        return Response.json(result, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
            { origin },
          ),
        });
      },
      POST: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        let body: {
          listing_id?: string;
          id?: string;
          name?: string;
          url?: string;
        } = {};
        try {
          body = await request.json();
        } catch {
          /* */
        }
        const result = await getReciprocityFor({
          listing_id: body.listing_id || body.id,
          name: body.name,
          url: body.url,
          origin,
        });
        return Response.json(result, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
            { origin },
          ),
        });
      },
    },
  },
});
