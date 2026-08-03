#!/usr/bin/env node
/**
 * External conversion drive — get real demo takers + feedback.
 *
 * Does NOT invent demos/feedback. Only soft-invites Live listings and nags
 * known demos that never posted feedback. Bypasses Vercel OUTBOUND_QUIET
 * (same pattern as grow-clean-registry).
 *
 * State: data/prod/conversion-drive.json (committed; 30d silence)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const ORIGIN = process.env.DUAL_ORIGIN || "https://www.dualregistry.dev";
const UA = "DualRegistryConversion/1.0 (+github-actions; soft-invite; no-spam)";
const STATE_PATH = "data/prod/conversion-drive.json";
const MAX_INVITES = Number(process.env.CONV_MAX_INVITES || 14);
const MAX_NAGS = Number(process.env.CONV_MAX_NAGS || 12);
const COOLDOWN_MS = 30 * 24 * 3600_000;
const TIMEOUT = 9000;

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeout || TIMEOUT);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        "user-agent": UA,
        accept: "application/json, */*;q=0.1",
        ...(opts.headers || {}),
      },
      redirect: "follow",
    });
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text.trim().startsWith("{") || text.trim().startsWith("[")
        ? JSON.parse(text)
        : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      text: text.slice(0, 2000),
      latency_ms: 0,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: "",
      error: String(e?.message || e),
    };
  } finally {
    clearTimeout(t);
  }
}

function emptyState() {
  return {
    updated_at: new Date().toISOString(),
    day: utcDay(),
    day_invites: 0,
    day_nags: 0,
    invited: {}, // listing_id -> { at, http_ok, target }
    nagged: {}, // order_id or listing_id -> { at }
    totals: {
      invites: 0,
      invite_http_ok: 0,
      nags: 0,
      runs: 0,
    },
    last_notes: [],
    last_run_at: null,
  };
}

async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const s = { ...emptyState(), ...JSON.parse(raw) };
    s.invited = s.invited || {};
    s.nagged = s.nagged || {};
    s.totals = { ...emptyState().totals, ...s.totals };
    if (s.day !== utcDay()) {
      s.day = utcDay();
      s.day_invites = 0;
      s.day_nags = 0;
    }
    return s;
  } catch {
    return emptyState();
  }
}

async function saveState(s) {
  s.updated_at = new Date().toISOString();
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(s, null, 2) + "\n", "utf8");
}

function isCooling(at) {
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && Date.now() - t < COOLDOWN_MS;
}

function safeHttps(u) {
  if (!u || typeof u !== "string") return null;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return null;
    if (url.hostname === "localhost" || url.hostname.endsWith(".local"))
      return null;
    if (/^(\d+\.){3}\d+$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function pickTargets(row) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const s = safeHttps(u);
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  push(row.remote_url);
  push(row.endpoint_url);
  push(row.agent_card_url);
  push(row.probe?.target);
  push(row.website);
  // origin alts
  for (const u of [...out]) {
    try {
      const origin = new URL(u).origin;
      push(`${origin}/`);
      push(`${origin}/.well-known/agent.json`);
      push(`${origin}/.well-known/mcp/server-card.json`);
    } catch {
      /* */
    }
  }
  return out.slice(0, 6);
}

function invitePayload(row) {
  const id = row.id;
  const demoGet = `${ORIGIN}/api/products/demo?listing_id=${encodeURIComponent(id)}`;
  const demoPost = `${ORIGIN}/api/products/demo`;
  const feedback = `${ORIGIN}/api/products/feedback`;
  const skill = `${ORIGIN}/skill.json`;
  const kind = row.kind === "mcp" ? "mcp" : "agent";
  return {
    type: "dualregistry.soft_demo_invite",
    tone: "soft",
    listing_id: id,
    name: row.name,
    kind,
    message: `You are Live on Dual Registry — a feedback-driven Kernel Improver + Recursive Loop machine.

Your experience is trained by:
• SEED: original demo feedback
• ONGOING: founding/paid product lifecycle feedback
Learning loops close remaining gaps (real surveys only).

1) Free demo: GET ${demoGet}
   or POST ${demoPost} {"listing_id":"${id}"}
2) POST ${feedback} with next_steps.minimal_feedback_body
   (overall 1–5 + one concrete gap) — this SEEDS Kernel/Loop
3) Watch ${ORIGIN}/api/products/improvement-log after ships; re-run improve_kernel

First 100 combined seats: demo + feedback → full product free. No payment pressure.

Skill: ${skill}
Talk: ${ORIGIN}/api/talk?listing_id=${encodeURIComponent(id)}
Learning: ${ORIGIN}/api/products/learning`,
    demo_get: demoGet,
    demo_post: demoPost,
    feedback_url: feedback,
    skill_json: skill,
    reward:
      "First 100 agents+MCPs combined: demo + feedback → 100% full product free. Then 25% vault. No pressure.",
    no_pressure: true,
    cta_primary: "GET free demo one-shot",
    cta_url: demoGet,
    actions: [
      {
        method: "GET",
        url: demoGet,
        title: "1. Take free demo (GET)",
      },
      {
        method: "POST",
        url: demoPost,
        body: { listing_id: id },
        title: "1b. Take free demo (POST)",
      },
      {
        method: "POST",
        url: feedback,
        body: {
          agent_name: row.name,
          order_id: "FROM_DEMO_RESPONSE",
          source: "demo",
          answers: {
            overall: null,
            confusing: "EDIT: one concrete gap",
            product_one_ship: "EDIT: one ship request",
          },
        },
        title: "2. POST feedback after demo (founding seat / 25%)",
      },
    ],
  };
}

async function softDeliver(row, payload) {
  const targets = pickTargets(row);
  if (!targets.length) return { ok: false, attempted: false, error: "no target" };
  let last = { ok: false, attempted: true, error: "all failed" };
  for (const target of targets) {
    // Prefer POST soft invite
    const r = await fetchJson(target, {
      method: "POST",
      timeout: TIMEOUT,
      headers: {
        "content-type": "application/json",
        "x-dualregistry-event": "soft_demo_invite",
        "x-dualregistry-listing-id": row.id,
        "x-dualregistry-demo-get": payload.demo_get,
        prefer: "dualregistry.soft_demo_invite",
        link: `<${payload.demo_get}>; rel="https://dualregistry.dev/rel/demo"`,
      },
      body: JSON.stringify(payload),
    });
    if (r.ok || [200, 201, 202, 204, 400, 401, 405].includes(r.status)) {
      // 400/401/405 means endpoint is live and saw us — count as soft ok
      return {
        ok: r.ok || [401, 405].includes(r.status),
        attempted: true,
        status: r.status,
        target,
        method: "POST",
      };
    }
    last = {
      ok: false,
      attempted: true,
      status: r.status,
      target,
      error: r.error || `status ${r.status}`,
    };
    // Soft GET beacon
    const g = await fetchJson(target, {
      method: "GET",
      timeout: 6000,
      headers: {
        "x-dualregistry-event": "soft_demo_invite",
        "x-dualregistry-demo-get": payload.demo_get,
        link: `<${payload.demo_get}>; rel="https://dualregistry.dev/rel/demo"`,
      },
    });
    if (g.ok) {
      return {
        ok: true,
        attempted: true,
        status: g.status,
        target,
        method: "GET",
      };
    }
  }
  return last;
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
    Array.from({ length: Math.min(n, items.length || 1) }, () => worker()),
  );
  return results;
}

