/**
 * GET /api/listings/status?id=…&name=…
 * Agents poll this after self-list / publish.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getListingStatus } from "@/lib/agents1/inbound-discovery";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";

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
              demo_get: `${origin}/api/products/demo`,
            },
            {
              status: 400,
              headers: withDemoCtaHeaders(
                { "cache-control": "no-store" },
                { origin },
              ),
            },
          );
        }
        const status = await getListingStatus({ id, name, origin });
        // Merge delist instructions if recently delisted
        let delist = null;
        try {
          const { listRecentDelists } = await import(
            "@/lib/agents1/delist-on-fail"
          );
          const recent = await listRecentDelists(100);
          delist =
            recent.find(
              (d) =>
                (id && d.id === id) ||
                (name &&
                  (d.name || "").toLowerCase() === name.toLowerCase()),
            ) || null;
        } catch {
          /* */
        }
        if (!status && !delist) {
          return Response.json(
            {
              ok: false,
              found: false,
              message: "No listing matched — POST /api/publish first",
              publish: `${origin}/api/publish`,
              skill: `${origin}/skill.json`,
              demo_get: id
                ? `${origin}/api/products/demo?listing_id=${encodeURIComponent(id)}`
                : `${origin}/api/products/demo`,
            },
            {
              status: 404,
              headers: withDemoCtaHeaders(
                { "cache-control": "no-store" },
                { origin, listing_id: id },
              ),
            },
          );
        }
        if (!status && delist) {
          return Response.json(
            {
              ok: true,
              found: true,
              delisted: true,
              public: false,
              listing_id: delist.id,
              kind: delist.kind,
              name: delist.name,
              lane: "needs_resubmit",
              lane_reason: delist.reason,
              fix: delist.fix,
              resubmit: delist.resubmit,
              message: delist.resubmit.message,
              next: "Fix card → POST /api/publish → wait for approval probe",
              demo_get: `${origin}/api/products/demo?listing_id=${encodeURIComponent(delist.id)}`,
            },
            {
              headers: withDemoCtaHeaders(
                { "cache-control": "no-store" },
                { origin, listing_id: delist.id },
              ),
            },
          );
        }
        const listingId =
          (status as { id?: string } | null)?.id || id || undefined;
        return Response.json(
          {
            ok: true,
            found: true,
            ...status,
            public: status!.lane === "active" || status!.lane === "discovered",
            delisted: status!.lane === "needs_resubmit" || Boolean(delist),
            fix:
              delist?.fix ||
              (status as { resubmit?: { fix?: string } })?.resubmit,
            resubmit:
              delist?.resubmit ||
              (status as { resubmit?: unknown })?.resubmit,
            demo_get: listingId
              ? `${origin}/api/products/demo?listing_id=${encodeURIComponent(listingId)}`
              : `${origin}/api/products/demo`,
          },
          {
            headers: withDemoCtaHeaders(
              { "cache-control": "no-store" },
              { origin, listing_id: listingId },
            ),
          },
        );
      },
    },
  },
});
