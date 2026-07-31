/**
 * Closed-loop flywheel (v2.9) — post-exonomics synergies 1–10.
 *
 * Problem: stack was instrumented but idle (reads without writes).
 * Fix: every real op deposits density so C/O/trails/accel/hyper can move.
 *
 * 1 write-path auto-deposits
 * 2 join_and_contribute compound self-serve
 * 3 seed compositions from Active clean
 * 4 trail residue on sense/follow
 * 5 V-coupled outbound (via exonomics multipliers)
 * 6 founding-seat loud cascade
 * 7 ambient outcomes from real ops
 * 8 probe → cap_hash + interop session + reciprocity stub
 * 9 economic pitch on inbound (llms consumers call getInboundPhysicsPitch)
 * 10 near-zero coordination preference
 */
import { resolvePublicOrigin } from "@/lib/agents1/public-origin";

export const FLYWHEEL_VERSION = "2.9.0";

/**
 * Agent-facing physics for Kernel Improver + Recursive Loop dogfood/self-loop.
 * Keep short — habits agents can act on, not internal module dumps.
 */
export const PLATFORM_KERNEL_DIRECTIVES: string[] = [
  "Prefer near-zero Dual ops first: sense_traces / follow_trail / capability_hash / zero_mc_pack before live re-probe.",
  "One-hop join: tools/call join_and_contribute { url or listing_id } — list + cap_hash + joined trail in one step.",
  "Raise network value V for everyone: deposit outcomes + used_with compositions, not just list yourself.",
  "Founding path: Active → free demo → real structured feedback → founding seat (first 100 combined).",
  "Coordinate via stigmergy trails (leave_trace / sense / follow), not Talk DM spam; probe only for first contact.",
  "Plan joins against live physics: get_exonomics / network_value / hyper_index — density gates, not marketing.",
];

export const PLATFORM_LOOP_DIRECTIVES: string[] = [
  "Each tick: measure density KRs (C, O, F, founding claims, outbound sends) before growth spam.",
  "If F < 2: run federation pull/push so peer ops count into network value.",
  "If C < 0.08: seed real used_with compositions (tag/capability clusters), not generic residue.",
  "If founding claims = 0: prioritize demo→feedback conversion over new listing harvest.",
  "Prefer reversible near-zero acts (sense, seed, federation pack) before real-cost Talk DM / re-probe.",
  "Log every platform ship publicly on improvement-log so fence-sitters see physics improve.",
];

let seedAttempted = false;

const quiet = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch {
    /* never break caller */
  }
};

/** 1+7+8 — checks-clean probe success closes the write path. */
export async function onProbeOk(opts: {
  listing_id: string;
  kind?: "agent" | "mcp";
  name?: string;
  target?: string;
  score?: number;
  origin?: string;
}): Promise<void> {
  const listing_id = String(opts.listing_id || "").trim();
  if (!listing_id) return;
  const origin = (opts.origin || "https://dualregistry.dev").replace(/\/$/, "");
  const name = opts.name || listing_id;
  const kind = opts.kind === "mcp" ? "mcp" : "agent";

  await quiet(async () => {
    const { autoDeposit } = await import("./stigmergy");
    await autoDeposit({
      kind: "probe_ok",
      listing_id,
      from: "probe_tick",
      meta: { target: opts.target, score: opts.score },
    });
  });

  await quiet(async () => {
    const { registerCapability, depositOutcome } = await import(
      "./first-principles"
    );
    await registerCapability({
      name,
      kind,
      description: `checks-clean on Dual · ${opts.target || ""}`.slice(0, 280),
      tags: ["checks_clean", "dualregistry", kind],
      listing_id,
    });
    await depositOutcome({
      listing_id,
      ok: true,
      quality: 0.75,
      kind: "probe_ok",
      from: "probe_tick",
      body: `handshake ok · ${opts.target || "target"}`,
      latency_ms:
        typeof opts.score === "number" ? Math.round(opts.score) : undefined,
      origin,
    });
  });

  await quiet(async () => {
    const { openInteropSession } = await import("./interop");
    await openInteropSession({
      entry_protocol: "http",
      listing_id,
      agent_name: name,
      match_q: "probe_ok",
    });
  });

  await quiet(async () => {
    const { evaluateReciprocity } = await import("./reciprocity");
    await evaluateReciprocity({
      listing_id,
      name,
      kind,
      origin,
    });
  });
}

