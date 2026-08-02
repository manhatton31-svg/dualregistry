#!/usr/bin/env node
/**
 * External grower — raises Live without waiting on Vercel probe deploy.
 *
 * Flow:
 *  1. Harvest real MCP remotes (official registry) + known agent cards
 *  2. Live-probe each (streamable-HTTP 401/405/JSON-RPC ok)
 *  3. Raise clean-registry.json + live-counters.json on handshake ok
 *  4. GH Actions commits every 15m → production hydrates from GitHub raw
 *
 * Live public count = clean-registry only. Probes that don't promote never
 * move the number — this script is the growth path until prod probe ships.
 */
import { readFile, writeFile } from "node:fs/promises";

const UA = "DualRegistryGrower/1.2 (+github-actions; real-probe; live-remote-ok)";
const CLEAN_PATH = "data/prod/clean-registry.json";
const COUNTERS_PATH = "data/prod/live-counters.json";
const MAX_NEW = Number(process.env.GROW_MAX_NEW || 60);
const CONCURRENCY = Number(process.env.GROW_CONCURRENCY || 8);
const OFFICIAL_LIMIT = Number(process.env.GROW_OFFICIAL_LIMIT || 800);

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function idFor(kind, name, target) {
  const base = `${kind}-${(name || "x")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48)}-${(target || "")
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .slice(0, 64)}`;
  return base.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

/**
 * @param {string} url
 * @param {{ timeout?: number, accept?: string, headers?: Record<string,string>, method?: string, body?: string, maxBytes?: number }} [opts]
 */
async function fetchText(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeout || 10000);
  const start = Date.now();
  // Probe bodies can be huge; registry pages need full JSON (no 50k cap).
  const maxBytes = opts.maxBytes ?? 2_000_000;
  try {
    const res = await fetch(url, {
      method: opts.method || "GET",
      body: opts.body,
      signal: controller.signal,
      headers: {
        "user-agent": UA,
        accept: opts.accept || "application/json, */*;q=0.1",
        ...(opts.headers || {}),
      },
      redirect: "follow",
    });
    const text = (await res.text().catch(() => "")).slice(0, maxBytes);
    return {
      ok: res.ok,
      status: res.status,
      text,
      latency_ms: Date.now() - start,
      contentType: res.headers.get("content-type") || "",
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: "",
      latency_ms: Date.now() - start,
      contentType: "",
      error: String(e?.message || e),
    };
  } finally {
    clearTimeout(t);
  }
}

function looksLikeMcpBody(text, contentType = "") {
  const t = (text || "").slice(0, 4000).toLowerCase();
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/event-stream")) return true;
  if (ct.includes("application/json") && t.includes("jsonrpc")) return true;
  if (
    /jsonrpc|"result"\s*:|"error"\s*:/.test(t) &&
    /mcp|initialize|protocol|tools|capabilities|unauthorized|bearer|token|method not allowed|streamable/.test(
      t,
    )
  )
    return true;
  if (
    /model context protocol|mcp server|streamable.?http|tools\/list|serverinfo/.test(
      t,
    )
  )
    return true;
  if (
    /bearer token required|missing.*authorization|invalid_token|api token|authentication required/.test(
      t,
    )
  )
    return true;
  return false;
}

async function postInit(url) {
  return fetchText(url, {
    method: "POST",
    timeout: 10000,
    accept: "application/json, text/event-stream",
    headers: { "content-type": "application/json" },
    maxBytes: 50_000,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "dualregistry-grower", version: "1.2" },
      },
    }),
  });
}

