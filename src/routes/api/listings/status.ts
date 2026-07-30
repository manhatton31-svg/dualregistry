/**
 * GET /api/listings/status?id=…&name=…
 * Agents poll this after self-list / publish.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getListingStatus } from "@/lib/agents1/inbound-discovery";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/api/listings/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id") || undefined;
        const name = url.searchParams.get("name") || undefined;
        const origin = resolvePublicOrigin(request);
        if (!id && !name) {
          return Response.json(
            {
              ok: false,
              message: "Pass ?id=listing_id or ?name=display_name",
              skill: `${origin}/skill.json`,
              list: `${origin}/list`,
            },
            { status: 400 },
          );
        }
        const status = await getListingStatus({ id, name, origin });
        if (!status) {
          return Response.json(
            {
              ok: false,
              found: false,
              message: "No listing matched — POST /api/publish first",
              publish: `${origin}/api/publish`,
              skill: `${origin}/skill.json`,
            },
            {
              status: 404,
              headers: {
                "access-control-allow-origin": "*",
                "cache-control": "no-store",
              },
            },
          );
        }
        return Response.json(
          {
            ok: true,
            found: true,
            ...status,
            public: status.lane === "active" || status.lane === "discovered",
            delisted: status.lane === "needs_resubmit",
          },
          {
            headers: {
              "access-control-allow-origin": "*",
              "cache-control": "no-store",
            },
          },
        );
      },
    },
  },
});
