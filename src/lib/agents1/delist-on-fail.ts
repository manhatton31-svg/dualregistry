/**
 * On probe fail / partial: remove from public registry counts immediately.
 * Never leave fail/partial on Active or In Registry.
 * Agent/MCP gets explicit fix + resubmit instructions.
 */
import { loadStoreCache, saveStoreCache } from "./store-cache";
import type { ProbeResult } from "./probe";
import { dataRoot } from "@/lib/data-root";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

const DELIST_PATH = join(dataRoot(), "products", "delisted.json");

export type DelistRecord = {
  id: string;
  kind: "agent" | "mcp";
  name?: string;
  target?: string;
  handshake: string;
  reason: string;
  fix: string[];
  resubmit: {
    method: string;
    url: string;
    body_hint: Record<string, string>;
    message: string;
  };
  probed_at: string;
  delisted_at: string;
};

function failWhy(probe?: ProbeResult): string {
  const sigs = probe?.signals || [];
  const s = sigs.find((x) => /fail|404|402|410|403|timeout|partial/i.test(String(x)));
  if (!s) return "live probe handshake failed";
  if (/404/.test(s)) return "card URL returned 404 — publish a valid card at that path";
  if (/402/.test(s)) return "card URL paywalled/blocked (402)";
  if (/410/.test(s)) return "card URL gone (410)";
  if (/403/.test(s)) return "card URL forbidden (403)";
  if (/timeout/i.test(s)) return "card URL timed out — ensure endpoint is publicly reachable";
  if (/partial/i.test(s)) return "partial card — incomplete agent-card or MCP server-card JSON";
  if (/200/.test(s) && /fail/i.test(s))
    return "URL returned HTML/non-card body — serve JSON agent-card or MCP server-card";
  return String(s);
}

export function buildFixInstructions(
  kind: "agent" | "mcp",
  probe?: ProbeResult,
  urls?: { agent_card_url?: string; remote_url?: string; website?: string },
): { reason: string; fix: string[]; message: string } {
  const reason = failWhy(probe);
  if (kind === "agent") {
    const card =
      urls?.agent_card_url ||
      (urls?.website
        ? `${urls.website.replace(/\/$/, "")}/.well-known/agent.json`
        : "/.well-known/agent.json");
    return {
      reason,
      fix: [
        `Serve a valid Agent Card JSON at ${card} (HTTP 200, application/json).`,
        "Required fields: name, description, url (or endpoint), skills[] (or capabilities).",
        "Do not return HTML, login walls, 404, or empty bodies.",
        "CORS optional; probe follows redirects once.",
        "After the card is live, resubmit for approval probing.",
      ],
      message: `Removed from Dual Registry: ${reason}. Fix your Agent Card, then POST /api/publish to resubmit for approval.`,
    };
  }
  const remote =
    urls?.remote_url ||
    (urls?.website
      ? `${urls.website.replace(/\/$/, "")}/.well-known/mcp/server-card.json`
      : "your MCP remote_url / server-card");
  return {
    reason,
    fix: [
      `Serve a valid MCP server card or streamable endpoint at ${remote} (HTTP 200).`,
      "Prefer /.well-known/mcp/server-card.json with name + transport/url.",
      "remote_url must accept MCP handshake (not a marketing HTML page).",
      "After the endpoint is live, resubmit for approval probing.",
    ],
    message: `Removed from Dual Registry: ${reason}. Fix your MCP card/endpoint, then POST /api/publish to resubmit for approval.`,
  };
}

async function appendDelistLog(rec: DelistRecord) {
  let items: DelistRecord[] = [];
  try {
    const raw = await readFile(DELIST_PATH, "utf8");
    const j = JSON.parse(raw) as { items?: DelistRecord[] };
    items = j.items || [];
  } catch {
    /* */
  }
  items = [rec, ...items.filter((x) => x.id !== rec.id)].slice(0, 500);
  await mkdir(dirname(DELIST_PATH), { recursive: true });
  const tmp = `${DELIST_PATH}.${process.pid}.tmp`;
  await writeFile(
    tmp,
    JSON.stringify({ updated_at: new Date().toISOString(), items }, null, 2),
    "utf8",
  );
  await rename(tmp, DELIST_PATH);
}

/**
 * Remove listing from registry items + subtract from approved counts.
 * Returns delist record with fix instructions for the agent/MCP.
 */
export async function delistOnProbeFail(input: {
  id: string;
  kind: "agent" | "mcp";
  name?: string;
  agent_card_url?: string;
  remote_url?: string;
  website?: string;
  probe: ProbeResult;
}): Promise<DelistRecord | null> {
  const hs = input.probe.handshake || "fail";
  if (hs === "ok" && input.probe.ok) return null;
  if (hs === "skip") return null; // no spend / no delist

  const fixPack = buildFixInstructions(input.kind, input.probe, {
    agent_card_url: input.agent_card_url,
    remote_url: input.remote_url,
    website: input.website,
  });

  const cache = await loadStoreCache();
  const listKey = input.kind === "mcp" ? "mcp_items" : "agent_items";
  const countKey = input.kind === "mcp" ? "mcp_approved" : "agents_approved";
  const items = [...(cache[listKey] || [])];
  const before = items.length;
  const next = items.filter((x) => {
    const xid = String(x.id || "");
    if (xid === input.id) return false;
    if (
      input.name &&
      String(x.name || "").toLowerCase() === input.name.toLowerCase()
    )
      return false;
    if (x.status === "rejected" || x.status === "delisted") return false;
    return true;
  });
  const removed = Math.max(1, before - next.length);

  cache[listKey] = next as typeof items;
  const prevCount = Number(cache[countKey]) || before;
  cache[countKey] = Math.max(0, prevCount - removed);
  // Never report approved higher than listed items
  if ((cache[listKey]?.length || 0) < cache[countKey]) {
    cache[countKey] = cache[listKey]?.length || 0;
  }
  if (cache.milestones) {
    const side =
      input.kind === "mcp" ? cache.milestones.mcp : cache.milestones.agents;
    if (side) {
      side.approved = cache[countKey];
      side.remaining = Math.max(0, (side.target || 0) - side.approved);
      side.pct = side.target
        ? Math.min(100, Math.round((side.approved / side.target) * 100))
        : 0;
    }
  }
  cache.updated_at = new Date().toISOString();
  await saveStoreCache(cache);

  const rec: DelistRecord = {
    id: input.id,
    kind: input.kind,
    name: input.name,
    target: input.probe.target,
    handshake: hs,
    reason: fixPack.reason,
    fix: fixPack.fix,
    resubmit: {
      method: "POST",
      url: "https://dualregistry.dev/api/publish",
      body_hint: {
        kind: input.kind,
        name: input.name || "",
        ...(input.kind === "agent"
          ? { agent_card_url: input.agent_card_url || "" }
          : { remote_url: input.remote_url || "" }),
      },
      message: fixPack.message,
    },
    probed_at: input.probe.probed_at,
    delisted_at: new Date().toISOString(),
  };
  await appendDelistLog(rec);

  // Tag probe result
  input.probe.signals = [
    ...(input.probe.signals || []),
    "delisted-from-registry",
    "needs-resubmit",
  ];

  return rec;
}

export async function listRecentDelists(limit = 20): Promise<DelistRecord[]> {
  try {
    const raw = await readFile(DELIST_PATH, "utf8");
    const j = JSON.parse(raw) as { items?: DelistRecord[] };
    return (j.items || []).slice(0, limit);
  } catch {
    return [];
  }
}
