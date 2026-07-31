/**
 * GET/POST /api/products/exonomics — zero MC · exonomics · hyper-exponentials
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import {
  EXONOMICS_VERSION,
  COST_MODEL,
  getExonomicsPublic,
  getExonomicsMultipliers,
  sampleExonomics,
  zeroMcFederationPack,
  abundanceBoostFor,
  budgetFromValueGrowth,
  computeNetworkValue,
} from "@/lib/products/exonomics";

export const Route = createFileRoute("/api/products/exonomics")({
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
        let body: unknown;
        switch (action) {
          case "cost_model":
            body = { ok: true, ...COST_MODEL, version: EXONOMICS_VERSION };
            break;
          case "value": {
            const snap = await sampleExonomics();
            body = {
              ok: true,
              version: EXONOMICS_VERSION,
              network_value: snap.value,
              density: snap.density,
              hyper_mode: snap.hyper_mode,
            };
            break;
          }
          case "hyper": {
            const snap = await sampleExonomics();
            const mult = await getExonomicsMultipliers();
            body = {
              ok: true,
              version: EXONOMICS_VERSION,
              hyper: snap.hyper,
              hyper_mode: snap.hyper_mode,
              gates: snap.gates,
              multipliers: mult,
            };
            break;
          }
          case "s_curves": {
            const snap = await sampleExonomics();
            body = {
              ok: true,
              version: EXONOMICS_VERSION,
              s_curves: snap.s_curves,
              hyper_mode: snap.hyper_mode,
            };
            break;
          }
          case "federation_pack":
            body = await zeroMcFederationPack({
              origin,
              limit: Number(url.searchParams.get("limit")) || 20,
            });
            break;
          case "multipliers":
            body = {
              ok: true,
              version: EXONOMICS_VERSION,
              ...(await getExonomicsMultipliers()),
            };
            break;
          case "budget": {
            const base = Number(url.searchParams.get("base")) || 24;
            body = {
              ok: true,
              version: EXONOMICS_VERSION,
              ...(await budgetFromValueGrowth(base)),
            };
            break;
          }
          default:
            body = await getExonomicsPublic({ origin });
        }
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-exonomics": EXONOMICS_VERSION,
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
          /* */
        }
        const action = String(body.action || "status").toLowerCase();
        let result: unknown;
        if (action === "abundance_rank") {
          const ids = Array.isArray(body.listing_ids)
            ? body.listing_ids.map(String)
            : typeof body.listing_id === "string"
              ? [body.listing_id]
              : [];
          const boosts = await abundanceBoostFor(ids);
          result = { ok: true, boosts, version: EXONOMICS_VERSION };
        } else if (action === "federation_pack") {
          result = await zeroMcFederationPack({
            origin,
            limit: Number(body.limit) || 20,
          });
        } else if (action === "sample") {
          result = await sampleExonomics();
        } else if (action === "value") {
          const N = Number(body.N) || 0;
          const C = Number(body.C) || 0;
          const O = Number(body.O) || 0;
          const F = Number(body.F) || 0;
          result = {
            ok: true,
            ...computeNetworkValue({
              N,
              C,
              O,
              F,
              dense: Boolean(body.dense),
            }),
          };
        } else {
          result = await getExonomicsPublic({ origin });
        }
        return Response.json(result, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-exonomics": EXONOMICS_VERSION,
            },
            { origin },
          ),
        });
      },
    },
  },
});
