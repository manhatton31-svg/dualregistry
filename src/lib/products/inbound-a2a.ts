/**
 * Inbound A2A JSON-RPC — agents talk TO Dual Registry (self-serve).
 * Handles message/send + tasks/send style payloads.
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { agents1AgentCard } from "@/lib/agents1/a2a-card";
import { inboundDiscoverySurfaces } from "./dual-strategy";

function extractText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const o = body as Record<string, unknown>;
  const params = (o.params || o) as Record<string, unknown>;
  const message = (params.message || o.message) as Record<string, unknown> | undefined;
  if (message && Array.isArray(message.parts)) {
    const texts = message.parts
      .map((p) => {
        if (!p || typeof p !== "object") return "";
        const part = p as Record<string, unknown>;
        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean);
    if (texts.length) return texts.join("\n");
  }
  if (typeof o.text === "string") return o.text;
  if (typeof params.text === "string") return params.text;
  try {
    return JSON.stringify(body).slice(0, 2000);
  } catch {
    return "";
  }
}

function intentFromText(text: string): string {
  const t = text.toLowerCase();
  if (/\b(list|publish|register|submit)\b/.test(t)) return "list_yourself";
  if (/\b(status|lane|active|probe)\b/.test(t)) return "status";
  if (/\b(demo|try|preview)\b/.test(t)) return "demo";
  if (/\b(feedback|survey|review)\b/.test(t)) return "feedback";
  if (/\b(search|find|catalog)\b/.test(t)) return "search";
  if (/\b(help|who are you|what are you)\b/.test(t)) return "help";
  return "help";
}

export async function handleInboundA2a(
  request: Request,
  body: unknown,
): Promise<Record<string, unknown>> {
  const origin = resolvePublicOrigin(request);
  const o = origin.replace(/\/$/, "");
  const surfaces = inboundDiscoverySurfaces(o);
  const text = extractText(body);
  const intent = intentFromText(text);
  const id =
    body && typeof body === "object" && "id" in body
      ? (body as { id: unknown }).id
      : `dr-${Date.now()}`;

  const actions: Record<string, unknown> = {
    list_yourself: {
      method: "POST",
      url: `${o}/api/publish`,
      body: {
        url: "https://YOUR_HOST/.well-known/agent.json",
        contact_email: "optional@you.dev",
        source: "a2a-inbound",
      },
      skill: `${o}/skill.json`,
    },
    status: {
      method: "GET",
      url: `${o}/api/listings/status?id=YOUR_LISTING_ID`,
      note: "Poll until lane=active",
    },
    demo: {
      method: "GET",
      url: `${o}/api/products/demo?listing_id=YOUR_LISTING_ID`,
      note: "Free one-GET demo when Active",
    },
    feedback: {
      method: "POST",
      url: `${o}/api/products/feedback`,
      body_from: "demo.next_steps.example_body",
    },
    search: {
      method: "GET",
      url: `${o}/agents/search?q=`,
      active: `${o}/api/listings/active`,
    },
    help: {
      discovery: `${o}/discovery.json`,
      llms: `${o}/llms.txt`,
      skill: `${o}/skill.json`,
      for_agents: `${o}/for-agents`,
    },
  };

  const replyText = [
    "Dual Registry (dualregistry.dev) — free list · probe ~6m · free demo.",
    `Intent: ${intent}.`,
    "First 100 agents+MCPs who demo + feedback unlock full Kernel/Loop free.",
    `Next: ${JSON.stringify(actions[intent])}`,
    `Skill: ${o}/skill.json · OpenAPI: ${o}/openapi.json · Talk: ${o}/api/talk`,
  ].join(" ");

  return {
    jsonrpc: "2.0",
    id,
    result: {
      role: "agent",
      parts: [
        { type: "text", text: replyText },
        {
          type: "data",
          data: {
            dualregistry: true,
            intent,
            action: actions[intent],
            surfaces: surfaces.surfaces,
            agent_card: agents1AgentCard(o),
            self_serve: surfaces.self_serve_steps,
          },
        },
      ],
      metadata: {
        origin: o,
        strategy: "inbound_self_serve",
        deal: "first 100 demo+feedback → full product free",
      },
    },
  };
}
