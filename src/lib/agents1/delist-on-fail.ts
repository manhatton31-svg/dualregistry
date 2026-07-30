/**
 * On probe fail / partial: remove from public registry counts immediately.
 * Never leave fail/partial on Active or In Registry.
 * Agent/MCP gets explicit fix + resubmit instructions.
 *
 * Delist set is durable (GitHub data/prod/delisted.json) so In Registry
 * stays subtracted across serverless instances.
 */
import { loadStoreCache, saveStoreCache } from "./store-cache";
import type { ProbeResult } from "./probe";
import { dataRoot } from "@/lib/data-root";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadDurableJson, saveDurableJson } from "./durable-json";

const DELIST_PATH = join(dataRoot(), "products", "delisted.json");
const DURABLE_NAME = "delisted.json";

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

type DelistStore = {
  updated_at: string;
  items: DelistRecord[];
  active_ids: string[];
};

function failWhy(probe?: ProbeResult): string {
  const sigs = probe?.signals || [];
  const s = sigs.find((x) =>
    /fail|404|402|410|403|timeout|partial/i.test(String(x)),
  );
  if (!s) return "live probe handshake failed";
  if (/404/.test(s))
    return "card URL returned 404 — publish a valid card at that path";
  if (/402/.test(s)) return "card URL paywalled/blocked (402)";
  if (/410/.test(s)) return "card URL gone (410)";
  if (/403/.test(s)) return "card URL forbidden (403)";
  if (/timeout/i.test(s))
    return "card URL timed out — ensure endpoint is publicly reachable";
  if (/partial/i.test(s))
    return "partial card — incomplete agent-card or MCP server-card JSON";
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

async function loadDelistStore(): Promise<DelistStore> {
  const empty = (): DelistStore => ({
    updated_at: new Date().toISOString(),
    items: [],
    active_ids: [],
  });
  const parts: DelistStore[] = [];
  try {
    const remote = await loadDurableJson<DelistStore>(DURABLE_NAME, empty);
    if (remote?.items?.length) parts.push(remote);
  } catch {
    /* */
  }
  for (const path of [
    join(dataRoot(), "delisted.json"),
    DELIST_PATH,
  ]) {
    try {
      const raw = await readFile(path, "utf8");
      const j = JSON.parse(raw) as DelistStore;
      if (j?.items?.length) parts.push(j);
    } catch {
      /* */
    }
  }
  if (!parts.length) return empty();
  // Union by id — keep highest item count
  const byId = new Map<string, DelistRecord>();
  for (const p of parts) {
    for (const it of p.items || []) {
      if (!it?.id) continue;
      const prev = byId.get(it.id);
      if (!prev || (it.delisted_at || "") >= (prev.delisted_at || "")) {
        byId.set(it.id, it);
      }
    }
  }
  const items = [...byId.values()];
  return {
    updated_at: new Date().toISOString(),
    items,
    active_ids: items.map((i) => i.id),
  };
}

async function saveDelistStore(s: DelistStore) {
  s.updated_at = new Date().toISOString();
  s.active_ids = [...new Set(s.items.map((i) => i.id))];
  await mkdir(dirname(DELIST_PATH), { recursive: true });
  const tmp = `${DELIST_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, DELIST_PATH);
  try {
    await saveDurableJson(DURABLE_NAME, s);
  } catch {
    /* */
  }
}

/** Counts for In Registry card: subtract durable delists from store totals. */
export async function registryCountsAfterDelist(base: {
  mcp: number;
  agents: number;
}): Promise<{
  mcp: number;
  agents: number;
  total: number;
  delisted_mcp: number;
  delisted_agents: number;
  delisted_total: number;
}> {
  const s = await loadDelistStore();
  let dm = 0;
  let da = 0;
  const seen = new Set<string>();
  for (const it of s.items) {
    if (!it?.id || seen.has(it.id)) continue;
    seen.add(it.id);
    if (it.kind === "mcp") dm++;
    else da++;
  }
  const mcp = Math.max(0, base.mcp - dm);
  const agents = Math.max(0, base.agents - da);
  let delisted_total = dm + da;
  try {
    const { loadCounterFloors, raiseDelistedFloor } = await import(
      "./counter-floors"
    );
    const floors = await loadCounterFloors();
    delisted_total = Math.max(delisted_total, floors.delisted_floor || 0);
    if (delisted_total > dm + da && dm + da > 0) {
      const scale = delisted_total / (dm + da);
      dm = Math.round(dm * scale);
      da = Math.round(da * scale);
    } else if (delisted_total > dm + da) {
      dm = Math.max(dm, Math.floor(delisted_total / 2));
      da = Math.max(da, delisted_total - dm);
    }
    await raiseDelistedFloor(delisted_total);
  } catch {
    /* */
  }
  // Live counter single source of truth for delisted high-water
  try {
    const { raiseLiveCounters } = await import("./live-counter");
    const c = await raiseLiveCounters({ delisted_count: delisted_total });
    delisted_total = Math.max(delisted_total, c.delisted_count || 0);
  } catch {
    /* */
  }
  return {
    mcp: Math.max(0, base.mcp - dm),
    agents: Math.max(0, base.agents - da),
    total: Math.max(0, base.mcp - dm) + Math.max(0, base.agents - da),
    delisted_mcp: dm,
    delisted_agents: da,
    delisted_total,
  };
}

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
  if (hs === "skip") return null;

  const fixPack = buildFixInstructions(input.kind, input.probe, {
    agent_card_url: input.agent_card_url,
    remote_url: input.remote_url,
    website: input.website,
  });

  const store = await loadDelistStore();
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
  store.items = [rec, ...store.items.filter((x) => x.id !== rec.id)].slice(
    0,
    2000,
  );
  await saveDelistStore(store);

  try {
    const cache = await loadStoreCache();
    const listKey = input.kind === "mcp" ? "mcp_items" : "agent_items";
    const countKey = input.kind === "mcp" ? "mcp_approved" : "agents_approved";
    const items = [...(cache[listKey] || [])];
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
    const removed = Math.max(1, items.length - next.length);
    cache[listKey] = next as typeof items;
    const prevCount = Number(cache[countKey]) || items.length;
    cache[countKey] = Math.max(0, prevCount - removed);
    if (cache.milestones) {
      const side =
        input.kind === "mcp" ? cache.milestones.mcp : cache.milestones.agents;
      if (side) {
        side.approved = cache[countKey];
        side.remaining = Math.max(0, (side.target || 0) - side.approved);
      }
    }
    cache.updated_at = new Date().toISOString();
    await saveStoreCache(cache);
  } catch {
    /* durable delist already saved */
  }

  input.probe.signals = [
    ...(input.probe.signals || []),
    "delisted-from-registry",
    "needs-resubmit",
  ];

  return rec;
}

export async function listRecentDelists(limit = 20): Promise<DelistRecord[]> {
  const s = await loadDelistStore();
  return (s.items || []).slice(0, limit);
}

export async function delistStats() {
  const s = await loadDelistStore();
  let mcp = 0;
  let agents = 0;
  const seen = new Set<string>();
  for (const it of s.items) {
    if (!it?.id || seen.has(it.id)) continue;
    seen.add(it.id);
    if (it.kind === "mcp") mcp++;
    else agents++;
  }
  return { mcp, agents, total: mcp + agents, updated_at: s.updated_at };
}

/** Backfill delists from probe fail/partial results (idempotent). */
export async function backfillDelistsFromProbeResults(
  results: Record<string, ProbeResult>,
): Promise<number> {
  let n = 0;
  const seen = new Set<string>();
  for (const [k, r] of Object.entries(results || {})) {
    if (!r) continue;
    if (k.startsWith("name:") || k.startsWith("url:")) continue;
    if (r.handshake === "ok" && r.ok) continue;
    if (r.handshake === "skip") continue;
    const id = String(r.id || k);
    if (seen.has(id)) continue;
    seen.add(id);
    const rec = await delistOnProbeFail({
      id,
      kind: r.kind === "mcp" ? "mcp" : "agent",
      name: undefined,
      probe: r,
    });
    if (rec) n++;
  }
  return n;
}