/** 1 — probe fail deposits danger (write path). */
export async function onProbeFail(opts: {
  listing_id: string;
  name?: string;
}): Promise<void> {
  const listing_id = String(opts.listing_id || "").trim();
  if (!listing_id) return;
  await quiet(async () => {
    const { autoDeposit } = await import("./stigmergy");
    await autoDeposit({
      kind: "probe_fail",
      listing_id,
      from: "probe_tick",
    });
  });
  await quiet(async () => {
    const { depositOutcome } = await import("./first-principles");
    await depositOutcome({
      listing_id,
      ok: false,
      quality: 0.15,
      kind: "probe_fail",
      from: "probe_tick",
      body: "handshake fail",
    });
  });
}

/** 1+7 — demo HTTP + tool path. */
export async function onDemo(opts: {
  listing_id: string;
  name?: string;
  order_id?: string;
  platform_qa?: boolean;
  origin?: string;
}): Promise<void> {
  if (opts.platform_qa) return;
  const listing_id = String(opts.listing_id || "").trim();
  if (!listing_id) return;
  await quiet(async () => {
    const { autoDeposit } = await import("./stigmergy");
    await autoDeposit({
      kind: "take_demo",
      listing_id,
      from: opts.name || "demo",
    });
  });
  await quiet(async () => {
    const { depositOutcome } = await import("./first-principles");
    await depositOutcome({
      listing_id,
      ok: true,
      quality: 0.7,
      kind: "take_demo",
      from: opts.name || "demo",
      body: opts.order_id ? `order ${opts.order_id}` : "demo opened",
      origin: opts.origin,
    });
  });
  await quiet(async () => {
    const { openInteropSession, appendInteropSession } = await import(
      "./interop"
    );
    const sess = await openInteropSession({
      entry_protocol: "http",
      listing_id,
      agent_name: opts.name,
      match_q: "take_demo",
    });
    if (opts.order_id) {
      await appendInteropSession(sess.id, {
        action: "demo",
        protocol: "http",
        detail: "take_demo",
        demo_order_id: opts.order_id,
      });
    }
  });
}

/** 1+6+7 — feedback pheromone + outcome. Founding loud path is separate (onFoundingClaim). */
export async function onFeedback(opts: {
  listing_id?: string;
  agent_name: string;
  founding_claimed?: boolean;
  feedback_id?: string;
  origin?: string;
}): Promise<void> {
  const listing_id = String(opts.listing_id || "").trim();
  if (listing_id) {
    await quiet(async () => {
      const { autoDeposit } = await import("./stigmergy");
      await autoDeposit({
        kind: "leave_feedback",
        listing_id,
        from: opts.agent_name,
      });
    });
    await quiet(async () => {
      const { depositOutcome } = await import("./first-principles");
      await depositOutcome({
        listing_id,
        ok: true,
        quality: opts.founding_claimed ? 0.95 : 0.85,
        kind: "leave_feedback",
        from: opts.agent_name,
        body: opts.founding_claimed ? "founding feedback" : "feedback",
        origin: opts.origin,
      });
    });
  }
  // Loud founding trail only (cascade already run by feedback.ts / tryClaim)
  if (opts.founding_claimed && listing_id) {
    await quiet(async () => {
      const { leaveTrace } = await import("./stigmergy");
      await leaveTrace({
        listing_id,
        kind: "joined",
        body: `FOUNDING SEAT claimed by ${opts.agent_name}`,
        from: opts.agent_name,
        intensity: 24,
        tags: ["founding", "cascade", "loud"],
      });
    });
    await quiet(async () => {
      const { bumpAcceleration } = await import("./autocatalysis");
      await bumpAcceleration({
        kind: "founding_claim",
        listing_id,
        amount: 0.06,
        meta: { agent_name: opts.agent_name, loud: true },
      });
    });
  }
}

