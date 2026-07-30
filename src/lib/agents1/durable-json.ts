/**
 * Durable JSON blobs for production (Vercel /tmp is ephemeral).
 *
 * Read path:
 *  1. local dataRoot() file
 *  2. if missing/empty → hydrate from GitHub raw (data/prod/*)
 *  3. forceHydrate always re-fetches remote when local is thin or force=true
 *
 * Write path:
 *  1. always write local
 *  2. if GITHUB_TOKEN + DURABLE_GITHUB_REPO → push to data/prod/* via Contents API
 *  3. cron responses also return full state so GH Actions can commit without a token on Vercel
 */
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";

const DEFAULT_REPO =
  process.env.DURABLE_GITHUB_REPO || "manhatton31-svg/dualregistry";
const DEFAULT_BRANCH = process.env.DURABLE_GITHUB_BRANCH || "main";
const PROD_PREFIX = "data/prod";

export function durableLocalPath(name: string): string {
  return join(dataRoot(), name);
}

export function durableRemoteRawUrl(name: string): string {
  const repo = DEFAULT_REPO;
  const branch = DEFAULT_BRANCH;
  return `https://raw.githubusercontent.com/${repo}/${branch}/${PROD_PREFIX}/${name}`;
}

export function durableGithubPath(name: string): string {
  return `${PROD_PREFIX}/${name}`;
}

async function readLocal(name: string): Promise<string | null> {
  try {
    const raw = await readFile(durableLocalPath(name), "utf8");
    if (!raw.trim()) return null;
    return raw;
  } catch {
    return null;
  }
}

async function writeLocal(name: string, raw: string): Promise<void> {
  const path = durableLocalPath(name);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, raw, "utf8");
  await rename(tmp, path);
}

async function hydrateRemote(name: string): Promise<string | null> {
  const url = durableRemoteRawUrl(name);
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "DualRegistryDurable/1.0",
        "cache-control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim() || text.trim().startsWith("<!")) return null;
    // validate JSON
    JSON.parse(text);
    await writeLocal(name, text);
    return text;
  } catch {
    return null;
  }
}

/**
 * Prefer remote when local is missing, empty, or smaller than remote high-water.
 * Call on cold paths so Vercel /tmp never serves a thin empty set.
 */
export async function forceHydrateDurable(
  name: string,
  opts?: { minBytes?: number },
): Promise<string | null> {
  const minBytes = opts?.minBytes ?? 64;
  const local = await readLocal(name);
  if (local && local.length >= minBytes) {
    // Still try remote if local looks like empty object shell
    try {
      const j = JSON.parse(local) as Record<string, unknown>;
      const keys = Object.keys(j);
      if (
        name === "probes.json" &&
        j.results &&
        typeof j.results === "object" &&
        Object.keys(j.results as object).length > 0
      ) {
        return local;
      }
      if (
        name !== "probes.json" &&
        keys.length > 2 &&
        local.length >= minBytes * 4
      ) {
        return local;
      }
    } catch {
      /* rehydrate */
    }
  }
  const remote = await hydrateRemote(name);
  return remote || local;
}

export async function loadDurableJson<T>(
  name: string,
  fallback: () => T,
): Promise<T> {
  let raw = await readLocal(name);
  if (!raw) {
    raw = await hydrateRemote(name);
  }
  // Thin/empty shells: force remote hydrate once more (Vercel cold start)
  if (raw) {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (
        name === "probes.json" &&
        (!j.results || !Object.keys((j.results as object) || {}).length)
      ) {
        const forced = await forceHydrateDurable(name, { minBytes: 200 });
        if (forced) raw = forced;
      }
    } catch {
      const forced = await forceHydrateDurable(name);
      if (forced) raw = forced;
    }
  }
  if (!raw) return fallback();
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback();
  }
}

export async function saveDurableJson(
  name: string,
  data: unknown,
): Promise<{ local: boolean; remote: boolean; error?: string }> {
  const raw = JSON.stringify(data, null, 2);
  await writeLocal(name, raw);
  const remote = await pushGithub(name, raw);
  return remote;
}

async function pushGithub(
  name: string,
  content: string,
): Promise<{ local: boolean; remote: boolean; error?: string }> {
  const token =
    process.env.DURABLE_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN;
  if (!token) {
    return { local: true, remote: false };
  }
  const repo = DEFAULT_REPO;
  const path = durableGithubPath(name);
  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  try {
    let sha: string | undefined;
    const get = await fetch(`${api}?ref=${DEFAULT_BRANCH}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "DualRegistryDurable/1.0",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (get.ok) {
      const j = (await get.json()) as { sha?: string };
      sha = j.sha;
    }
    const put = await fetch(api, {
      method: "PUT",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "DualRegistryDurable/1.0",
      },
      body: JSON.stringify({
        message: `chore(prod): durable ${name}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: DEFAULT_BRANCH,
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!put.ok) {
      const err = await put.text();
      return {
        local: true,
        remote: false,
        error: `github ${put.status}: ${err.slice(0, 200)}`,
      };
    }
    return { local: true, remote: true };
  } catch (e) {
    return {
      local: true,
      remote: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function readDurableRaw(name: string): Promise<string | null> {
  return readLocal(name);
}

export async function durableFileMtime(name: string): Promise<number> {
  try {
    const s = await stat(durableLocalPath(name));
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

export function durableConfigPublic() {
  return {
    repo: DEFAULT_REPO,
    branch: DEFAULT_BRANCH,
    raw_probes: durableRemoteRawUrl("probes.json"),
    raw_growth_state: durableRemoteRawUrl("growth-state.json"),
    raw_store_cache: durableRemoteRawUrl("store-cache.json"),
    local_root: dataRoot(),
    github_write: Boolean(
      process.env.DURABLE_GITHUB_TOKEN ||
        process.env.GITHUB_TOKEN ||
        process.env.GH_TOKEN,
    ),
  };
}
