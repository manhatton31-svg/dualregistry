/**
 * GET/POST /api/products/federation — bidirectional federation bus
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import {
  listFederationPeers,
  pullFederationPeer,
  pushFederationSignals,
  INTEROP_VERSION,
} from "@/lib/products/interop";

export const Route = createFileRoute("/api/products/federation")({
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
        const action = (url.searchParams.get("action") || "status").toLowerCase();
        let body: Record<string, unknown>;
        if (action === "pull") {
          const r = await pullFederationPeer(
            url.searchParams.get("peer_id") || undefined,
          );
          body = { version: INTEROP_VERSION, action: "pull", ...r };
        } else if (action === "push") {
          const r = await pushFederationSignals({ origin });
          body = { version: INTEROP_VERSION, action: "push", ...r };
        } else {
          const peers = await listFederationPeers();
          body = {
            ok: true,
            version: INTEROP_VERSION,
            action: "status",
            peers,
            endpoints: {
              pull: `${origin}/api/products/federation?action=pull`,
              push: `${origin}/api/products/federation?action=push`,
              catalog: `${origin}/.well-known/ai-catalog.json`,
              ard_search: `${origin}/api/ard/search`,
              interop: `${origin}/api/products/interop`,
            },
            note: "Bidirectional federation — pull peer catalogs, publish Dual acceleration + trail signals.",
          };
        }
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-federation": INTEROP_VERSION,
            },
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
        const action = String(body.action || "status").toLowerCase();
        let result: unknown;
        if (action === "pull") {
          result = await pullFederationPeer(
            typeof body.peer_id === "string" ? body.peer_id : undefined,
          );
        } else if (action === "push") {
          result = await pushFederationSignals({ origin });
        } else {
          result = {
            peers: await listFederationPeers(),
            note: "POST action=pull|push",
          };
        }
        return Response.json(
          { ok: true, action, version: INTEROP_VERSION, result, origin },
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
      },
    },
  },
});