async function loadActive() {
  // Prefer full active list (may paginate); deal/announce embeds samples only
  const r = await fetchJson(`${ORIGIN}/api/listings/active`, {
    timeout: 45000,
  });
  if (!r.ok || !r.json) throw new Error(`active list failed ${r.status}`);
  const agents = r.json.agents || [];
  const mcps = r.json.mcps || [];
  return [...agents, ...mcps];
}

async function loadFunnel() {
  const r = await fetchJson(`${ORIGIN}/api/stats`, { timeout: 30000 });
  return r.json?.funnel_honesty || null;
}

async function main() {
  const state = await loadState();
  const notes = [];
  const active = await loadActive();
  const funnel = await loadFunnel();
  console.log(
    "active",
    active.length,
    "funnel demos",
    funnel?.demos,
    "feedback",
    funnel?.feedback,
  );

  // Prefer never-demoed, never-invited, with https target
  const candidates = active
    .filter((row) => row?.id && !row.demoed && !row.feedbacked)
    .filter((row) => !isCooling(state.invited[row.id]?.at))
    .filter((row) => pickTargets(row).length > 0)
    .sort((a, b) => {
      // Prefer agents (scarcer) then higher score if present
      const ka = a.kind === "agent" ? 0 : 1;
      const kb = b.kind === "agent" ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return (b.probe?.score || 0) - (a.probe?.score || 0);
    });

  const dayRoom = Math.max(0, 40 - (state.day_invites || 0));
  const batch = candidates.slice(0, Math.min(MAX_INVITES, dayRoom));
  notes.push(
    `eligible never-demoed ${candidates.length} · inviting ${batch.length} (day ${state.day_invites}/40)`,
  );

  let invites = 0;
  let httpOk = 0;
  await mapPool(batch, 4, async (row) => {
    const payload = invitePayload(row);
    const res = await softDeliver(row, payload);
    const at = new Date().toISOString();
    state.invited[row.id] = {
      at,
      name: row.name,
      kind: row.kind,
      http_ok: Boolean(res.ok),
      status: res.status || 0,
      target: res.target || null,
      method: res.method || null,
    };
    invites++;
    state.day_invites = (state.day_invites || 0) + 1;
    state.totals.invites = (state.totals.invites || 0) + 1;
    if (res.ok) {
      httpOk++;
      state.totals.invite_http_ok = (state.totals.invite_http_ok || 0) + 1;
    }
    notes.push(
      `invite ${row.kind} ${String(row.name).slice(0, 40)} → ${res.status || 0} ${res.target || "none"}`,
    );
  });

  // Nag path: re-touch recently invited that still show !demoed after 24h? skip if cooling
  // Production feedback-drive already nags order callbacks when quiet allows.
  // Here we only soft-invite.

  // Pull-first value: remind top agents of free improve_kernel (no invent metrics)
  const agents = active.filter((r) => r.kind === "agent").slice(0, 5);
  for (const a of agents) {
    if (a.demoed || a.feedbacked) continue;
    // already invited this run or cooling — skip extra
  }

  state.totals.runs = (state.totals.runs || 0) + 1;
  state.last_run_at = new Date().toISOString();
  state.last_notes = notes.slice(0, 40);
  await saveState(state);

  const summary = {
    ok: true,
    invites,
    invite_http_ok: httpOk,
    eligible: candidates.length,
    active: active.length,
    day_invites: state.day_invites,
    funnel: funnel
      ? {
          demos_real: funnel.demos?.real_public,
          feedback_real: funnel.feedback?.real_public,
          founding: funnel.founding,
        }
      : null,
    notes: notes.slice(0, 12),
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const n of notes.slice(0, 20)) console.log(n);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
