/**
 * Incremental mirror of official MCP registry (registry.modelcontextprotocol.io).
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";

const PATH = join(dataRoot(), "official-mirror.json");
const API = "https://registry.modelcontextprotocol.io/v0/servers";
const UA = "Agents1OfficialMirror/1.1";

export type OfficialMirrorEntry = {
  name: string;
  title?: string;
  description: string;
  repository?: string;
  website?: string;
  remote_url?: string;
  version?: string;
  protocol_versions: string[];
  transport?: string;
  namespace?: string;
  source: "official-mcp";
  fetched_at: string;
};

export type OfficialMirrorState = {
  updated_at: string;
  cursor?: string;
  pages_fetched: number;
  total_seen: number;
  entries: OfficialMirrorEntry[];
  last_error?: string;
};

function empty(): OfficialMirrorState {
  return {
    updated_at: new Date().toISOString(),
    pages_fetched: 0,
    total_seen: 0,
    entries: [],
  };
}

let mem: OfficialMirrorState | null = null;
let chain: Promise<void> = Promise.resolve();

export async function loadOfficialMirror(): Promise<OfficialMirrorState> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...(JSON.parse(raw) as OfficialMirrorState) };
    return mem;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: OfficialMirrorState) {
  mem = s;
  chain = chain.then(async () => {
    await mkdir(dirname(PATH), { recursive: true });
    const tmp = `${PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
    await rename(tmp, PATH);
  });
  await chain;
}

function mapServer(row: {
  server?: {
    name?: string;
    title?: string;
    description?: string;
    version?: string;
    repository?: { url?: string } | string;
    websiteUrl?: string;
    remotes?: Array<{ url?: string; type?: string }>;
  };
}): OfficialMirrorEntry | null {
  const s = row.server;
  if (!s?.name) return null;
  const repo =
    typeof s.repository === "string" ? s.repository : s.repository?.url;
  const remote = s.remotes?.find((r) => r.url);
  const protocol_versions: string[] = ["2025-03-26"];
  if (remote?.type === "streamable-http" || remote?.type === "http") {
    protocol_versions.push("2026-07-28");
  }
  if (remote) protocol_versions.push("remote");

  return {
    name: s.name,
    title: s.title || s.name.split("/").pop(),
    description:
      (s.description || "").trim() ||
      `${s.name} from official MCP registry (federated mirror).`,
    repository: repo,
    website: s.websiteUrl || repo,
    remote_url: remote?.url,
    version: s.version,
    protocol_versions: [...new Set(protocol_versions)],
    transport: remote?.type || (remote ? "http" : undefined),
    namespace: s.name.includes(".") ? s.name : undefined,
    source: "official-mcp",
    fetched_at: new Date().toISOString(),
  };
}

export async function syncOfficialMirror(opts?: {
  pages?: number;
  limit?: number;
}): Promise<{
  state: OfficialMirrorState;
  newCount: number;
  notes: string[];
}> {
  const pages = opts?.pages ?? 3;
  const limit = opts?.limit ?? 50;
  const state = await loadOfficialMirror();
  const notes: string[] = [];
  let cursor = state.cursor;
  let newCount = 0;
  const byName = new Map(state.entries.map((e) => [e.name, e]));

  for (let i = 0; i < pages; i++) {
    const url = new URL(API);
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    try {
      const res = await fetch(url.toString(), {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        notes.push(`official page ${i}: HTTP ${res.status}`);
        state.last_error = `HTTP ${res.status}`;
        break;
      }
      const data = (await res.json()) as {
        servers?: unknown[];
        metadata?: { nextCursor?: string };
        nextCursor?: string;
      };
      const servers = data.servers || [];
      if (!servers.length) {
        notes.push(`official page ${i}: empty`);
        break;
      }
      for (const row of servers) {
        const entry = mapServer(row as never);
        if (!entry) continue;
        if (!byName.has(entry.name)) newCount++;
        byName.set(entry.name, entry);
      }
      state.pages_fetched += 1;
      cursor = data.metadata?.nextCursor || data.nextCursor;
      notes.push(
        `official page ${i}: +${servers.length} (cursor ${cursor ? "yes" : "end"})`,
      );
      if (!cursor) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notes.push(`official page ${i}: ${msg}`);
      state.last_error = msg;
      break;
    }
  }

  state.cursor = cursor;
  state.entries = [...byName.values()]
    .sort((a, b) => (a.fetched_at < b.fetched_at ? 1 : -1))
    .slice(0, 800);
  state.total_seen = state.entries.length;
  state.updated_at = new Date().toISOString();
  await persist(state);
  notes.push(`mirror total ${state.total_seen} (+${newCount} new this sync)`);
  return { state, newCount, notes };
}

export function mirrorToGrowthRaws(state: OfficialMirrorState, max = 60) {
  return state.entries.slice(0, max).map((e) => ({
    kind: "mcp" as const,
    name: (e.title || e.name.split("/").pop() || e.name).slice(0, 80),
    description:
      e.description.length >= 40
        ? e.description.slice(0, 600)
        : `${e.name} official MCP server — federated into Agents1 with protocol tags ${e.protocol_versions.join(",")}.`,
    repository: e.repository,
    website: e.website || e.repository,
    remote_url: e.remote_url,
    author: e.name.includes("/")
      ? e.name.split("/")[0]
      : e.name.split(".")[0],
    source: "official-mcp" as const,
    quality_hints: [
      ...e.protocol_versions.map((p) => `proto:${p}`),
      e.transport ? `transport:${e.transport}` : "",
      e.namespace ? `ns:${e.namespace}` : "",
      "official-mirror",
    ].filter(Boolean),
  }));
}
