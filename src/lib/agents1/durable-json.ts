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
 *  2. if DURABLE_GITHUB_TOKEN (or GITHUB_TOKEN) → throttled push to data/prod/*
 *     - content-hash skip (no-op if unchanged)
 *     - per-file + global rate limits (prevents deploy/email storms)
 *     - denylist for high-churn product blobs (local-only by default)
 *     - commit messages include [skip ci] so Vercel can ignore them
 *  3. cron responses also return full state so GH Actions can commit without a token
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";

const DEFAULT_REPO =
  process.env.DURABLE_GITHUB_REPO || "manhatton31-svg/dualregistry";
const DEFAULT_BRANCH = process.env.DURABLE_GITHUB_BRANCH || "main";
const PROD_PREFIX = "data/prod";

/** High-churn product density stores — local only unless DURABLE_PUSH_ALL=1 */
const REMOTE_DENY_DEFAULT = new Set([
  "stigmergy.json",
  "autocatalysis.json",
  "first-principles.json",
  "exonomics.json",
  "interop.json",
  "reciprocity.json",
  "conversion-pressure.json",
  "human-outreach.json",
  "registry-categories.json",
  "free-tier.json",
  "daily-ops.json",
]);

/** Min ms between remote pushes of the same file */
const PER_FILE_MIN_MS: Record<string, number> = {
  "growth-scout.json": 60_000,
  "platform-cost.json": 120_000,
  "agent-runs.json": 120_000,
  "counter-floors.json": 180_000,
  "live-counters.json": 180_000,
  "probes.json": 300_000,
  "delisted.json": 300_000,
  "clean-registry.json": 300_000,
  "demo-nudge.json": 300_000,
  "talk-activity.json": 300_000,
  "growth-state.json": 600_000,
  "store-cache.json": 600_000,
  "agent-card-signing.json": 3_600_000,
};

const DEFAULT_PER_FILE_MIN_MS = 600_000; // 10 min
const GLOBAL_MIN_GAP_MS = 20_000; // ≥20s between any two GitHub puts
const MAX_CONTENT_BYTES = 2_500_000; // refuse giant puts that thrash git

// Process-local throttle state (per serverless isolate)
const lastPushAt = new Map<string, number>();
const lastContentHash = new Map<string, string>();
let lastGlobalPushAt = 0;
let pushChain: Promise<unknown> = Promise.resolve();

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

function contentHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function pushEnabled(): boolean {
  const kill = (process.env.DURABLE_GITHUB_PUSH || "1").trim();
  if (kill === "0" || kill.toLowerCase() === "false") return false;
  return Boolean(
    process.env.DURABLE_GITHUB_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.GH_TOKEN,
  );
}

function allowRemotePush(name: string): boolean {
  if (!pushEnabled()) return false;
  const all = (process.env.DURABLE_PUSH_ALL || "").trim();
  if (all === "1" || all.toLowerCase() === "true") return true;
  if (REMOTE_DENY_DEFAULT.has(name)) return false;
  // Optional explicit allowlist: comma-separated names
  const allow = (process.env.DURABLE_REMOTE_ALLOW || "").trim();
  if (allow) {
    const set = new Set(
      allow
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    return set.has(name);
  }
  return true;
}

function perFileMinMs(name: string): number {
  return PER_FILE_MIN_MS[name] ?? DEFAULT_PER_FILE_MIN_MS;
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
  // Atomic rename races on Vercel /tmp multi-isolate — fall back to direct write.
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await writeFile(tmp, raw, "utf8");
    try {
      await rename(tmp, path);
    } catch {
      await writeFile(path, raw, "utf8");
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(tmp).catch(() => undefined);
      } catch {
        /* */
      }
    }
  } catch {
    await writeFile(path, raw, "utf8");
  }
}