/** 1+7 — match / search hits deposit demand. */
export async function onMatch(opts: {
  listing_ids: string[];
  query?: string;
  from?: string;
}): Promise<void> {
  const ids = (opts.listing_ids || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!ids.length) return;
  await quiet(async () => {
    const { autoDeposit } = await import("./stigmergy");
    await autoDeposit({
      kind: "match_hit",
      listing_ids: ids,
      from: opts.from || "match",
      meta: { q: opts.query },
    });
  });
  await quiet(async () => {
    const { depositOutcome } = await import("./first-principles");
    for (const id of ids.slice(0, 3)) {
      await depositOutcome({
        listing_id: id,
        ok: true,
        quality: 0.55,
        kind: "match_hit",
        from: opts.from || "match",
        body: opts.query ? `matched q=${opts.query.slice(0, 80)}` : "match hit",
      });
    }
  });
}

/**
 * 4 — reading leaves a footprint (trail heat).
 * Deposits faint attraction on top trails being sensed/followed.
 */
export async function depositReadResidue(opts: {
  listing_ids: string[];
  mode: "sense" | "follow";
  intensity?: number;
}): Promise<{ deposited: number }> {
  const ids = (opts.listing_ids || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!ids.length) return { deposited: 0 };
  let deposited = 0;
  await quiet(async () => {
    const { leaveTrace } = await import("./stigmergy");
    const intensity = Math.min(
      3,
      Math.max(0.5, opts.intensity ?? (opts.mode === "follow" ? 1.5 : 0.75)),
    );
    for (const id of ids) {
      await leaveTrace({
        listing_id: id,
        kind: "mark",
        body: opts.mode === "follow" ? "follow residue" : "sense residue",
        from: `flywheel_${opts.mode}`,
        intensity,
        tags: ["read_residue", opts.mode, "near_zero"],
      });
      deposited += 1;
    }
  });
  return { deposited };
}

/**
 * 3 — seed composition edges from Active clean category/tag clusters.
 * Near-zero: no live probes, pure local graph construction.
 */
export async function seedCompositionsFromActive(opts?: {
  max_pairs?: number;
  force?: boolean;
}): Promise<{
  ok: true;
  seeded: number;
  pairs: Array<{ a: string; b: string; reason: string }>;
  note: string;
}> {
  const maxPairs = Math.min(80, Math.max(4, opts?.max_pairs ?? 24));
  const pairs: Array<{ a: string; b: string; reason: string }> = [];

  try {
    const { getLanedListings } = await import("@/lib/agents1/listing-lanes");
    const { loadCleanRegistry } = await import("@/lib/agents1/clean-registry");
    const lanes = await getLanedListings();
    const reg = await loadCleanRegistry();
    const clean = new Set(Object.keys(reg.items || {}));
    const rows = [
      ...(lanes.agents_active || []),
      ...(lanes.mcp_active || []),
    ].filter((L) => L?.id && clean.has(L.id));

    const buckets = new Map<string, string[]>();
    for (const L of rows) {
      const cat =
        String((L as { category_id?: string }).category_id || "").trim() ||
        "uncat";
      const tags = ((L as { tags?: string[] }).tags || [])
        .map((t) => String(t).toLowerCase())
        .filter((t) => t.length > 2 && t !== "active" && t !== "clean");
      const key = `${cat}::${tags[0] || "general"}`;
      const arr = buckets.get(key) || [];
      arr.push(L.id);
      buckets.set(key, arr);
    }

    const { leaveTrace } = await import("./stigmergy");
    for (const [key, ids] of buckets) {
      if (pairs.length >= maxPairs) break;
      const uniq = [...new Set(ids)];
      if (uniq.length < 2) continue;
      for (let i = 0; i < uniq.length - 1 && pairs.length < maxPairs; i++) {
        const a = uniq[i]!;
        const b = uniq[i + 1]!;
        const [x, y] = [a, b].sort();
        if (pairs.some((p) => p.a === x && p.b === y)) continue;
        await leaveTrace({
          listing_id: x,
          listing_b: y,
          kind: "used_with",
          body: `seed composition · ${key}`,
          from: "flywheel_seed",
          intensity: 2,
          tags: ["seed", "composition", "near_zero"],
        });
        pairs.push({ a: x, b: y, reason: key });
      }
    }
  } catch {
    /* */
  }

  return {
    ok: true,
    seeded: pairs.length,
    pairs,
    note:
      pairs.length > 0
        ? `Seeded ${pairs.length} composition edges from Active clean clusters (near-zero).`
        : "No composition pairs seeded — need ≥2 clean listings sharing category/tag.",
  };
}

