/**
 * GET /api/funnel — public activation loop + recent probe offers + skills
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import {
  funnelPublicStatus,
  listProbeOffers,
  listProbeContacts,
  FUNNEL_STAGES,
} from "@/lib/products/activation-funnel";

export const Route = createFileRoute("/api/funnel/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolvePublicOrigin(request);
        const status = await funnelPublicStatus(origin);
        const offers = await listProbeOffers(30);
        const contacts = await listProbeContacts(30);
        return Response.json(
          {
            ok: true,
            ...status,
            stages: FUNNEL_STAGES,
            probe_offers: offers.map((o) => ({
              listing_id: o.listing_id,
              kind: o.kind,
              name: o.name,
              offered_at: o.offered_at,
              take_demo: o.skill,
              confirm_body: o.confirm_body,
              has_email: Boolean(o.contact?.email),
            })),
            contacts: contacts.map((c) => ({
              listing_id: c.listing_id,
              kind: c.kind,
              name: c.name,
              email: c.email ? `${c.email.slice(0, 2)}…@…` : undefined,
              has_email: Boolean(c.email),
              provider: c.provider,
              captured_at: c.captured_at,
            })),
          },
          {
            headers: {
              "cache-control": "public, max-age=30",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