async function hydrateRemote(name: string): Promise<string | null> {
  // Prefer GitHub Contents API (auth, no CDN lag) over raw.githubusercontent.com
  const token =
    process.env.DURABLE_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN;
  if (token) {
    try {
      const api = `https://api.github.com/repos/${DEFAULT_REPO}/contents/${durableGithubPath(name)}?ref=${DEFAULT_BRANCH}&t=${Date.now()}`;
      const res = await fetch(api, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "DualRegistryDurable/1.0",
          "x-github-api-version": "2022-11-28",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const j = (await res.json()) as { content?: string; encoding?: string };
        if (j.content) {
          const text = Buffer.from(
            j.content.replace(/\n/g, ""),
            "base64",
          ).toString("utf8");
          if (text.trim() && !text.trim().startsWith("<!")) {
            try {
              JSON.parse(text);
              await writeLocal(name, text);
              return text;
            } catch {
              /* fall through */
            }
          }
        }
      }
    } catch {
      /* fall through to raw */
    }
  }

  const url = durableRemoteRawUrl(name) + `?t=${Date.now()}`;
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
    try {
      JSON.parse(text);
    } catch {
      return null;
    }
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

  // clean-registry / counter floors: ALWAYS fetch remote and keep the larger blob
  // so a thin cold-start /tmp never wins over GitHub high-water.
  if (
    name === "clean-registry.json" ||
    name === "counter-floors.json" ||
    name === "live-counters.json" ||
    name === "probes.json" ||
    name === "demo-nudge.json" ||
    name === "talk-activity.json" ||
    // Flywheel density stores — prefer high-water so cold starts don't zero C/O/trails
    name === "stigmergy.json" ||
    name === "autocatalysis.json" ||
    name === "first-principles.json" ||
    name === "exonomics.json" ||
    name === "interop.json" ||
    name === "reciprocity.json" ||
    name === "growth-scout.json" ||
    // Ops ledgers — multi-instance must not zero cost/runs
    name === "platform-cost.json" ||
    name === "agent-runs.json"
  ) {
    const remote = await hydrateRemote(name);
    if (remote && local) {
      // Prefer larger (more complete) payload; write winner local
      const winner = remote.length >= local.length ? remote : local;
      if (winner === remote && remote.length > local.length) {
        await writeLocal(name, remote);
      }
      // For clean-registry, if remote has more items, always take remote base
      if (name === "clean-registry.json") {
        try {
          const L = JSON.parse(local) as {
            items?: object;
            counts?: { total?: number };
          };
          const R = JSON.parse(remote) as {
            items?: object;
            counts?: { total?: number };
          };
          const lt = L.counts?.total ?? Object.keys(L.items || {}).length;
          const rt = R.counts?.total ?? Object.keys(R.items || {}).length;
          if (rt >= lt) {
            await writeLocal(name, remote);
            return remote;
          }
          return local;
        } catch {
          return remote.length >= local.length ? remote : local;
        }
      }
      return winner;
    }
    if (remote) return remote;
    return local;
  }

  if (local && local.length >= minBytes) {
    try {
      const j = JSON.parse(local) as Record<string, unknown>;
      const keys = Object.keys(j);
      if (keys.length > 2 && local.length >= minBytes * 4) {
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
      // Corrupt local (e.g. PLACEHOLDER) — wipe and rehydrate remote
      try {
        const forced = await forceHydrateDurable(name, { minBytes: 2 });
        if (forced) {
          try {
            JSON.parse(forced);
            raw = forced;
          } catch {
            raw = null;
          }
        } else {
          raw = null;
        }
      } catch {
        raw = null;
      }
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
): Promise<{ local: boolean; remote: boolean; error?: string; skipped?: string }> {
  const raw = JSON.stringify(data, null, 2);
  await writeLocal(name, raw);
  const remote = await pushGithub(name, raw);
  return remote;
}

async function pushGithub(
  name: string,
  content: string,
): Promise<{
  local: boolean;
  remote: boolean;
  error?: string;
  skipped?: string;
}> {
  if (!allowRemotePush(name)) {
    return { local: true, remote: false, skipped: "denied_or_disabled" };
  }

  const hash = contentHash(content);
  if (lastContentHash.get(name) === hash) {
    return { local: true, remote: false, skipped: "unchanged" };
  }

  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return { local: true, remote: false, skipped: "too_large" };
  }

  const now = Date.now();
  const lastFile = lastPushAt.get(name) || 0;
  if (now - lastFile < perFileMinMs(name)) {
    return { local: true, remote: false, skipped: "file_throttle" };
  }
  if (now - lastGlobalPushAt < GLOBAL_MIN_GAP_MS) {
    return { local: true, remote: false, skipped: "global_throttle" };
  }

  // Serialize puts in this isolate so we never stampede Contents API
  const run = pushChain.then(() => pushGithubNow(name, content, hash));
  pushChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function pushGithubNow(
  name: string,
  content: string,
  hash: string,
): Promise<{
  local: boolean;
  remote: boolean;
  error?: string;
  skipped?: string;
}> {
  const token =
    process.env.DURABLE_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN;
  if (!token) {
    return { local: true, remote: false, skipped: "no_token" };
  }

  const now = Date.now();
  const lastFile = lastPushAt.get(name) || 0;
  if (now - lastFile < perFileMinMs(name)) {
    return { local: true, remote: false, skipped: "file_throttle" };
  }
  if (now - lastGlobalPushAt < GLOBAL_MIN_GAP_MS) {
    return { local: true, remote: false, skipped: "global_throttle" };
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
      const j = (await get.json()) as { sha?: string; content?: string };
      sha = j.sha;
      // Remote already same content → skip put
      if (j.content) {
        try {
          const remoteRaw = Buffer.from(
            j.content.replace(/\n/g, ""),
            "base64",
          ).toString("utf8");
          if (contentHash(remoteRaw) === hash) {
            lastContentHash.set(name, hash);
            lastPushAt.set(name, Date.now());
            return { local: true, remote: false, skipped: "remote_unchanged" };
          }
        } catch {
          /* compare best-effort */
        }
      }
    } else if (get.status === 403 || get.status === 429) {
      return {
        local: true,
        remote: false,
        error: `github ${get.status}: rate limited (get)`,
      };
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
        // [skip ci] + chore(prod) so Vercel ignore-build can drop these
        message: `chore(prod): durable ${name} [skip ci]`,
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
    lastContentHash.set(name, hash);
    lastPushAt.set(name, Date.now());
    lastGlobalPushAt = Date.now();
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
    raw_growth_scout: durableRemoteRawUrl("growth-scout.json"),
    local_root: dataRoot(),
    github_write: pushEnabled(),
    push_all: ["1", "true"].includes(
      (process.env.DURABLE_PUSH_ALL || "").trim().toLowerCase(),
    ),
    throttle: {
      global_min_gap_ms: GLOBAL_MIN_GAP_MS,
      default_per_file_ms: DEFAULT_PER_FILE_MIN_MS,
    },
  };
}
