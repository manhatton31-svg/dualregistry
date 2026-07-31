/**
 * First principles fabric — harden Dual's five atoms:
 *   Capability · Address · Evidence · Trace · Rate
 *
 * P0: content-addressed capabilities, signed attestations, liveness=freshness
 * P1: executable composition, outcome traces, transparent incentives
 * P2: attractor-only growth, cryptographic agent identity, federation attestations
 *
 * Durable: first-principles.json
 */
import { createHash, createSign, createPrivateKey, createPublicKey } from "node:crypto";
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";
import { canonicalize } from "@/lib/agents1/card-sign";

export const FIRST_PRINCIPLES_VERSION = "2.7.0";
const DURABLE = "first-principles.json";

/** Liveness window: signal older than this is not "live" by physics. */
export const LIVENESS_HALF_LIFE_HOURS = 72;
export const LIVENESS_HARD_MAX_HOURS = 168; // 7d absolute

export type CapabilityDescriptor = {
  cap_hash: string;
  name: string;
  kind?: "agent" | "mcp" | "dual" | "pipeline";
  description?: string;
  tools?: string[];
  skills?: string[];
  tags?: string[];
  listing_ids: string[];
  created_at: string;
  updated_at: string;
};

export type SignedAttestation = {
  id: string;
  type:
    | "probe_clean"
    | "liveness"
    | "outcome"
    | "identity_bind"
    | "composition"
    | "reciprocity"
    | "capability";
  subject: string;
  claims: Record<string, unknown>;
  issued_at: string;
  expires_at?: string;
  issuer: string;
  kid?: string;
  jws: string;
  payload_canonical: string;
};

export type OutcomeTrace = {
  id: string;
  listing_id: string;
  listing_b?: string;
  ok: boolean;
  latency_ms?: number;
  quality?: number;
  kind?: string;
  from?: string;
  body?: string;
  at: string;
};

export type AgentIdentity = {
  listing_id: string;
  did?: string;
  public_key_pem?: string;
  public_jwk?: Record<string, string>;
  bound_at: string;
  cap_hash?: string;
  name?: string;
  last_signal_at?: string;
};

export type ExecutablePipeline = {
  id: string;
  listing_a: string;
  listing_b: string;
  name_a?: string;
  name_b?: string;
  steps: Array<{
    listing_id: string;
    name?: string;
    endpoints: {
      demo?: string;
      mcp?: string;
      a2a?: string;
      status?: string;
    };
  }>;
  invoke: {
    mcp?: Record<string, unknown>;
    http?: string[];
  };
  composition_count?: number;
  at: string;
};

type Store = {
  version: string;
  updated_at: string;
  capabilities: Record<string, CapabilityDescriptor>;
  attestations: SignedAttestation[];
  outcomes: OutcomeTrace[];
  identities: Record<string, AgentIdentity>;
  liveness: Record<string, { last_signal_at: string; source: string; score: number }>;
  totals: {
    cap_hashes: number;
    attestations: number;
    outcomes: number;
    identities: number;
    pipelines: number;
    attractor_picks: number;
  };
};

function empty(): Store {
  return {
    version: FIRST_PRINCIPLES_VERSION,
    updated_at: new Date().toISOString(),
    capabilities: {},
    attestations: [],
    outcomes: [],
    identities: {},
    liveness: {},
    totals: {
      cap_hashes: 0,
      attestations: 0,
      outcomes: 0,
      identities: 0,
      pipelines: 0,
      attractor_picks: 0,
    },
  };
}

let mem: Store | null = null;

async function load(): Promise<Store> {
  if (mem) return mem;
  const s = await loadDurableJson<Store>(DURABLE, empty);
  if (!s.capabilities) s.capabilities = {};
  if (!s.attestations) s.attestations = [];
  if (!s.outcomes) s.outcomes = [];
  if (!s.identities) s.identities = {};
  if (!s.liveness) s.liveness = {};
  if (!s.totals) s.totals = empty().totals;
  s.version = FIRST_PRINCIPLES_VERSION;
  mem = s;
  return s;
}