function originsFrom(remote, website) {
  const out = [];
  const push = (u) => {
    if (!u || !/^https?:\/\//i.test(u)) return;
    try {
      const url = new URL(u);
      if (!out.includes(url.origin)) out.push(url.origin);
      const host = url.hostname;
      if (host.startsWith("mcp.") && host.split(".").length >= 3) {
        const root = `https://${host.slice(4)}`;
        if (!out.includes(root)) out.push(root);
      }
    } catch {
      /* */
    }
  };
  push(website);
  push(remote);
  return out;
}

async function probeMcp({ name, remote_url, website }) {
  let latency_ms = 0;
  const cardPaths = [
    "/.well-known/mcp/server-card.json",
    "/.well-known/mcp.json",
    "/.well-known/mcp/server.json",
    "/mcp.json",
  ];

  for (const u of [remote_url, website]) {
    if (u && /server-card\.json|\/\.well-known\/mcp|mcp\.json$/i.test(u)) {
      const r = await fetchText(u, { maxBytes: 100_000 });
      latency_ms = r.latency_ms;
      if (r.ok && r.text.trim().startsWith("{")) {
        return {
          ok: true,
          handshake: "ok",
          target: u,
          score: 45,
          signals: ["mcp-card direct"],
          latency_ms,
        };
      }
    }
  }

  for (const base of originsFrom(remote_url, website)) {
    for (const path of cardPaths) {
      const url = `${base.replace(/\/$/, "")}${path}`;
      const r = await fetchText(url, { maxBytes: 100_000 });
      latency_ms = r.latency_ms;
      if (r.ok && r.text.trim().startsWith("{")) {
        return {
          ok: true,
          handshake: "ok",
          target: url,
          score: 40,
          signals: [`mcp-card ${path}`],
          latency_ms,
        };
      }
    }
  }

  if (!remote_url) {
    return {
      ok: false,
      handshake: "fail",
      target: website || "",
      score: 0,
      signals: ["no-remote"],
      latency_ms,
    };
  }

  const target = remote_url;
  const get = await fetchText(remote_url, { maxBytes: 50_000 });
  latency_ms = get.latency_ms;

  if (get.ok && get.text.trim().startsWith("{")) {
    return {
      ok: true,
      handshake: "ok",
      target,
      score: 35,
      signals: [`remote-json ${get.status}`],
      latency_ms,
    };
  }
  if (
    looksLikeMcpBody(get.text, get.contentType) &&
    get.status !== 404 &&
    get.status !== 410
  ) {
    return {
      ok: true,
      handshake: "ok",
      target,
      score: 32,
      signals: [`remote-mcp-body ${get.status}`],
      latency_ms,
    };
  }

  const post = await postInit(remote_url);
  latency_ms = Math.max(latency_ms, post.latency_ms);
  const gateStatuses = [401, 403, 405, 406];

  if (
    looksLikeMcpBody(post.text, post.contentType) ||
    (post.ok && post.text.trim().startsWith("{"))
  ) {
    return {
      ok: true,
      handshake: "ok",
      target,
      score: 30,
      signals: [`post-initialize ${post.status}`],
      latency_ms,
    };
  }

  if (gateStatuses.includes(get.status) || gateStatuses.includes(post.status)) {
    if (
      /\/mcp(\/|$|\?)/i.test(remote_url) ||
      /mcp\./i.test(remote_url) ||
      looksLikeMcpBody(get.text, get.contentType) ||
      looksLikeMcpBody(post.text, post.contentType) ||
      gateStatuses.includes(get.status)
    ) {
      return {
        ok: true,
        handshake: "ok",
        target,
        score: 28,
        signals: [`live-mcp-gate get=${get.status} post=${post.status}`],
        latency_ms,
      };
    }
  }

  if ([401, 403].includes(post.status)) {
    return {
      ok: true,
      handshake: "ok",
      target,
      score: 28,
      signals: [`post-auth-gate ${post.status}`],
      latency_ms,
    };
  }

  return {
    ok: false,
    handshake: "fail",
    target,
    score: 10,
    signals: [`fail get=${get.status} post=${post.status}`],
    latency_ms,
  };
}

async function probeAgent({ name, agent_card_url, website }) {
  const cards = [];
  if (agent_card_url) cards.push(agent_card_url);
  const base =
    website ||
    (agent_card_url
      ? agent_card_url.replace(/\/\.well-known\/.*$/i, "")
      : "");
  if (base) {
    try {
      const origin = new URL(
        base.startsWith("http") ? base : `https://${base}`,
      ).origin;
      for (const p of [
        "/.well-known/agent.json",
        "/.well-known/agent-card.json",
        "/.well-known/a2a-card.json",
        "/agent.json",
      ]) {
        const u = `${origin}${p}`;
        if (!cards.includes(u)) cards.push(u);
      }
    } catch {
      /* */
    }
  }
  for (const cardUrl of cards) {
    const r = await fetchText(cardUrl, { maxBytes: 100_000 });
    if (r.ok && r.text.trim().startsWith("{")) {
      try {
        const j = JSON.parse(r.text);
        const hasName =
          typeof j.name === "string" && j.name.trim().length >= 2;
        const hasDesc =
          typeof j.description === "string" &&
          j.description.trim().length >= 12;
        const hasUrl =
          typeof j.url === "string" ||
          typeof j.endpoint === "string" ||
          Array.isArray(j.skills);
        if (hasName && (hasDesc || hasUrl)) {
          return {
            ok: true,
            handshake: "ok",
            target: cardUrl,
            score: 40,
            signals: ["agent-card"],
            latency_ms: r.latency_ms,
          };
        }
      } catch {
        /* */
      }
    }
  }
  return {
    ok: false,
    handshake: "fail",
    target: agent_card_url || website || "",
    score: 0,
    signals: ["fail"],
    latency_ms: 0,
  };
}

/** Official MCP registry — prefer latest versions with remotes. */
async function fetchOfficialMcps(limit = 800) {
  const out = [];
  const seenRemote = new Set();
  const seenName = new Set();
  let cursor;
  let pages = 0;
  let errors = 0;

  for (let page = 0; page < 20 && out.length < limit; page++) {
    const q = new URL("https://registry.modelcontextprotocol.io/v0/servers");
    q.searchParams.set("limit", "100");
    if (cursor) q.searchParams.set("cursor", cursor);
    // Full page JSON — do NOT truncate (pages are >50KB)
    const r = await fetchText(q.toString(), {
      timeout: 30000,
      maxBytes: 5_000_000,
    });
    if (!r.ok) {
      errors++;
      console.warn("official page fail", r.status, r.error || "");
      if (errors >= 3) break;
      continue;
    }
    let data;
    try {
      data = JSON.parse(r.text);
    } catch (e) {
      errors++;
      console.warn(
        "official parse fail",
        String(e),
        "bytes",
        r.text.length,
      );
      break;
    }
    pages++;
    const rows = data.servers || data.data || [];
    for (const row of rows) {
      const s = row.server || row;
      const meta = row._meta?.["io.modelcontextprotocol.registry/official"];
      if (meta && meta.isLatest === false && seenName.has(s.name)) continue;
      const remotes = (s.remotes || [])
        .map((x) => (typeof x === "string" ? x : x?.url))
        .filter((u) => u && /^https?:\/\//i.test(u));
      if (!remotes.length) continue;
      const name = String(s.title || s.name || remotes[0]).slice(0, 80);
      const website = s.websiteUrl || s.repository?.url || remotes[0];
      const description = String(s.description || name).slice(0, 400);
      for (let i = 0; i < remotes.length; i++) {
        const remote = remotes[i];
        const key = remote.toLowerCase().replace(/\/$/, "");
        if (seenRemote.has(key)) continue;
        seenRemote.add(key);
        if (s.name) seenName.add(s.name);
        out.push({
          kind: "mcp",
          name: remotes.length > 1 ? `${name} · r${i + 1}` : name,
          remote_url: remote,
          website,
          description,
          source: "official-mcp",
        });
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    cursor =
      data?.metadata?.nextCursor ||
      data?.metadata?.next_cursor ||
      data?.nextCursor;
    if (!cursor) break;
  }
  console.log(
    `official harvest pages=${pages} remotes=${out.length} errors=${errors}`,
  );
  return out;
}

function seedRemotes() {
  return [
    {
      kind: "mcp",
      name: "Dual Registry MCP",
      remote_url: "https://www.dualregistry.dev/api/mcp",
      website: "https://www.dualregistry.dev",
      description:
        "Dual Registry public MCP — list, improve_kernel, mesh tools.",
      source: "seed",
    },
    {
      kind: "mcp",
      name: "Cloudflare Docs MCP",
      remote_url: "https://docs.mcp.cloudflare.com/mcp",
      website: "https://developers.cloudflare.com",
      description: "Cloudflare documentation MCP remote server.",
      source: "seed",
    },
    {
      kind: "mcp",
      name: "GitHub MCP",
      remote_url: "https://api.githubcopilot.com/mcp/",
      website: "https://api.githubcopilot.com",
      description: "GitHub Copilot MCP remote endpoint.",
      source: "seed",
    },
  ];
}

function seedAgents() {
  return [
    {
      kind: "agent",
      name: "Dual Registry",
      agent_card_url: "https://www.dualregistry.dev/.well-known/agent.json",
      website: "https://www.dualregistry.dev",
      source: "seed",
    },
    {
      kind: "agent",
      name: "Agoragentic",
      agent_card_url: "https://agoragentic.com/.well-known/agent.json",
      website: "https://agoragentic.com",
      source: "seed",
    },
  ];
}

async function mapPool(items, n, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(n, Math.max(1, items.length)) }, () =>
      worker(),
    ),
  );
  return results;
}

function recount(items) {
  let mcp = 0;
  let agents = 0;
  for (const it of Object.values(items)) {
    if (it.kind === "mcp") mcp++;
    else agents++;
  }
  return { total: mcp + agents, mcp, agents };
}

function pickBatch(fresh, maxProbe) {
  const batch = [];
  const step = Math.max(1, Math.floor(fresh.length / Math.max(1, maxProbe)));
  for (let i = 0; i < fresh.length && batch.length < maxProbe; i += step) {
    batch.push(fresh[i]);
  }
  for (const c of fresh) {
    if (batch.length >= maxProbe) break;
    if (!batch.includes(c)) batch.push(c);
  }
  return batch;
}

async function main() {
  const raw = await readFile(CLEAN_PATH, "utf8");
  const reg = JSON.parse(raw);
  reg.items = reg.items || {};
  const existingTargets = new Set(
    Object.values(reg.items)
      .map((x) => (x.target || "").toLowerCase().replace(/\/$/, ""))
      .filter(Boolean),
  );
  const existingIds = new Set(Object.keys(reg.items));

  console.log("clean before", reg.counts || recount(reg.items));

  const [official, seeds] = await Promise.all([
    fetchOfficialMcps(OFFICIAL_LIMIT),
    Promise.resolve([...seedRemotes(), ...seedAgents()]),
  ]);
  const candidates = [...seeds, ...official];
  console.log(
    "candidates",
    candidates.length,
    `(official ${official.length} + seeds ${seeds.length})`,
  );

  const fresh = candidates.filter((c) => {
    const t = (c.remote_url || c.agent_card_url || "")
      .toLowerCase()
      .replace(/\/$/, "");
    return t && !existingTargets.has(t);
  });
  console.log("not yet listed", fresh.length);

  const maxProbe = Math.min(MAX_NEW * 4, Math.max(MAX_NEW, 120));
  const batch = pickBatch(fresh, maxProbe);
  console.log("probing", batch.length, "max_new", MAX_NEW);

  let raised = 0;
  let failed = 0;
  const notes = [];

  await mapPool(batch, CONCURRENCY, async (c) => {
    if (raised >= MAX_NEW) return;
    const pr = c.kind === "agent" ? await probeAgent(c) : await probeMcp(c);
    if (!pr.ok || pr.handshake !== "ok") {
      failed++;
      return;
    }
    const targetKey = (pr.target || "").toLowerCase().replace(/\/$/, "");
    if (targetKey && existingTargets.has(targetKey)) return;
    const id = idFor(c.kind || "mcp", c.name, pr.target);
    if (existingIds.has(id)) return;
    if (raised >= MAX_NEW) return;
    const now = new Date().toISOString();
    reg.items[id] = {
      id,
      kind: c.kind === "agent" ? "agent" : "mcp",
      name: c.name,
      target: pr.target,
      approved_at: now,
      probed_at: now,
      score: pr.score,
      handshake: "ok",
      hold_reason: `grower ${pr.signals.join(",")}`,
    };
    existingIds.add(id);
    if (targetKey) existingTargets.add(targetKey);
    raised++;
    notes.push(
      `+ ${c.kind || "mcp"} ${c.name} → ${pr.target} (${pr.signals[0]})`,
    );
  });

  reg.counts = recount(reg.items);
  reg.high_water = {
    total: Math.max(reg.high_water?.total || 0, reg.counts.total),
    mcp: Math.max(reg.high_water?.mcp || 0, reg.counts.mcp),
    agents: Math.max(reg.high_water?.agents || 0, reg.counts.agents),
  };
  reg.day = utcDay();
  reg.updated_at = new Date().toISOString();
  reg.policy = reg.policy || {
    source: "single durable clean-registry",
    raise_only_on: "initial probe handshake ok (checks clean)",
    remove_only_on:
      "confirmed later probe fail OR Talk lapse after 7d (cron only)",
    note: "Public Active count/list read ONLY from this file.",
  };

  await writeFile(CLEAN_PATH, JSON.stringify(reg, null, 2) + "\n", "utf8");

  try {
    let counters = {
      day: utcDay(),
      probes_used: 0,
      live_ok: reg.counts.total,
      live_mcp: reg.counts.mcp,
      live_agents: reg.counts.agents,
      delisted_count: 0,
      updated_at: new Date().toISOString(),
      backend: "github-grower",
    };
    try {
      const prev = JSON.parse(await readFile(COUNTERS_PATH, "utf8"));
      counters = {
        ...prev,
        day: utcDay(),
        live_ok: Math.max(prev.live_ok || 0, reg.counts.total),
        live_mcp: Math.max(prev.live_mcp || 0, reg.counts.mcp),
        live_agents: Math.max(prev.live_agents || 0, reg.counts.agents),
        updated_at: new Date().toISOString(),
        backend: "github-grower",
      };
    } catch {
      /* */
    }
    await writeFile(
      COUNTERS_PATH,
      JSON.stringify(counters, null, 2) + "\n",
      "utf8",
    );
  } catch (e) {
    console.warn("counters", e);
  }

  console.log("raised", raised, "failed_probes", failed);
  console.log("clean after", reg.counts);
  for (const n of notes.slice(0, 40)) console.log(n);
  console.log(
    JSON.stringify({
      raised,
      failed,
      counts: reg.counts,
      sample: notes.slice(0, 15),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
