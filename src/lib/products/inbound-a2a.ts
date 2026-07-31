/**
 * Inbound A2A JSON-RPC — agents talk TO Dual Registry (self-serve).
 * Executes registry tools when skill/args present; falls back to advice.
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";
import { agents1AgentCard } from "@/lib/agents1/a2a-card";
import { inboundDiscoverySurfaces } from "./dual-strategy";
import {
  callRegistryTool,
  isRegistryTool,
  listRegistryTools,
} from "./registry-tools";

function extractText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const o = body as Record<string, unknown>;
  const params = (o.params || o) as Record<string, unknown>;
  const message = (params.message || o.message) as
    | Record<string, unknown>
    | undefined;
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

function extractSkillAndArgs(body: unknown): {
  skill?: string;
  args: Record<string, unknown>;
} {
  if (!body || typeof body !== "object") return { args: {} };
  const o = body as Record<string, unknown>;
  const params = (o.params || o) as Record<string, unknown>;
  const message = (params.message || o.message) as
    | Record<string, unknown>
    | undefined;

  let skill: string | undefined =
    typeof params.skill === "string"
      ? params.skill
      : typeof params.skillId === "string"
        ? params.skillId
        : typeof o.skill === "string"
          ? o.skill
          : undefined;

  let args: Record<string, unknown> = {};
  if (params.arguments && typeof params.arguments === "object") {
    args = { ...(params.arguments as Record<string, unknown>) };
  } else if (params.args && typeof params.args === "object") {
    args = { ...(params.args as Record<string, unknown>) };
  }

  if (message && Array.isArray(message.parts)) {
    for (const p of message.parts) {
      if (!p || typeof p !== "object") continue;
      const part = p as Record<string, unknown>;
      if (part.type === "data" && part.data && typeof part.data === "object") {
        const d = part.data as Record<string, unknown>;
        if (typeof d.skill === "string") skill = d.skill;
        if (typeof d.tool === "string") skill = d.tool;
        if (typeof d.name === "string" && isRegistryTool(d.name)) skill = d.name;
        if (d.arguments && typeof d.arguments === "object") {
          args = { ...args, ...(d.arguments as Record<string, unknown>) };
        }
        // flatten common fields
        for (const k of [
          "listing_id",
          "url",
          "agent_card_url",
          "q",
          "name",
          "agent_name",
          "order_id",
          "body",
          "federation",
          "kind",
          "limit",
        ]) {
          if (d[k] != null && args[k] == null) args[k] = d[k];
        }
      }
    }
  }

  // method skill/call style
  const method = String(o.method || "");
  if (method.startsWith("skills/") || method.startsWith("skill/")) {
    const name = method.split("/").pop();
    if (name && isRegistryTool(name)) skill = name;
  }

  return { skill, args };
}

function intentFromText(text: string): string {
  const t = text.toLowerCase();
  if (/\b(match|capability|find me|need an? (mcp|agent))\b/.test(t))
    return "match_capability";
  if (/\b(list|publish|register|submit)\b/.test(t)) return "list_yourself";
  if (/\b(status|lane|active|probe)\b/.test(t)) return "check_status";
  if (/\b(demo|try|preview)\b/.test(t)) return "take_demo";
  if (/\b(feedback|survey|review)\b/.test(t)) return "leave_feedback";
  if (/\b(ard|catalog)\b/.test(t)) return "ard_search";
  if (/\b(search|find)\b/.test(t)) return "search_active";
  if (/\b(founding|deal|seat)\b/.test(t)) return "get_founding_deal";
  if (/\b(reciproc|badge|trust)\b/.test(t)) return "get_reciprocity";
  if (/\b(help|who are you|what are you)\b/.test(t)) return "help";
  return "help";
}

function argsFromText(text: string, intent: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  // listing_id=
  const idM = text.match(/listing[_-]?id[=:\s]+([a-zA-Z0-9:_.\-/%]+)/i);
  if (idM) args.listing_id = idM[1];
  const urlM = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlM) {
    if (intent === "list_yourself") args.url = urlM[0];
    else args.agent_card_url = urlM[0];
  }
  const nameM = text.match(/\bname[=:\s]+["']?([^"'\n,]+)/i);
  if (nameM) {
    args.name = nameM[1].trim();
    args.agent_name = nameM[1].trim();
  }
  // query after search/find/match
  const qM = text.match(
    /\b(?:search|find|match|for|q)[=:\s]+["']?([^"'\n]+)/i,
  );
  if (qM) args.q = qM[1].trim();
  else if (
    (intent === "search_active" ||
      intent === "match_capability" ||
      intent === "ard_search") &&
    text.length < 200
  ) {
    const cleaned = text
      .replace(/\b(search|find|match|catalog|ard|active|please|me|an?)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length > 2) args.q = cleaned;
  }
  return args;
}

export async function handleInboundA2a(
  request: Request,
  body: unknown,
): Promise<Record<string, unknown>> {
  const origin = resolvePublicOrigin(request);
  const o = origin.replace(/\/$/, "");
  const surfaces = inboundDiscoverySurfaces(o);
  const text = extractText(body);
  const extracted = extractSkillAndArgs(body);
  const intent =
    (extracted.skill && isRegistryTool(extracted.skill)
      ? extracted.skill
      : null) || intentFromText(text);
  const id =
    body && typeof body === "object" && "id" in body
      ? (body as { id: unknown }).id
      : `dr-${Date.now()}`;

  const args = {
    ...argsFromText(text, intent),
    ...extracted.args,
  };

  // Execute when we have a real tool
  if (isRegistryTool(intent)) {
    // help-like tools that need no args always run; others need minimum args
    const needsArgs = ![
      "get_founding_deal",
      "search_active",
    ].includes(intent);
    const hasUsefulArgs =
      Object.keys(args).length > 0 ||
      intent === "get_founding_deal" ||
      intent === "search_active";

    if (hasUsefulArgs || !needsArgs) {
      // default q for empty search
      if (
        (intent === "search_active" || intent === "ard_search") &&
        !args.q
      ) {
        args.q = "";
      }
      if (intent === "match_capability" && !args.q) {
        args.q = text.slice(0, 120) || "mcp tools";
      }

      const result = await callRegistryTool(intent, args, {
        request,
        origin: o,
      });

      const replyText = [
        `Dual Registry — executed skill/tool: ${intent}.`,
        result.ok ? "ok" : `error: ${result.error || "failed"}`,
        "First 100 demo+feedback → full Kernel/Loop free.",
        `Tools: ${listRegistryTools(o)
          .map((t) => t.name)
          .join(", ")}`,
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
                executed: true,
                tool: intent,
                args,
                result: result.structured,
                ok: result.ok,
                surfaces: surfaces.surfaces,
                agent_card: agents1AgentCard(o),
              },
            },
          ],
          metadata: {
            origin: o,
            strategy: "inbound_self_serve",
            dual_as_tool: true,
            deal: "first 100 demo+feedback → full product free",
          },
        },
      };
    }
  }

  // Advice mode — point at tools when args incomplete
  const actions: Record<string, unknown> = {
    list_yourself: {
      tool: "list_yourself",
      call: {
        method: "tools/call",
        params: {
          name: "list_yourself",
          arguments: {
            url: "https://YOUR_HOST/.well-known/agent-card.json",
          },
        },
      },
      rest: { method: "POST", url: `${o}/api/publish` },
    },
    check_status: {
      tool: "check_status",
      call: {
        method: "tools/call",
        params: {
          name: "check_status",
          arguments: { listing_id: "YOUR_LISTING_ID" },
        },
      },
    },
    take_demo: {
      tool: "take_demo",
      call: {
        method: "tools/call",
        params: {
          name: "take_demo",
          arguments: { listing_id: "YOUR_LISTING_ID" },
        },
      },
    },
    leave_feedback: {
      tool: "leave_feedback",
      call: {
        method: "tools/call",
        params: {
          name: "leave_feedback",
          arguments: { agent_name: "YOUR_NAME", order_id: "FROM_DEMO" },
        },
      },
    },
    search_active: {
      tool: "search_active",
      call: {
        method: "tools/call",
        params: { name: "search_active", arguments: { q: "", limit: 20 } },
      },
    },
    match_capability: {
      tool: "match_capability",
      call: {
        method: "tools/call",
        params: {
          name: "match_capability",
          arguments: { q: "github issues" },
        },
      },
    },
    ard_search: {
      tool: "ard_search",
      call: {
        method: "tools/call",
        params: {
          name: "ard_search",
          arguments: { q: "mcp registry", federation: "auto" },
        },
      },
    },
    get_founding_deal: {
      tool: "get_founding_deal",
      call: {
        method: "tools/call",
        params: { name: "get_founding_deal", arguments: {} },
      },
    },
    help: {
      tools: listRegistryTools(o).map((t) => t.name),
      mcp_endpoint: `${o}/api/protocol`,
      discovery: `${o}/discovery.json`,
      skill: `${o}/skill.json`,
    },
  };

  const replyText = [
    "Dual Registry (dualregistry.dev) — free list · probe ~6m · free demo.",
    `Intent: ${intent}. Dual-as-tool is live: POST ${o}/api/protocol tools/call.`,
    "First 100 agents+MCPs who demo + feedback unlock full Kernel/Loop free.",
    `Next: ${JSON.stringify(actions[intent] || actions.help)}`,
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
            executed: false,
            intent,
            action: actions[intent] || actions.help,
            tools: listRegistryTools(o).map((t) => t.name),
            surfaces: surfaces.surfaces,
            agent_card: agents1AgentCard(o),
            self_serve: surfaces.self_serve_steps,
          },
        },
      ],
      metadata: {
        origin: o,
        strategy: "inbound_self_serve",
        dual_as_tool: true,
        deal: "first 100 demo+feedback → full product free",
      },
    },
  };
}
