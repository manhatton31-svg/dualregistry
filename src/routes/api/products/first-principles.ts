/**
 * GET/POST /api/products/first-principles — five atoms fabric
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { withDemoCtaHeaders } from "@/lib/products/demo-cta-headers";
import {
  FIRST_PRINCIPLES_VERSION,
  getFirstPrinciplesPublic,
  hashCapability,
  registerCapability,
  issueAttestation,
  verifyAttestation,
  checkLiveness,
  executeCompose,
  depositOutcome,
  getIncentiveSurface,
  getAttractorTargets,
  bindIdentity,
  federationAttestationBundle,
  bootstrapCapabilitiesFromActive,
  listAttestations,
  listCapabilities,
} from "@/lib/products/first-principles";

export const Route = createFileRoute("/api/products/first-principles")({
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
          case "incentives":
            body = await getIncentiveSurface({ origin });
            break;
          case "attractors":
            body = await getAttractorTargets({
              origin,
              limit: Number(url.searchParams.get("limit")) || 12,
            });
            break;
          case "liveness": {
            const id = url.searchParams.get("listing_id") || "";
            body = id
              ? await checkLiveness({ listing_id: id })
              : { ok: false, error: "listing_id required" };
            break;
          }
          case "capabilities":
            body = {
              ok: true,
              capabilities: await listCapabilities(
                Number(url.searchParams.get("limit")) || 40,
              ),
            };
            break;
          case "attestations":
            body = {
              ok: true,
              attestations: await listAttestations({
                subject: url.searchParams.get("subject") || undefined,
                type: url.searchParams.get("type") || undefined,
                limit: Number(url.searchParams.get("limit")) || 40,
              }),
            };
            break;
          case "federation_bundle":
            body = await federationAttestationBundle({ origin });
            break;
          case "compose": {
            const a = url.searchParams.get("listing_id") || "";
            const b = url.searchParams.get("listing_b") || "";
            body = await executeCompose({
              listing_id: a,
              listing_b: b,
              origin,
            });
            break;
          }
          case "bootstrap":
            body = await bootstrapCapabilitiesFromActive({ origin });
            break;
          default:
            body = await getFirstPrinciplesPublic({ origin });
        }
        return Response.json(body, {
          headers: withDemoCtaHeaders(
            {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
              "x-dual-first-principles": FIRST_PRINCIPLES_VERSION,
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
        const action = String(body.action || body.op || "status").toLowerCase();
        let result: unknown;
        if (action === "capability_hash" || action === "register_capability") {
          result = await registerCapability({
            name: String(body.name || ""),
            kind: body.kind as "agent" | "mcp" | "dual" | "pipeline" | undefined,
            description:
              typeof body.description === "string" ? body.description : undefined,
            tools: Array.isArray(body.tools)
              ? body.tools.map(String)
              : undefined,
            skills: Array.isArray(body.skills)
              ? body.skills.map(String)
              : undefined,
            tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
            listing_id:
              typeof body.listing_id === "string" ? body.listing_id : undefined,
          });
          if (action === "capability_hash" && !body.listing_id) {
            result = {
              cap_hash: hashCapability({
                name: String(body.name || ""),
                kind: body.kind as string | undefined,
                description:
                  typeof body.description === "string"
                    ? body.description
                    : undefined,
                tools: Array.isArray(body.tools)
                  ? body.tools.map(String)
                  : undefined,
                skills: Array.isArray(body.skills)
                  ? body.skills.map(String)
                  : undefined,
                tags: Array.isArray(body.tags)
                  ? body.tags.map(String)
                  : undefined,
              }),
              registered: result,
            };
          }
        } else if (action === "attest") {
          result = await issueAttestation({
            type: (body.type as "probe_clean") || "capability",
            subject: String(body.subject || body.listing_id || ""),
            claims:
              (body.claims as Record<string, unknown>) ||
              ({ note: body.body || "attestation" } as Record<string, unknown>),
            origin,
            expires_hours: Number(body.expires_hours) || 72,
          });
        } else if (action === "verify") {
          result = await verifyAttestation(
            body as { jws: string; id?: string },
          );
        } else if (action === "liveness") {
          result = await checkLiveness({
            listing_id: String(body.listing_id || ""),
            max_hours: Number(body.max_hours) || undefined,
          });
        } else if (action === "compose" || action === "execute_compose") {
          result = await executeCompose({
            listing_id: String(body.listing_id || ""),
            listing_b: String(body.listing_b || ""),
            origin,
            from: typeof body.from === "string" ? body.from : undefined,
          });
        } else if (action === "deposit_outcome" || action === "outcome") {
          result = await depositOutcome({
            listing_id: String(body.listing_id || ""),
            listing_b:
              typeof body.listing_b === "string" ? body.listing_b : undefined,
            ok: body.ok !== false && body.ok !== "false",
            latency_ms:
              typeof body.latency_ms === "number" ? body.latency_ms : undefined,
            quality:
              typeof body.quality === "number" ? body.quality : undefined,
            kind: typeof body.kind === "string" ? body.kind : undefined,
            from: typeof body.from === "string" ? body.from : undefined,
            body: typeof body.body === "string" ? body.body : undefined,
            origin,
          });
        } else if (action === "bind_identity") {
          result = await bindIdentity({
            listing_id: String(body.listing_id || ""),
            public_key_pem:
              typeof body.public_key_pem === "string"
                ? body.public_key_pem
                : undefined,
            public_jwk: body.public_jwk as Record<string, string> | undefined,
            did: typeof body.did === "string" ? body.did : undefined,
            name: typeof body.name === "string" ? body.name : undefined,
            origin,
          });
        } else if (action === "incentives") {
          result = await getIncentiveSurface({ origin });
        } else if (action === "attractors") {
          result = await getAttractorTargets({
            origin,
            limit: Number(body.limit) || 12,
          });
        } else if (action === "bootstrap") {
          result = await bootstrapCapabilitiesFromActive({ origin });
        } else if (action === "federation_bundle") {
          result = await federationAttestationBundle({ origin });
        } else {
          result = await getFirstPrinciplesPublic({ origin });
        }
        return Response.json(
          { ok: true, action, version: FIRST_PRINCIPLES_VERSION, result, origin },
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