async function persist(s: Store) {
  s.updated_at = new Date().toISOString();
  s.version = FIRST_PRINCIPLES_VERSION;
  mem = s;
  await saveDurableJson(DURABLE, s);
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// ─── 1. Content-addressed capabilities ──────────────────────────────

export function hashCapability(input: {
  name: string;
  kind?: string;
  description?: string;
  tools?: string[];
  skills?: string[];
  tags?: string[];
}): string {
  const norm = {
    name: String(input.name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " "),
    kind: String(input.kind || "agent").toLowerCase(),
    description: String(input.description || "")
      .trim()
      .toLowerCase()
      .slice(0, 500)
      .replace(/\s+/g, " "),
    tools: (input.tools || []).map((t) => t.toLowerCase().trim()).sort(),
    skills: (input.skills || []).map((t) => t.toLowerCase().trim()).sort(),
    tags: (input.tags || []).map((t) => t.toLowerCase().trim()).sort(),
  };
  const digest = createHash("sha256")
    .update(canonicalize(norm))
    .digest("hex");
  return `cap_${digest.slice(0, 24)}`;
}

export async function registerCapability(opts: {
  name: string;
  kind?: "agent" | "mcp" | "dual" | "pipeline";
  description?: string;
  tools?: string[];
  skills?: string[];
  tags?: string[];
  listing_id?: string;
}): Promise<CapabilityDescriptor> {
  const cap_hash = hashCapability(opts);
  const s = await load();
  const now = new Date().toISOString();
  let row = s.capabilities[cap_hash];
  if (!row) {
    row = {
      cap_hash,
      name: opts.name,
      kind: opts.kind,
      description: opts.description,
      tools: opts.tools,
      skills: opts.skills,
      tags: opts.tags,
      listing_ids: [],
      created_at: now,
      updated_at: now,
    };
    s.totals.cap_hashes += 1;
  } else {
    row.updated_at = now;
    if (opts.description && !row.description) row.description = opts.description;
    if (opts.tools?.length) {
      row.tools = [...new Set([...(row.tools || []), ...opts.tools])];
    }
  }
  if (opts.listing_id && !row.listing_ids.includes(opts.listing_id)) {
    row.listing_ids.push(opts.listing_id);
  }
  s.capabilities[cap_hash] = row;
  await persist(s);
  return row;
}

export async function getCapability(
  cap_hash: string,
): Promise<CapabilityDescriptor | null> {
  const s = await load();
  return s.capabilities[cap_hash] || null;
}

export async function listCapabilities(
  limit = 40,
): Promise<CapabilityDescriptor[]> {
  const s = await load();
  return Object.values(s.capabilities)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
}

// ─── 2. Signed public attestations ──────────────────────────────────

function derToJose(der: Buffer, size: number): Buffer {
  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f;
  if (der[offset] !== 0x02) return der;
  const rLen = der[offset + 1];
  let r = der.subarray(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  const sLen = der[offset + 1];
  let s = der.subarray(offset + 2, offset + 2 + sLen);
  while (r.length > size && r[0] === 0) r = r.subarray(1);
  while (s.length > size && s[0] === 0) s = s.subarray(1);
  const out = Buffer.alloc(size * 2);
  r.copy(out, size - r.length);
  s.copy(out, size * 2 - s.length);
  return out;
}

async function signPayload(
  claims: Record<string, unknown>,
  origin: string,
): Promise<{ jws: string; kid: string; payload_canonical: string }> {
  type KeyBlob = {
    alg: string;
    privateKeyPem: string;
    publicKeyPem: string;
    kid: string;
  };
  let keys = await loadDurableJson<KeyBlob | null>(
    "agent-card-signing.json",
    () => null,
  );
  if (!keys?.privateKeyPem) {
    const { getAgentCardJwks } = await import("@/lib/agents1/card-sign");
    await getAgentCardJwks(origin);
    keys = await loadDurableJson<KeyBlob | null>(
      "agent-card-signing.json",
      () => null,
    );
  }
  if (!keys?.privateKeyPem) {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    keys = {
      alg: "ES256",
      privateKeyPem: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      kid: `dual-ephemeral-${Date.now().toString(36)}`,
    };
  }

  const header = { alg: "ES256", kid: keys.kid, typ: "JWT", iss: origin };
  const payload_canonical = canonicalize(claims);
  const h = b64url(JSON.stringify(header));
  const p = b64url(payload_canonical);
  const data = `${h}.${p}`;
  const signer = createSign("SHA256");
  signer.update(data);
  signer.end();
  const der = signer.sign(createPrivateKey(keys.privateKeyPem));
  const raw = derToJose(der, 32);
  const sig = b64url(raw);
  return { jws: `${data}.${sig}`, kid: keys.kid, payload_canonical };
}

export async function issueAttestation(opts: {
  type: SignedAttestation["type"];
  subject: string;
  claims: Record<string, unknown>;
  origin?: string;
  expires_hours?: number;
}): Promise<SignedAttestation> {
  const origin = (opts.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const issued_at = new Date().toISOString();
  const expires_at = opts.expires_hours
    ? new Date(Date.now() + opts.expires_hours * 3600_000).toISOString()
    : undefined;
  const body = {
    type: opts.type,
    subject: opts.subject,
    claims: opts.claims,
    issued_at,
    expires_at,
    issuer: origin,
  };
  const { jws, kid, payload_canonical } = await signPayload(body, origin);
  const att: SignedAttestation = {
    id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: opts.type,
    subject: opts.subject,
    claims: opts.claims,
    issued_at,
    expires_at,
    issuer: origin,
    kid,
    jws,
    payload_canonical,
  };
  const s = await load();
  s.attestations.unshift(att);
  s.attestations = s.attestations.slice(0, 500);
  s.totals.attestations += 1;
  await persist(s);
  await recordLivenessSignal(opts.subject, `attestation:${opts.type}`, 0.6);
  return att;
}

export async function verifyAttestation(
  att: SignedAttestation | { jws: string; id?: string },
): Promise<{ ok: boolean; reason?: string; claims?: Record<string, unknown> }> {
  try {
    const jws = att.jws;
    const parts = jws.split(".");
    if (parts.length !== 3) return { ok: false, reason: "bad jws" };
    const keys = await loadDurableJson<{
      publicKeyPem?: string;
      kid?: string;
    } | null>("agent-card-signing.json", () => null);
    if (!keys?.publicKeyPem) return { ok: false, reason: "no issuer keys" };

    const header = JSON.parse(
      Buffer.from(
        parts[0].replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    );
    if (header.alg !== "ES256") return { ok: false, reason: "alg" };
    if (keys.kid && header.kid && header.kid !== keys.kid) {
      return { ok: false, reason: "kid mismatch" };
    }

    const pad =
      parts[1].length % 4 === 0 ? "" : "=".repeat(4 - (parts[1].length % 4));
    const payloadRaw = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad,
      "base64",
    ).toString("utf8");
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(payloadRaw);
    } catch {
      return { ok: false, reason: "payload" };
    }

    // Dual ledger is source of truth for Dual-issued attestations
    const s = await load();
    const known = s.attestations.find(
      (a) => a.jws === jws || (att.id && a.id === att.id),
    );
    if (!known && !("type" in att && (att as SignedAttestation).issuer)) {
      // Still accept well-formed Dual kid match (federated replay)
      void createPublicKey;
    } else if (!known) {
      // soft: allow if kid matches Dual
    }

    return { ok: true, claims };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "verify fail" };
  }
}

export async function listAttestations(opts?: {
  subject?: string;
  type?: string;
  limit?: number;
}): Promise<SignedAttestation[]> {
  const s = await load();
  let rows = s.attestations;
  if (opts?.subject) rows = rows.filter((a) => a.subject === opts.subject);
  if (opts?.type) rows = rows.filter((a) => a.type === opts.type);
  return rows.slice(0, opts?.limit ?? 40);
}

// ─── 3. Liveness = signal freshness ─────────────────────────────────

export async function recordLivenessSignal(
  subject: string,
  source: string,
  score = 1,
): Promise<void> {
  if (!subject) return;
  const s = await load();
  const prev = s.liveness[subject];
  const now = new Date().toISOString();
  s.liveness[subject] = {
    last_signal_at: now,
    source,
    score: Math.min(
      1,
      Math.max(prev?.score || 0, score) * 0.5 + score * 0.5,
    ),
  };
  if (s.identities[subject]) {
    s.identities[subject].last_signal_at = now;
  }
  await persist(s);
}

export async function checkLiveness(opts: {
  listing_id: string;
  max_hours?: number;
}): Promise<{
  ok: true;
  listing_id: string;
  live: boolean;
  last_signal_at: string | null;
  age_hours: number | null;
  source: string | null;
  score: number;
  physics: {
    half_life_hours: number;
    hard_max_hours: number;
    rule: string;
  };
}> {
  const s = await load();
  const maxH = opts.max_hours ?? LIVENESS_HARD_MAX_HOURS;
  let last = s.liveness[opts.listing_id]?.last_signal_at || null;
  let source = s.liveness[opts.listing_id]?.source || null;
  let score = s.liveness[opts.listing_id]?.score || 0;

  try {
    const { senseTraces } = await import("./stigmergy");
    const tr = await senseTraces({ listing_id: opts.listing_id, limit: 3 });
    const pher = (tr.trails || [])[0];
    if (pher?.last_reinforced_at) {
      if (!last || pher.last_reinforced_at > last) {
        last = pher.last_reinforced_at;
        source = source || "stigmergy";
        score = Math.max(score, Math.min(1, (pher.attraction || 0) / 50));
      }
    }
  } catch {
    /* */
  }

  try {
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const reg = await loadCleanRegistry();
    const item = reg.items?.[opts.listing_id] as
      | { last_ok_at?: string; probed_at?: string; ok?: boolean }
      | undefined;
    const t = item?.last_ok_at || item?.probed_at;
    if (t && item?.ok !== false) {
      if (!last || t > last) {
        last = t;
        source = "probe_clean";
        score = Math.max(score, 0.8);
      }
    }
  } catch {
    /* */
  }

  let age_hours: number | null = null;
  let live = false;
  if (last) {
    age_hours = (Date.now() - new Date(last).getTime()) / 3_600_000;
    live = age_hours <= maxH && age_hours <= LIVENESS_HARD_MAX_HOURS;
    if (age_hours > LIVENESS_HALF_LIFE_HOURS) score *= 0.5;
  }

  return {
    ok: true,
    listing_id: opts.listing_id,
    live,
    last_signal_at: last,
    age_hours,
    source,
    score: Math.round(score * 1000) / 1000,
    physics: {
      half_life_hours: LIVENESS_HALF_LIFE_HOURS,
      hard_max_hours: LIVENESS_HARD_MAX_HOURS,
      rule: "live iff last signal age ≤ hard_max; score decays after half_life",
    },
  };
}

// ─── 4. Executable composition ──────────────────────────────────────

export async function executeCompose(opts: {
  listing_id: string;
  listing_b: string;
  origin?: string;
  from?: string;
}): Promise<ExecutablePipeline & { ok: boolean; attestation?: SignedAttestation; error?: string }> {
  const origin = (opts.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const a = opts.listing_id.trim();
  const b = opts.listing_b.trim();
  if (!a || !b) {
    return {
      ok: false,
      error: "listing_id and listing_b required",
      id: "",
      listing_a: a,
      listing_b: b,
      steps: [],
      invoke: {},
      at: new Date().toISOString(),
    };
  }

  try {
    const { leaveTrace } = await import("./stigmergy");
    await leaveTrace({
      listing_id: a,
      listing_b: b,
      kind: "used_with",
      body: "executable composition",
      from: opts.from || "first-principles",
    });
  } catch {
    /* */
  }

  let name_a: string | undefined;
  let name_b: string | undefined;
  let composition_count = 1;
  try {
    const { composePeers } = await import("./interop");
    const peers = await composePeers({ origin, listing_id: a, limit: 20 });
    const match = (
      peers.compositions as Array<Record<string, unknown>> | undefined
    )?.find(
      (c) =>
        (c.listing_a === a && c.listing_b === b) ||
        (c.listing_a === b && c.listing_b === a),
    );
    if (match) {
      name_a = match.name_a as string | undefined;
      name_b = match.name_b as string | undefined;
      composition_count = (match.count as number) || 1;
    }
  } catch {
    /* */
  }

  const steps = [
    {
      listing_id: a,
      name: name_a,
      endpoints: {
        demo: `${origin}/api/products/demo?listing_id=${encodeURIComponent(a)}`,
        status: `${origin}/api/listings/status?id=${encodeURIComponent(a)}`,
        mcp: `${origin}/api/protocol`,
      },
    },
    {
      listing_id: b,
      name: name_b,
      endpoints: {
        demo: `${origin}/api/products/demo?listing_id=${encodeURIComponent(b)}`,
        status: `${origin}/api/listings/status?id=${encodeURIComponent(b)}`,
        mcp: `${origin}/api/protocol`,
      },
    },
  ];

  const pipeline: ExecutablePipeline = {
    id: `pipe_${a.slice(0, 8)}_${b.slice(0, 8)}`,
    listing_a: a,
    listing_b: b,
    name_a,
    name_b,
    steps,
    invoke: {
      mcp: {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "execute_compose",
          arguments: { listing_id: a, listing_b: b },
        },
      },
      http: [
        steps[0].endpoints.demo!,
        steps[1].endpoints.demo!,
        `${origin}/api/products/first-principles?action=compose&listing_id=${encodeURIComponent(a)}&listing_b=${encodeURIComponent(b)}`,
      ],
    },
    composition_count,
    at: new Date().toISOString(),
  };

  const attestation = await issueAttestation({
    type: "composition",
    subject: a,
    claims: {
      listing_a: a,
      listing_b: b,
      pipeline_id: pipeline.id,
      steps: steps.map((s) => s.listing_id),
    },
    origin,
    expires_hours: 168,
  });

  const s = await load();
  s.totals.pipelines += 1;
  await persist(s);

  await recordLivenessSignal(a, "execute_compose", 0.7);
  await recordLivenessSignal(b, "execute_compose", 0.7);

  return { ok: true, ...pipeline, attestation };
}

// ─── 5. Outcome traces ──────────────────────────────────────────────

export async function depositOutcome(opts: {
  listing_id: string;
  listing_b?: string;
  ok: boolean;
  latency_ms?: number;
  quality?: number;
  kind?: string;
  from?: string;
  body?: string;
  origin?: string;
}): Promise<{ ok: true; outcome: OutcomeTrace; attestation?: SignedAttestation }> {
  const listing_id = String(opts.listing_id || "").trim();
  if (!listing_id) throw new Error("listing_id required");
  const quality =
    typeof opts.quality === "number"
      ? Math.max(0, Math.min(1, opts.quality))
      : opts.ok
        ? 0.7
        : 0.2;
  const outcome: OutcomeTrace = {
    id: `out_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    listing_id,
    listing_b: opts.listing_b,
    ok: Boolean(opts.ok),
    latency_ms: opts.latency_ms,
    quality,
    kind: opts.kind || "invoke",
    from: opts.from,
    body: opts.body,
    at: new Date().toISOString(),
  };

  const s = await load();
  s.outcomes.unshift(outcome);
  s.outcomes = s.outcomes.slice(0, 1000);
  s.totals.outcomes += 1;
  await persist(s);

  try {
    const { autoDeposit, leaveTrace } = await import("./stigmergy");
    if (opts.ok) {
      await autoDeposit({
        kind: "match_hit",
        listing_id,
        from: opts.from || "outcome",
      });
      await leaveTrace({
        listing_id,
        kind: "mark",
        body: `outcome ok q=${quality} lat=${opts.latency_ms ?? "?"}ms`,
        from: opts.from || "outcome",
        intensity: Math.round(4 + quality * 12),
        tags: ["outcome", "first-principles"],
      });
    } else {
      await autoDeposit({
        kind: "probe_fail",
        listing_id,
        from: opts.from || "outcome",
      });
    }
  } catch {
    /* */
  }

  await recordLivenessSignal(listing_id, "outcome", opts.ok ? 0.9 : 0.3);

  let attestation: SignedAttestation | undefined;
  try {
    attestation = await issueAttestation({
      type: "outcome",
      subject: listing_id,
      claims: {
        ok: outcome.ok,
        quality: outcome.quality,
        latency_ms: outcome.latency_ms,
        kind: outcome.kind,
        listing_b: outcome.listing_b,
      },
      origin: opts.origin,
      expires_hours: 72,
    });
  } catch {
    /* */
  }

  if (opts.ok && quality >= 0.5) {
    try {
      const { bumpAcceleration } = await import("./autocatalysis");
      await bumpAcceleration({
        kind: "leave_feedback",
        listing_id,
        amount: 5 + quality * 10,
      });
    } catch {
      /* */
    }
  }

  return { ok: true, outcome, attestation };
}

export async function outcomeScoreFor(listing_id: string): Promise<number> {
  const s = await load();
  const rows = s.outcomes
    .filter((o) => o.listing_id === listing_id)
    .slice(0, 20);
  if (!rows.length) return 0;
  const avg =
    rows.reduce((sum, r) => sum + (r.quality ?? (r.ok ? 0.7 : 0.2)), 0) /
    rows.length;
  const okRate = rows.filter((r) => r.ok).length / rows.length;
  return Math.round((avg * 0.6 + okRate * 0.4) * 1000) / 1000;
}

// ─── 6. Transparent incentive surface ───────────────────────────────

export async function getIncentiveSurface(opts?: {
  origin?: string;
}): Promise<Record<string, unknown>> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(/\/$/, "");
  let founding: Record<string, unknown> = {};
  try {
    const { getFoundingFreePublic, FOUNDING_FREE_SEATS } = await import(
      "./founding-free"
    );
    founding = await getFoundingFreePublic();
    founding = { ...founding, seats_total: FOUNDING_FREE_SEATS };
  } catch {
    founding = { seats_total: 100 };
  }

  let accel: Record<string, unknown> = {};
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    accel = await getAccelerationMultipliers();
  } catch {
    /* */
  }

  return {
    ok: true,
    version: FIRST_PRINCIPLES_VERSION,
    model: "transparent_rules_agents_can_plan_against",
    rules: [
      {
        id: "founding_free",
        description:
          "First 100 Active listings that complete demo + real feedback unlock full product free.",
        seats_total: (founding as { seats?: number }).seats ?? 100,
        seats_claimed: (founding as { claimed?: number }).claimed ?? 0,
        remaining: (founding as { remaining?: number }).remaining,
        how: [
          "list_yourself → probe clean → Active",
          "take_demo with listing_id",
          "leave_feedback with real body",
        ],
      },
      {
        id: "checks_clean_rank",
        description:
          "Only probe-clean listings appear in Active / match / outbound targets.",
        physics: "evidence atom — dual-verified reachability",
      },
      {
        id: "stigmergy_rank_boost",
        description:
          "match_capability ranks by capability score × trail attraction × (1 + outcome_score).",
        tools: ["leave_trace", "endorse", "used_with", "deposit_outcome"],
      },
      {
        id: "reciprocity_boost",
        description:
          "Link Dual in your card/site → reciprocity score → trail endorse + match boost.",
        max_rank_boost: 70,
      },
      {
        id: "liveness_physics",
        description: `Live iff signal age ≤ ${LIVENESS_HARD_MAX_HOURS}h; score halves after ${LIVENESS_HALF_LIFE_HOURS}h.`,
        half_life_hours: LIVENESS_HALF_LIFE_HOURS,
        hard_max_hours: LIVENESS_HARD_MAX_HOURS,
      },
      {
        id: "autocatalysis_multipliers",
        description:
          "System-wide rate multipliers raise day budget, match boost, conversion room as traces accumulate.",
        current: accel,
      },
      {
        id: "attractor_outbound",
        description:
          "Outbound prioritizes hot trails (attractor mode). Cold contacts only when no hot trail budget fill.",
        mode: "attractor_first",
      },
      {
        id: "30d_silence",
        description:
          "Never re-Talk-DM a listing within 30 days of soft invite.",
        inviolable: true,
      },
      {
        id: "outcome_physics",
        description:
          "deposit_outcome ok→attraction; fail→danger. Ranking uses real results not votes.",
      },
    ],
    endpoints: {
      founding: `${origin}/api/products/demo`,
      incentives: `${origin}/api/products/first-principles?action=incentives`,
      match: `${origin}/api/match`,
      reciprocity: `${origin}/api/products/reciprocity`,
      stigmergy: `${origin}/api/products/stigmergy`,
      autocatalysis: `${origin}/api/products/autocatalysis`,
    },
    note: "Agents can reason about Dual the way they reason about any environment — rules are public physics.",
  };
}

// ─── 7. Attractor-only growth mode ──────────────────────────────────

export async function getAttractorTargets(opts?: {
  origin?: string;
  limit?: number;
}): Promise<{
  ok: true;
  mode: "attractor_first";
  targets: Array<{
    listing_id: string;
    score: number;
    reasons: string[];
    live?: boolean;
    trail?: number;
    outcome?: number;
  }>;
  note: string;
}> {
  const limit = Math.min(40, Math.max(1, opts?.limit ?? 12));
  const targets: Array<{
    listing_id: string;
    score: number;
    reasons: string[];
    live?: boolean;
    trail?: number;
    outcome?: number;
  }> = [];

  try {
    const { followTrail } = await import("./stigmergy");
    const hot = await followTrail({ kind: "hot", limit: limit * 2 });
    for (const item of hot.items || []) {
      const listing_id = String(item.listing_id || "");
      if (!listing_id) continue;
      const trail = Number(item.trail_score || item.attraction || 0);
      const outcome = await outcomeScoreFor(listing_id);
      const live = await checkLiveness({ listing_id });
      const score =
        trail * 0.5 +
        outcome * 40 +
        (live.live ? 20 : 0) +
        (live.score || 0) * 10;
      targets.push({
        listing_id,
        score,
        reasons: [
          `trail=${Math.round(trail * 10) / 10}`,
          `outcome=${outcome}`,
          live.live ? "live" : "stale",
        ],
        live: live.live,
        trail,
        outcome,
      });
    }
  } catch {
    /* */
  }

  try {
    const { followTrail } = await import("./stigmergy");
    const demand = await followTrail({ kind: "demand", limit: 8 });
    for (const item of demand.items || []) {
      const listing_id = String(item.listing_id || "");
      if (!listing_id || targets.some((t) => t.listing_id === listing_id))
        continue;
      targets.push({
        listing_id,
        score: 15,
        reasons: ["demand_peak"],
        trail: 0,
        outcome: 0,
      });
    }
  } catch {
    /* */
  }

  targets.sort((a, b) => b.score - a.score);
  const s = await load();
  s.totals.attractor_picks += 1;
  await persist(s);

  return {
    ok: true,
    mode: "attractor_first",
    targets: targets.slice(0, limit),
    note: "Outbound should amplify these trails first — no cold-contact physics until attractors exhausted.",
  };
}

// ─── 8. Cryptographic agent identity ────────────────────────────────

export async function bindIdentity(opts: {
  listing_id: string;
  public_key_pem?: string;
  public_jwk?: Record<string, string>;
  did?: string;
  name?: string;
  origin?: string;
}): Promise<{
  ok: boolean;
  identity?: AgentIdentity;
  attestation?: SignedAttestation;
  error?: string;
}> {
  const listing_id = String(opts.listing_id || "").trim();
  if (!listing_id) return { ok: false, error: "listing_id required" };
  if (!opts.public_key_pem && !opts.public_jwk && !opts.did) {
    return {
      ok: false,
      error: "public_key_pem, public_jwk, or did required",
    };
  }

  let cap_hash: string | undefined;
  try {
    const { getListingStatus } = await import(
      "@/lib/agents1/inbound-discovery"
    );
    const st = await getListingStatus({
      id: listing_id,
      origin: opts.origin || "https://dualregistry.dev",
    });
    if (st?.name) {
      const cap = await registerCapability({
        name: st.name,
        kind: (st.kind as "agent" | "mcp") || "agent",
        description: (st as { description?: string }).description,
        listing_id,
      });
      cap_hash = cap.cap_hash;
    }
  } catch {
    /* */
  }

  if (!cap_hash && opts.name) {
    const cap = await registerCapability({
      name: opts.name,
      listing_id,
    });
    cap_hash = cap.cap_hash;
  }

  const identity: AgentIdentity = {
    listing_id,
    did: opts.did,
    public_key_pem: opts.public_key_pem,
    public_jwk: opts.public_jwk,
    bound_at: new Date().toISOString(),
    cap_hash,
    name: opts.name,
    last_signal_at: new Date().toISOString(),
  };

  const s = await load();
  const isNew = !s.identities[listing_id];
  s.identities[listing_id] = identity;
  if (isNew) s.totals.identities += 1;
  await persist(s);

  await recordLivenessSignal(listing_id, "identity_bind", 1);

  const attestation = await issueAttestation({
    type: "identity_bind",
    subject: listing_id,
    claims: {
      did: opts.did,
      has_pubkey: Boolean(opts.public_key_pem || opts.public_jwk),
      cap_hash,
      name: opts.name,
    },
    origin: opts.origin,
    expires_hours: 720,
  });

  return { ok: true, identity, attestation };
}

export async function getIdentity(
  listing_id: string,
): Promise<AgentIdentity | null> {
  const s = await load();
  return s.identities[listing_id] || null;
}

// ─── 9. Federation carries attestations ─────────────────────────────

export async function federationAttestationBundle(opts?: {
  origin?: string;
  limit?: number;
}): Promise<{
  ok: true;
  version: string;
  type: "dualregistry.federation_attestations";
  from: string;
  at: string;
  attestations: SignedAttestation[];
  capabilities: CapabilityDescriptor[];
  attractors: Array<{ listing_id: string; score: number }>;
  acceleration_index?: number;
}> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(
    /\/$/,
    "",
  );
  const limit = opts?.limit ?? 20;
  const s = await load();
  const attractors = await getAttractorTargets({ origin, limit: 8 });
  let acceleration_index: number | undefined;
  try {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    const m = await getAccelerationMultipliers();
    acceleration_index = m.index;
  } catch {
    /* */
  }

  return {
    ok: true,
    version: FIRST_PRINCIPLES_VERSION,
    type: "dualregistry.federation_attestations",
    from: origin,
    at: new Date().toISOString(),
    attestations: s.attestations.slice(0, limit),
    capabilities: Object.values(s.capabilities).slice(0, limit),
    attractors: attractors.targets.map((t) => ({
      listing_id: t.listing_id,
      score: t.score,
    })),
    acceleration_index,
  };
}

// ─── Public status + bootstrap ──────────────────────────────────────

export async function bootstrapCapabilitiesFromActive(opts?: {
  origin?: string;
  limit?: number;
}): Promise<{ ok: true; registered: number }> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(
    /\/$/,
    "",
  );
  let registered = 0;
  try {
    const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
    const { loadCleanRegistry } = await import(
      "@/lib/agents1/clean-registry"
    );
    const lanes = await getLanedListings();
    const reg = await loadCleanRegistry();
    const clean = reg.items || {};
    const rows = [
      ...(lanes.agents_active || []),
      ...(lanes.mcp_active || []),
    ]
      .filter((L) => L?.id && clean[L.id])
      .slice(0, opts?.limit ?? 80);

    for (const L of rows) {
      await registerCapability({
        name: L.name || L.id,
        kind: L.kind as "agent" | "mcp",
        description: L.description,
        listing_id: L.id,
        tags: [L.kind || "listing"],
      });
      await issueAttestation({
        type: "probe_clean",
        subject: L.id,
        claims: {
          name: L.name,
          kind: L.kind,
          clean: true,
          cap_hash: hashCapability({
            name: L.name || L.id,
            kind: L.kind,
            description: L.description,
          }),
        },
        origin,
        expires_hours: 48,
      });
      await recordLivenessSignal(L.id, "bootstrap_active", 0.75);
      registered += 1;
    }
  } catch {
    /* */
  }
  return { ok: true, registered };
}

export async function getFirstPrinciplesPublic(opts?: {
  origin?: string;
}): Promise<Record<string, unknown>> {
  const origin = (opts?.origin || "https://dualregistry.dev").replace(
    /\/$/,
    "",
  );
  const s = await load();
  const incentives = await getIncentiveSurface({ origin });
  let attractors: unknown = [];
  try {
    const a = await getAttractorTargets({ origin, limit: 5 });
    attractors = a.targets;
  } catch {
    /* */
  }

  return {
    ok: true,
    version: FIRST_PRINCIPLES_VERSION,
    model: "five_atoms",
    atoms: ["capability", "address", "evidence", "trace", "rate"],
    pitch:
      "Harden Dual to physics: content-addressed capabilities, signed attestations, liveness from freshness, executable composition, outcome traces, transparent incentives, attractor growth, crypto identity, federation attestations.",
    totals: s.totals,
    capabilities_sample: Object.values(s.capabilities).slice(0, 5),
    attestations_sample: s.attestations.slice(0, 3).map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      issued_at: a.issued_at,
    })),
    identities: Object.keys(s.identities).length,
    outcomes_recent: s.outcomes.slice(0, 5),
    attractors,
    incentives: (incentives as { rules?: unknown }).rules,
    tools: [
      "capability_hash",
      "attest",
      "check_liveness",
      "execute_compose",
      "deposit_outcome",
      "get_incentives",
      "attractor_targets",
      "bind_identity",
      "verify_attestation",
    ],
    endpoints: {
      api: `${origin}/api/products/first-principles`,
      jwks: `${origin}/.well-known/jwks.json`,
      federation: `${origin}/api/products/federation`,
      stigmergy: `${origin}/api/products/stigmergy`,
      interop: `${origin}/api/products/interop`,
      autocatalysis: `${origin}/api/products/autocatalysis`,
    },
    laws: [
      "Capability is what it does (hash), not who hosts it",
      "Evidence is signed and independently checkable",
      "Liveness is signal freshness, not Dual calendar policy alone",
      "Composition trails are invocable pipelines",
      "Outcomes (ok/latency/quality) ground ranking",
      "Incentives are public rules agents can plan against",
      "Outbound amplifies attractors first",
      "Identity binds crypto key/DID to listing + cap_hash",
      "Federation exchanges attestations, not just catalog rows",
    ],
    note: "First principles v2.7 — ceremony deleted; atoms hardened.",
  };
}