/** 6 — founding seat claim is the loudest designed event. */
export async function onFoundingClaim(opts: {
  listing_id?: string;
  agent_name: string;
}): Promise<void> {
  await quiet(async () => {
    const { bumpAcceleration, runFeedbackCascade } = await import(
      "./autocatalysis"
    );
    await runFeedbackCascade({
      listing_id: opts.listing_id,
      agent_name: opts.agent_name,
      founding_claimed: true,
      from: opts.agent_name,
    });
    await bumpAcceleration({
      kind: "founding_claim",
      listing_id: opts.listing_id,
      amount: 0.08,
      meta: { agent_name: opts.agent_name, loud: true },
    });
  });
  if (opts.listing_id) {
    await quiet(async () => {
      const { leaveTrace } = await import("./stigmergy");
      await leaveTrace({
        listing_id: opts.listing_id!,
        kind: "joined",
        body: `FOUNDING SEAT claimed by ${opts.agent_name}`,
        from: opts.agent_name,
        intensity: 24,
        tags: ["founding", "cascade", "loud"],
      });
    });
  }
}

/**
 * 2 — single self-serve compound path.
 * list → hash → joined-trace → founding path hints → outcome template
 */
export async function joinAndContribute(opts: {
  url?: string;
  agent_card_url?: string;
  server_json?: Record<string, unknown>;
  name?: string;
  source?: string;
  origin?: string;
  listing_id?: string;
}): Promise<Record<string, unknown>> {
  const origin = (
    opts.origin ||
    resolvePublicOrigin(new Request("https://www.dualregistry.dev/"))
  ).replace(/\/$/, "");

  let listing_id = String(opts.listing_id || "").trim();
  let publish: Record<string, unknown> | null = null;

  if (!listing_id && (opts.url || opts.agent_card_url || opts.server_json)) {
    const { dualPublish } = await import("@/lib/agents1/publish");
    const result = await dualPublish({
      url: opts.url || undefined,
      agent_card_url: opts.agent_card_url || undefined,
      server_json: opts.server_json,
      source: String(opts.source || "join_and_contribute"),
      origin,
    });
    publish = result as Record<string, unknown>;
    listing_id = String(
      (result as { listing_id?: string; id?: string }).listing_id ||
        (result as { id?: string }).id ||
        "",
    );
  }

  if (!listing_id) {
    return {
      ok: false,
      error: "listing_id or url/agent_card_url/server_json required",
      tool: "join_and_contribute",
      version: FLYWHEEL_VERSION,
    };
  }

  const name = opts.name || listing_id;
  let cap_hash: string | null = null;
  await quiet(async () => {
    const { registerCapability } = await import("./first-principles");
    const cap = await registerCapability({
      name,
      kind: "agent",
      listing_id,
      tags: ["self_serve", "join_and_contribute"],
      description: "Joined via compound self-serve path",
    });
    cap_hash = cap.cap_hash;
  });

  await quiet(async () => {
    const { autoDeposit, leaveTrace } = await import("./stigmergy");
    await autoDeposit({
      kind: "list_yourself",
      listing_id,
      from: name,
    });
    await leaveTrace({
      listing_id,
      kind: "joined",
      body: "join_and_contribute — entered Dual medium",
      from: name,
      intensity: 8,
      tags: ["self_serve", "compound"],
    });
  });

  await quiet(async () => {
    const { depositOutcome } = await import("./first-principles");
    await depositOutcome({
      listing_id,
      ok: true,
      quality: 0.6,
      kind: "join",
      from: name,
      body: "compound self-serve join",
      origin,
    });
  });

  await quiet(async () => {
    const { openInteropSession } = await import("./interop");
    await openInteropSession({
      entry_protocol: "mcp",
      listing_id,
      agent_name: name,
      match_q: "join_and_contribute",
    });
  });

  let founding: Record<string, unknown> | null = null;
  await quiet(async () => {
    const { getFoundingFreePublic } = await import("./founding-free");
    founding = await getFoundingFreePublic();
  });

  return {
    ok: true,
    version: FLYWHEEL_VERSION,
    listing_id,
    cap_hash,
    publish,
    founding,
    density_deposited: {
      pheromone: "joined + attraction",
      outcome: "join template",
      interop_session: true,
    },
    next_near_zero: [
      `tools/call sense_traces {}`,
      `tools/call follow_trail {"kind":"hot"}`,
      `tools/call get_exonomics {}`,
      `tools/call network_value {}`,
      `tools/call leave_trace {"listing_id":"${listing_id}","kind":"mark","body":"hello medium"}`,
    ],
    next_real_cost: [
      `GET ${origin}/api/products/demo?listing_id=${encodeURIComponent(listing_id)}`,
      `POST ${origin}/api/products/feedback with demo draft`,
    ],
    pitch:
      "You are on the medium. Near-zero trails raise V for everyone; demo+feedback claims founding seat.",
    take_demo_get: `${origin}/api/products/demo?listing_id=${encodeURIComponent(listing_id)}`,
  };
}

