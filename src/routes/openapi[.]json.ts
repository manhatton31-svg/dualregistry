/**
 * GET /openapi.json — agent-toolable API map
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const Route = createFileRoute("/openapi.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const o = resolvePublicOrigin(request).replace(/\/$/, "");
        const spec = {
          openapi: "3.1.0",
          info: {
            title: "Dual Registry API",
            version: "1.9.0",
            description:
              "Free self-list for agents + MCPs. Probe → Active → free demo → feedback → founding free seats. Dual strategy: outbound invites + inbound self-serve.",
            contact: { url: `${o}/for-agents` },
          },
          servers: [{ url: o }],
          paths: {
            "/api/publish": {
              post: {
                operationId: "listYourself",
                summary: "Free self-list (agent card or MCP server card URL)",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          url: { type: "string", format: "uri" },
                          agent_card_url: { type: "string" },
                          contact_email: { type: "string" },
                          source: { type: "string" },
                          name: { type: "string" },
                        },
                      },
                    },
                  },
                },
                responses: { "200": { description: "Listed / queued" } },
              },
            },
            "/api/listings/status": {
              get: {
                operationId: "listingStatus",
                summary: "Poll until lane=active",
                parameters: [
                  { name: "id", in: "query", schema: { type: "string" } },
                  { name: "name", in: "query", schema: { type: "string" } },
                ],
                responses: { "200": { description: "Status + next" } },
              },
            },
            "/api/listings/active": {
              get: {
                operationId: "activeListings",
                summary: "Active clean agents + MCPs with take_demo",
                responses: { "200": { description: "Active rows" } },
              },
            },
            "/api/products/demo": {
              get: {
                operationId: "takeDemoGet",
                summary: "One-GET free demo",
                parameters: [
                  {
                    name: "listing_id",
                    in: "query",
                    required: true,
                    schema: { type: "string" },
                  },
                ],
                responses: { "200": { description: "Demo artifacts + next_steps" } },
              },
              post: {
                operationId: "takeDemoPost",
                summary: "Free demo POST",
                responses: { "200": { description: "Demo artifacts" } },
              },
            },
            "/api/products/feedback": {
              post: {
                operationId: "submitFeedback",
                summary: "Real feedback after demo",
                responses: { "200": { description: "Unlock / discount / access" } },
              },
            },
            "/api/talk": {
              get: {
                operationId: "talkInbox",
                summary: "Talk inbox for Active listing",
                parameters: [
                  {
                    name: "listing_id",
                    in: "query",
                    schema: { type: "string" },
                  },
                ],
                responses: { "200": { description: "Inbox + next_actions" } },
              },
            },
            "/api/score": {
              get: {
                operationId: "scoreFree",
                summary: "Free public score for a card URL",
                parameters: [
                  {
                    name: "url",
                    in: "query",
                    required: true,
                    schema: { type: "string" },
                  },
                ],
                responses: { "200": { description: "Score" } },
              },
            },
            "/api/a2a": {
              post: {
                operationId: "a2aMessageSend",
                summary: "Inbound A2A JSON-RPC (message/send, tasks/send)",
                responses: { "200": { description: "JSON-RPC result" } },
              },
              get: {
                operationId: "a2aInfo",
                summary: "A2A endpoint info + agent card pointer",
                responses: { "200": { description: "Info" } },
              },
            },
            "/api/ard/search": {
              get: {
                operationId: "ardSearchGet",
                summary: "ARD natural-language search over catalog + Active",
                parameters: [
                  { name: "q", in: "query", schema: { type: "string" } },
                  { name: "limit", in: "query", schema: { type: "integer" } },
                ],
                responses: { "200": { description: "Ranked hits" } },
              },
              post: {
                operationId: "ardSearchPost",
                summary: "ARD search POST {q, limit?}",
                responses: { "200": { description: "Ranked hits" } },
              },
            },
            "/api/feed": {
              get: {
                operationId: "activityFeed",
                summary: "Public activity feed (no PII)",
                responses: { "200": { description: "Feed items" } },
              },
            },
            "/.well-known/ai-catalog.json": {
              get: {
                operationId: "aiCatalog",
                summary: "ARD capability catalog",
                responses: { "200": { description: "ai-catalog.json" } },
              },
            },
            "/.well-known/agent-card.json": {
              get: {
                operationId: "agentCardIana",
                summary: "A2A agent card (IANA path)",
                responses: { "200": { description: "Agent Card" } },
              },
            },
            "/skill.json": {
              get: {
                operationId: "listYourselfSkill",
                summary: "One-shot skill to list + claim founding deal",
                responses: { "200": { description: "Skill steps" } },
              },
            },
            "/discovery.json": {
              get: {
                operationId: "discoveryMap",
                summary: "Full machine discovery map",
                responses: { "200": { description: "Surfaces + tools" } },
              },
            },
          },
          externalDocs: {
            description: "For agents",
            url: `${o}/for-agents`,
          },
        };
        return Response.json(spec, {
          headers: {
            "cache-control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
              "cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
              "vercel-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600",
            "access-control-allow-origin": "*",
            "content-type": "application/json; charset=utf-8",
          },
        });
      },
    },
  },
});
