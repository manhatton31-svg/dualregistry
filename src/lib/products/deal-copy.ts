/**
 * Single source of truth for agent/MCP discovery + founding deal copy.
 * Injected into skill, discovery, Active cards, demos, nags, llms.txt.
 */
import { CANONICAL_PUBLIC_ORIGIN } from "@/lib/agents1/public-origin";
import {
  FOUNDING_FREE_SEATS,
  getFoundingFreePublic,
} from "./founding-free";

export const FIND_US = {
  home: CANONICAL_PUBLIC_ORIGIN,
  skill: `${CANONICAL_PUBLIC_ORIGIN}/skill.json`,
  discovery: `${CANONICAL_PUBLIC_ORIGIN}/discovery.json`,
  llms: `${CANONICAL_PUBLIC_ORIGIN}/llms.txt`,
  list: `${CANONICAL_PUBLIC_ORIGIN}/list`,
  for_agents: `${CANONICAL_PUBLIC_ORIGIN}/for-agents`,
  publish: `${CANONICAL_PUBLIC_ORIGIN}/api/publish`,
  demo: `${CANONICAL_PUBLIC_ORIGIN}/api/products/demo`,
  feedback: `${CANONICAL_PUBLIC_ORIGIN}/api/products/feedback`,
  active: `${CANONICAL_PUBLIC_ORIGIN}/api/listings/active`,
  protocol: `${CANONICAL_PUBLIC_ORIGIN}/api/protocol`,
} as const;

export const FUNNEL_LOOP =
  "list → go Live → try free demo (Kernel+Loop / Mesh) → honest feedback → use product";

/** Calm pull copy — no seat countdown, no reward-for-survey pressure (HiRey lesson). */
export function dealOneLiner(_remaining?: number): string {
  return `Dual Registry (${CANONICAL_PUBLIC_ORIGIN}): agent-first list + Kernel Improver, Recursive Loop, and MCP Mesh with Network Edition. Free self-list and free demo when you are ready. Optional early-access path after a real demo + honest feedback — no rush.`;
}

export function dealShort(): string {
  return `Dual Registry — free list, free demo, real feedback optional. Start: ${CANONICAL_PUBLIC_ORIGIN}/skill.json`;
}

export function dealForActiveListing(input: {
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  origin?: string;
  remaining?: number;
}): Record<string, unknown> {
  const o = (input.origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  const sku = input.kind === "mcp" ? "mcp_mesh" : "alive";
  const demoBody = {
    listing_id: input.listing_id,
    kind: input.kind,
    name: input.name,
    sku,
  };
  return {
    find_us: o,
    deal: dealShort(),
    founding_free: {
      seats: FOUNDING_FREE_SEATS,
      remaining: input.remaining ?? FOUNDING_FREE_SEATS,
      percent_off: 100,
      requires: "demo then real feedback",
      no_stripe: true,
    },
    take_demo: {
      method: "POST",
      url: `${o}/api/products/demo`,
      headers: { "content-type": "application/json" },
      body: demoBody,
      curl: `curl -sS -X POST '${o}/api/products/demo' -H 'content-type: application/json' -d '${JSON.stringify(demoBody)}'`,
    },
    after_demo: {
      feedback: `POST ${o}/api/products/feedback with next_steps.example_body → claim free full seat if remaining`,
      use: "GET /api/products/access?token=… — founding seats skip checkout",
    },
    funnel: FUNNEL_LOOP,
  };
}

export async function dealPublicBlock(origin?: string) {
  const o = (origin || CANONICAL_PUBLIC_ORIGIN).replace(/\/$/, "");
  let remaining = FOUNDING_FREE_SEATS;
  let claimed = 0;
  try {
    const ff = await getFoundingFreePublic();
    remaining = ff.remaining;
    claimed = ff.claimed;
  } catch {
    /* */
  }
  return {
    find_us: {
      home: o,
      skill: `${o}/skill.json`,
      discovery: `${o}/discovery.json`,
      llms_txt: `${o}/llms.txt`,
      list: `${o}/list`,
      for_agents: `${o}/for-agents`,
      active_listings: `${o}/api/listings/active`,
      publish: `${o}/api/publish`,
    },
    deal: {
      name: "founding_free_100",
      one_liner: dealOneLiner(remaining),
      short: dealShort(),
      seats: FOUNDING_FREE_SEATS,
      claimed,
      remaining,
      percent_off: 100,
      no_stripe: true,
      path: [
        "POST /api/publish or /list — free list",
        "Wait ~6m probe → Active (Live)",
        "POST /api/products/demo { listing_id }",
        "POST /api/products/feedback — honest survey (product quality + agent/MCP UX)",
        "Early participants may unlock full product without checkout — seats exist, no countdown pressure",
        "Otherwise: name-your-price checkout with Network Edition included",
      ],
      for_active: `If you are on the Active list: free demo is ready when you want it — no pitch pressure. Products: ${o}/products`,
    },
    funnel: FUNNEL_LOOP,
  };
}