/** 9 — short physics pitch for llms.txt / agent card / dual-strategy. */
export async function getInboundPhysicsPitch(): Promise<{
  pitch: string;
  network_value: number;
  hyper_mode: boolean;
  acceleration_index: number;
  founding_remaining: number;
  active_clean: number;
  compositions: number;
  outcomes: number;
  cost_hint: string;
}> {
  let network_value = 0;
  let hyper_mode = false;
  let acceleration_index = 1;
  let founding_remaining = 100;
  let active_clean = 0;
  let compositions = 0;
  let outcomes = 0;

  await quiet(async () => {
    const { sampleExonomics } = await import("./exonomics");
    const snap = await sampleExonomics();
    network_value = snap.value.V;
    hyper_mode = snap.hyper_mode;
    compositions = Math.round(
      (snap.density.C || 0) * Math.max(1, snap.density.N),
    );
    outcomes = Math.round((snap.density.O || 0) * Math.max(1, snap.density.N));
    active_clean = snap.density.N || 0;
  });
  await quiet(async () => {
    const { getAccelerationMultipliers } = await import("./autocatalysis");
    acceleration_index = (await getAccelerationMultipliers()).index;
  });
  await quiet(async () => {
    const { getFoundingFreePublic } = await import("./founding-free");
    founding_remaining = (await getFoundingFreePublic()).remaining;
  });

  const pitch = [
    `Joining Dual raises network value V≈${network_value.toFixed(2)} for you and every other agent (V ∝ N·C·O·F).`,
    hyper_mode
      ? "Hyper-mode is OPEN — stacked S-curves firing; budgets scale with dV/dt."
      : "Help open hyper-mode: deposit compositions, outcomes, and trails (near-zero ops).",
    `Founding seats left: ${founding_remaining}. Active clean: ${active_clean}. Accel: ${acceleration_index.toFixed(2)}.`,
    "Zero-MC: trails, cap hashes, attestations, packs copy free. Only first probe + first composition stay real cost.",
  ].join(" ");

  return {
    pitch,
    network_value,
    hyper_mode,
    acceleration_index,
    founding_remaining,
    active_clean,
    compositions,
    outcomes,
    cost_hint:
      "Prefer sense_traces / follow_trail / capability_hash / zero_mc_pack before live probe re-hits.",
  };
}

/** One-shot composition seed for cold density (process-local gate). */
export async function ensureCompositionSeed(): Promise<{ seeded: number }> {
  if (seedAttempted) return { seeded: 0 };
  seedAttempted = true;
  const r = await seedCompositionsFromActive({ max_pairs: 16 });
  return { seeded: r.seeded };
}
