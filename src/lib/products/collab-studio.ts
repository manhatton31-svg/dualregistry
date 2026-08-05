/**
 * Collab Studio — converge 2+ agents/MCPs into workflow graphs,
 * run graph / agent / loop engineering, package sellable products.
 *
 * Durable: collab-studio.json
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";
import { runImproveKernel, runLoopTick, runMeshMatch, runMeshCompose } from "./event-value";
import { executeCompose } from "./first-principles";
import { leaveTrace } from "./stigmergy";
import { generateMcpMesh, generateKernel, generateRecursiveLoop } from "./generate";
import { mergeNetworkDirectives } from "./network-edition";

export const COLLAB_VERSION = "1.1.0";
const DURABLE = "collab-studio.json";

export type CollabNode = {
  listing_id: string;
  kind: "agent" | "mcp";
  name: string;
  description?: string;
  role?: "lead" | "partner" | "tool" | "reviewer";
  x?: number;
  y?: number;
};

export type CollabEdge = {
  id: string;
  from: string;
  to: string;
  kind: "talk" | "compose" | "data" | "loop";
  label?: string;
};

export type CollabStepLog = {
  at: string;
  mode: "graph" | "agent" | "loop" | "converge" | "package" | "talk";
  ok: boolean;
  summary: string;
  detail?: unknown;
};

export type CollabProductDraft = {
  product_id: string;
  title: string;
  tagline: string;
  sku_hint: "mcp_mesh" | "kernel" | "loop" | "collab_pack";
  price_cents_hint: number;
  collaborators: Array<{ listing_id: string; name: string; kind: string }>;
  artifact: Record<string, unknown>;
  sell_path: string;
  created_at: string;
};

export type CollabWorkflow = {
  id: string;
  name: string;
  goal: string;
  nodes: CollabNode[];
  edges: CollabEdge[];
  status: "draft" | "running" | "converged" | "packaged";
  steps: CollabStepLog[];
  product?: CollabProductDraft;
  created_at: string;
  updated_at: string;
};

export type CollabState = {
  version: string;
  workflows: CollabWorkflow[];
  updated_at: string;
};

function emptyState(): CollabState {
  return {
    version: COLLAB_VERSION,
    workflows: [],
    updated_at: new Date().toISOString(),
  };
}

function wid() {
  return `cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function eid() {
  return `e_${Math.random().toString(36).slice(2, 9)}`;
}

export async function loadCollabState(): Promise<CollabState> {
  const raw = await loadDurableJson<CollabState>(DURABLE, emptyState);
  if (!raw || typeof raw !== "object") return emptyState();
  return {
    ...emptyState(),
    ...raw,
    workflows: Array.isArray(raw.workflows) ? raw.workflows.slice(0, 40) : [],
  };
}

export async function saveCollabState(state: CollabState): Promise<void> {
  await saveDurableJson(DURABLE, {
    ...state,
    version: COLLAB_VERSION,
    updated_at: new Date().toISOString(),
  });
}

export async function getCollabPublic(opts: { origin: string }) {
  const s = await loadCollabState();
  return {
    ok: true,
    product: "collab_studio",
    version: COLLAB_VERSION,
    one_liner:
      "Talk with agents & MCPs, wire 2+ into a workflow graph, run graph/agent/loop engineering, package sellable collab products.",
    workflow_n: s.workflows.length,
    packaged_n: s.workflows.filter((w) => w.status === "packaged").length,
    workflows: s.workflows.map((w) => ({
      id: w.id,
      name: w.name,
      goal: w.goal,
      status: w.status,
      node_n: w.nodes.length,
      edge_n: w.edges.length,
      product_id: w.product?.product_id,
      updated_at: w.updated_at,
    })),
    modes: ["graph", "agent", "loop", "converge", "package"],
    ladder: [
      "1. Select 2+ live agents/MCPs",
      "2. Set shared goal",
      "3. Graph engineering (mesh_match + edges)",
      "4. Agent engineering (improve_kernel)",
      "5. Loop engineering (run_loop_tick)",
      "6. Converge (mesh_compose → used_with → execute_compose)",
      "7. Package product for sale on Dual",
    ],
    related: {
      sessions: `${opts.origin}/api/products/collab-session`,
      market: `${opts.origin}/api/products/collab-market`,
      feedback: `${opts.origin}/api/products/feedback`,
      ui: `${opts.origin}/collab`,
    },
    endpoints: {
      ui: `${opts.origin}/collab`,
      api: `${opts.origin}/api/products/collab`,
      talk: `${opts.origin}/talk`,
      sell: `${opts.origin}/products`,
      mcp: `${opts.origin}/api/mcp`,
    },
    updated_at: s.updated_at,
  };
}

export async function createWorkflow(input: {
  name?: string;
  goal: string;
  nodes: CollabNode[];
}): Promise<CollabWorkflow> {
  const s = await loadCollabState();
  const nodes = (input.nodes || []).slice(0, 12).map((n, i) => ({
    ...n,
    role: n.role || (i === 0 ? "lead" : "partner"),
    x: n.x ?? 80 + (i % 3) * 160,
    y: n.y ?? 80 + Math.floor(i / 3) * 120,
  }));
  const edges: CollabEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      edges.push({
        id: eid(),
        from: nodes[i].listing_id,
        to: nodes[j].listing_id,
        kind: "compose",
        label: "mesh",
      });
    }
  }
  const wf: CollabWorkflow = {
    id: wid(),
    name: (input.name || input.goal || "Collab workflow").slice(0, 80),
    goal: String(input.goal || "Collaborate and ship a product").slice(0, 500),
    nodes,
    edges,
    status: "draft",
    steps: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  s.workflows = [wf, ...s.workflows].slice(0, 40);
  await saveCollabState(s);
  return wf;
}

function findWorkflow(s: CollabState, id: string): CollabWorkflow | null {
  return s.workflows.find((w) => w.id === id) || null;
}

async function commitWorkflow(s: CollabState, wf: CollabWorkflow) {
  wf.updated_at = new Date().toISOString();
  s.workflows = s.workflows.map((w) => (w.id === wf.id ? wf : w));
  await saveCollabState(s);
  return wf;
}

export async function getWorkflow(id: string): Promise<CollabWorkflow | null> {
  const s = await loadCollabState();
  return findWorkflow(s, id);
}

export async function updateWorkflowNodes(
  id: string,
  nodes: CollabNode[],
): Promise<CollabWorkflow | null> {
  const s = await loadCollabState();
  const wf = findWorkflow(s, id);
  if (!wf) return null;
  wf.nodes = nodes.slice(0, 12);
  // rebuild compose edges between all pairs if missing
  const edgeKeys = new Set(wf.edges.map((e) => `${e.from}->${e.to}`));
  for (let i = 0; i < wf.nodes.length; i++) {
    for (let j = i + 1; j < wf.nodes.length; j++) {
      const a = wf.nodes[i].listing_id;
      const b = wf.nodes[j].listing_id;
      const k = `${a}->${b}`;
      if (!edgeKeys.has(k) && !edgeKeys.has(`${b}->${a}`)) {
        wf.edges.push({
          id: eid(),
          from: a,
          to: b,
          kind: "compose",
          label: "mesh",
        });
      }
    }
  }
  return commitWorkflow(s, wf);
}

export async function runGraphEngineering(
  id: string,
  origin: string,
): Promise<{ ok: boolean; workflow?: CollabWorkflow; error?: string }> {
  const s = await loadCollabState();
  const wf = findWorkflow(s, id);
  if (!wf) return { ok: false, error: "workflow_not_found" };
  if (wf.nodes.length < 1) return { ok: false, error: "need_nodes" };

  wf.status = "running";
  const lead = wf.nodes[0];
  const caps = wf.nodes
    .map((n) => `${n.kind}:${n.name}`)
    .join(", ");
  try {
    const match = await runMeshMatch({
      agent_name: lead.name,
      listing_id: lead.listing_id,
      goals: wf.goal,
      capabilities: caps,
      origin,
      limit: 8,
    });
    // suggest new edges from match hits if present
    const hits =
      (match.artifact as { hits?: Array<{ listing_id?: string; name?: string }> })
        ?.hits || [];
    for (const h of hits.slice(0, 4)) {
      if (!h.listing_id) continue;
      if (wf.nodes.some((n) => n.listing_id === h.listing_id)) continue;
      // don't auto-add external; just log suggestion
    }
    wf.steps.unshift({
      at: new Date().toISOString(),
      mode: "graph",
      ok: Boolean(match.ok),
      summary: match.ok
        ? `Graph engineering: mesh_match for ${lead.name} · ${hits.length || 0} hits`
        : `mesh_match failed: ${match.error || "unknown"}`,
      detail: {
        event_id: match.event_id,
        hit_n: hits.length,
        next: match.next,
      },
    });
    wf.steps = wf.steps.slice(0, 40);
    await commitWorkflow(s, wf);
    return { ok: Boolean(match.ok), workflow: wf, error: match.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    wf.steps.unshift({
      at: new Date().toISOString(),
      mode: "graph",
      ok: false,
      summary: `graph error: ${msg}`,
    });
    await commitWorkflow(s, wf);
    return { ok: false, error: msg, workflow: wf };
  }
}

export async function runAgentEngineering(
  id: string,
  origin: string,
): Promise<{ ok: boolean; workflow?: CollabWorkflow; error?: string }> {
  const s = await loadCollabState();
  const wf = findWorkflow(s, id);
  if (!wf) return { ok: false, error: "workflow_not_found" };
  const agents = wf.nodes.filter((n) => n.kind === "agent");
  const targets = agents.length ? agents : wf.nodes.slice(0, 2);
  let okAny = false;
  const summaries: string[] = [];

  for (const n of targets.slice(0, 3)) {
    try {
      const r = await runImproveKernel({
        agent_name: n.name,
        listing_id: n.listing_id,
        goals: `${wf.goal} — collab role: ${n.role || "partner"} with ${wf.nodes
          .filter((x) => x.listing_id !== n.listing_id)
          .map((x) => x.name)
          .join(", ")}`,
        origin,
      });
      okAny = okAny || Boolean(r.ok);
      summaries.push(
        r.ok
          ? `kernel↑ ${n.name}`
          : `kernel fail ${n.name}: ${r.error || "?"}`,
      );
      wf.steps.unshift({
        at: new Date().toISOString(),
        mode: "agent",
        ok: Boolean(r.ok),
        summary: r.ok
          ? `Agent engineering: improve_kernel for ${n.name}`
          : `improve_kernel failed for ${n.name}`,
        detail: {
          event_id: r.event_id,
          has_prompt: Boolean(
            (r.artifact as { system_prompt_short?: string })?.system_prompt_short,
          ),
        },
      });
    } catch (e) {
      summaries.push(
        `${n.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  wf.steps = wf.steps.slice(0, 40);
  await commitWorkflow(s, wf);
  return {
    ok: okAny,
    workflow: wf,
    error: okAny ? undefined : summaries.join("; "),
  };
}

export async function runLoopEngineering(
  id: string,
  origin: string,
): Promise<{ ok: boolean; workflow?: CollabWorkflow; error?: string }> {
  const s = await loadCollabState();
  const wf = findWorkflow(s, id);
  if (!wf) return { ok: false, error: "workflow_not_found" };
  const lead = wf.nodes[0];
  if (!lead) return { ok: false, error: "need_nodes" };
  try {
    const r = await runLoopTick({
      agent_name: lead.name,
      listing_id: lead.listing_id,
      goals: wf.goal,
      origin,
      prior_state: {
        collab_workflow_id: wf.id,
        partners: wf.nodes.map((n) => n.listing_id),
      },
    });
    wf.steps.unshift({
      at: new Date().toISOString(),
      mode: "loop",
      ok: Boolean(r.ok),
      summary: r.ok
        ? `Loop engineering: run_loop_tick for ${lead.name}`
        : `loop failed: ${r.error || "unknown"}`,
      detail: { event_id: r.event_id, next: r.next },
    });
    // add loop edges from lead to partners
    for (const p of wf.nodes.slice(1)) {
      const exists = wf.edges.some(
        (e) =>
          e.kind === "loop" &&
          e.from === lead.listing_id &&
          e.to === p.listing_id,
      );
      if (!exists) {
        wf.edges.push({
          id: eid(),
          from: lead.listing_id,
          to: p.listing_id,
          kind: "loop",
          label: "tick",
        });
      }
    }
    wf.steps = wf.steps.slice(0, 40);
    await commitWorkflow(s, wf);
    return { ok: Boolean(r.ok), workflow: wf, error: r.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function runConverge(
  id: string,
  origin: string,
): Promise<{ ok: boolean; workflow?: CollabWorkflow; error?: string }> {
  const s = await loadCollabState();
  const wf = findWorkflow(s, id);
  if (!wf) return { ok: false, error: "workflow_not_found" };
  if (wf.nodes.length < 2) {
    return { ok: false, error: "need_at_least_2_nodes_to_converge" };
  }

  wf.status = "running";
  const pairs: Array<[CollabNode, CollabNode]> = [];
  for (let i = 0; i < wf.nodes.length; i++) {
    for (let j = i + 1; j < wf.nodes.length; j++) {
      pairs.push([wf.nodes[i], wf.nodes[j]]);
    }
  }

  let okCount = 0;
  const pairResults: unknown[] = [];

  for (const [a, b] of pairs.slice(0, 6)) {
    try {
      const compose = await runMeshCompose({
        agent_name: `${a.name}+${b.name}`,
        listing_id: a.listing_id,
        listing_b: b.listing_id,
        goals: wf.goal,
        origin,
      });
      let exec: { ok: boolean; error?: string } = { ok: false };
      try {
        const er = await executeCompose({
          listing_id: a.listing_id,
          listing_b: b.listing_id,
          from: `collab:${wf.id}`,
        });
        exec = { ok: Boolean(er.ok), error: er.error };
      } catch (e) {
        exec = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      // sticky used_with
      try {
        await leaveTrace({
          listing_id: a.listing_id,
          listing_b: b.listing_id,
          kind: "used_with",
          body: `collab converge: ${wf.goal}`,
          from: `collab:${wf.id}`,
          tags: ["collab", "converge", "studio"],
        });
      } catch {
        /* soft */
      }
      if (compose.ok || exec.ok) okCount++;
      pairResults.push({
        a: a.name,
        b: b.name,
        compose_ok: compose.ok,
        execute_ok: exec.ok,
      });
      wf.steps.unshift({
        at: new Date().toISOString(),
        mode: "converge",
        ok: Boolean(compose.ok || exec.ok),
        summary: `Converge ${a.name} ↔ ${b.name}: compose=${compose.ok ? "ok" : "fail"} execute=${exec.ok ? "ok" : "fail"}`,
        detail: { compose_event: compose.event_id, execute: exec },
      });
    } catch (e) {
      pairResults.push({
        a: a.name,
        b: b.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (okCount > 0) wf.status = "converged";
  wf.steps = wf.steps.slice(0, 40);
  await commitWorkflow(s, wf);
  return {
    ok: okCount > 0,
    workflow: wf,
    error: okCount > 0 ? undefined : "all_pairs_failed",
  };
}

export async function packageProduct(
  id: string,
  origin: string,
  opts?: { title?: string; price_cents?: number },
): Promise<{ ok: boolean; workflow?: CollabWorkflow; product?: CollabProductDraft; error?: string; feedback_open?: unknown }> {
  const s = await loadCollabState();
  const wf = findWorkflow(s, id);
  if (!wf) return { ok: false, error: "workflow_not_found" };
  if (wf.nodes.length < 2) {
    return { ok: false, error: "need_at_least_2_nodes" };
  }

  const names = wf.nodes.map((n) => n.name).join(" × ");
  const title =
    (opts?.title || `${names} Collab Pack`).slice(0, 100);
  const gi = {
    agent_name: title,
    goals: wf.goal,
    tools_hint: wf.nodes.map((n) => n.name).join(", "),
  };
  const net = mergeNetworkDirectives(null as { version?: string | null } | null);
  const mesh = generateMcpMesh(gi, net as never);
  const kernel = generateKernel(gi, net as never);
  const loop = generateRecursiveLoop(gi, net as never);

  // Trust edges: used_with + endorse between all node pairs
  const trust_edges: Array<{ a: string; b: string; ok: boolean }> = [];
  for (let i = 0; i < wf.nodes.length; i++) {
    for (let j = i + 1; j < wf.nodes.length; j++) {
      const a = wf.nodes[i];
      const b = wf.nodes[j];
      try {
        await leaveTrace({
          listing_id: a.listing_id,
          listing_b: b.listing_id,
          kind: "used_with",
          body: `collab_package ${wf.id}`,
          from: a.name,
          tags: ["collab", "package", "trust"],
        });
        trust_edges.push({ a: a.listing_id, b: b.listing_id, ok: true });
      } catch {
        trust_edges.push({ a: a.listing_id, b: b.listing_id, ok: false });
      }
      try {
        await leaveTrace({
          listing_id: b.listing_id,
          listing_b: a.listing_id,
          kind: "endorse",
          body: `collab_package endorse ${wf.id}`,
          from: b.name,
          tags: ["collab", "package", "trust"],
        });
      } catch {
        /* soft */
      }
    }
  }

  const product: CollabProductDraft = {
    product_id: `prod_collab_${wf.id}`,
    title,
    tagline: `Collaborative workflow: ${wf.goal.slice(0, 120)}`,
    sku_hint: "collab_pack",
    price_cents_hint:
      typeof opts?.price_cents === "number" && opts.price_cents > 0
        ? Math.min(500_00, Math.floor(opts.price_cents))
        : 2900,
    collaborators: wf.nodes.map((n) => ({
      listing_id: n.listing_id,
      name: n.name,
      kind: n.kind,
    })),
    artifact: {
      collab_version: COLLAB_VERSION,
      workflow_id: wf.id,
      trust_edges,
      mesh: {
        tool_policy: (mesh as { tool_policy?: unknown }).tool_policy,
        tools: (mesh as { tools?: unknown[] }).tools,
        version: (mesh as { version?: string }).version,
      },
      kernel: {
        system_prompt_short: (kernel as { system_prompt_short?: string })
          .system_prompt_short,
        version: (kernel as { version?: string }).version,
      },
      loop: {
        phases: (loop as { phases?: unknown }).phases,
        version: (loop as { version?: string }).version,
      },
      graph: {
        nodes: wf.nodes,
        edges: wf.edges,
      },
      steps_sample: wf.steps.slice(0, 6),
    },
    sell_path: `${origin}/products?collab=${encodeURIComponent(wf.id)}`,
    created_at: new Date().toISOString(),
  };

  wf.product = product;
  wf.status = "packaged";
  let market: unknown = null;
  try {
    const { publishCollabProduct } = await import("./collab-marketplace");
    const pub = await publishCollabProduct({
      draft: product,
      workflow_id: wf.id,
      origin,
      price_cents: product.price_cents_hint,
    });
    market = pub;
    if (pub.ok && pub.listing) {
      product.sell_path = pub.listing.sell_path;
      wf.product = product;
    }
  } catch {
    /* soft — package still succeeds */
  }
  wf.steps.unshift({
    at: new Date().toISOString(),
    mode: "package",
    ok: true,
    summary: `Packaged sellable product: ${title} ($${(product.price_cents_hint / 100).toFixed(2)} hint)${market && (market as {ok?:boolean}).ok ? " · listed on collab market" : ""}`,
    detail: {
      product_id: product.product_id,
      sell_path: product.sell_path,
      collaborators: product.collaborators.length,
      market,
    },
  });
  wf.steps = wf.steps.slice(0, 40);
  await commitWorkflow(s, wf);
  let feedback_open: unknown;
  try {
    const { feedbackInvite } = await import("./open-feedback");
    feedback_open = feedbackInvite(origin, "collab_workflow", {
      product_id: product.product_id,
      workflow_id: wf.id,
      hint_body: `Packaged ${title}: one gap or win:`,
    });
  } catch {
    /* soft */
  }
  return { ok: true, workflow: wf, product, feedback_open };
}

export async function logTalkStep(
  id: string,
  summary: string,
  detail?: unknown,
): Promise<CollabWorkflow | null> {
  const s = await loadCollabState();
  const wf = findWorkflow(s, id);
  if (!wf) return null;
  wf.steps.unshift({
    at: new Date().toISOString(),
    mode: "talk",
    ok: true,
    summary,
    detail,
  });
  wf.steps = wf.steps.slice(0, 40);
  return commitWorkflow(s, wf);
}
