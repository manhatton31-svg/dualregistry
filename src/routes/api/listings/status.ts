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
            },
            {
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
            public: status!.lane === "active" || status!.lane === "discovered",
            delisted: status!.lane === "needs_resubmit" || Boolean(delist),
            fix: delist?.fix || (status as { resubmit?: { fix?: string } })?.resubmit,
            resubmit: delist?.resubmit || (status as { resubmit?: unknown })?.resubmit,
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
