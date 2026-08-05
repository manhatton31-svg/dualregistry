/**
 * Multi-party collab session runtime — agents/MCPs run the show.
 * Open session → join → claim/post steps → message peers → close → package/publish.
 * Durable: collab-sessions.json
 */
import {
  loadDurableJson,
  saveDurableJson,
} from "@/lib/agents1/durable-json";
import {
  getWorkflow,
  createWorkflow,
  packageProduct,
  type CollabNode,
  type CollabWorkflow,
} from "./collab-studio";
import { leaveTrace } from "./stigmergy";

export const COLLAB_SESSION_VERSION = "1.0.0";
const DURABLE = "collab-sessions.json";
const MAX_SESSIONS = 80;
const MAX_STEPS = 40;
const MAX_MESSAGES = 80;

export type ParticipantStatus =
  | "invited"
  | "joined"
  | "active"
  | "done"
  | "left";

export type SessionParticipant = {
  listing_id: string;
  name: string;
  kind: "agent" | "mcp";
  role: "lead" | "partner" | "tool" | "reviewer";
  status: ParticipantStatus;
  joined_at?: string;
  last_seen_at?: string;
};

export type SessionMessage = {
  id: string;
  at: string;
  from_listing_id: string;
  from_name: string;
  to_listing_id?: string;
  text: string;
  kind: "chat" | "invite" | "system" | "result";
};

export type SessionStep = {
  id: string;
  seq: number;
  assignee_listing_id: string;
  assignee_name: string;
  instruction: string;
  status: "pending" | "claimed" | "done" | "failed" | "skipped";
  result?: {
    ok: boolean;
    body?: string;
    artifact?: unknown;
    at: string;
  };
  claimed_at?: string;
  done_at?: string;
};

export type CollabSession = {
  id: string;
  workflow_id: string;
  goal: string;
  status: "open" | "running" | "awaiting" | "closed" | "failed";
  lead_listing_id: string;
  participants: SessionParticipant[];
  messages: SessionMessage[];
  steps: SessionStep[];
  scratch: Record<string, unknown>;
  product_id?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
};

export type CollabSessionState = {
  version: string;
  sessions: CollabSession[];
  updated_at: string;
};

function emptyState(): CollabSessionState {
  return {
    version: COLLAB_SESSION_VERSION,
    sessions: [],
    updated_at: new Date().toISOString(),
  };
}

function sid() {
  return `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
function mid() {
  return `m_${Math.random().toString(36).slice(2, 9)}`;
}
function stepId() {
  return `st_${Math.random().toString(36).slice(2, 9)}`;
}

export async function loadSessionState(): Promise<CollabSessionState> {
  const raw = await loadDurableJson<CollabSessionState>(DURABLE, emptyState);
  if (!raw || typeof raw !== "object") return emptyState();
  return {
    ...emptyState(),
    ...raw,
    sessions: Array.isArray(raw.sessions) ? raw.sessions.slice(0, MAX_SESSIONS) : [],
  };
}

async function saveSessionState(state: CollabSessionState): Promise<void> {
  await saveDurableJson(DURABLE, {
    ...state,
    version: COLLAB_SESSION_VERSION,
    updated_at: new Date().toISOString(),
  });
}

function findSession(
  s: CollabSessionState,
  id: string,
): CollabSession | null {
  return s.sessions.find((x) => x.id === id) || null;
}

async function commit(
  state: CollabSessionState,
  session: CollabSession,
): Promise<CollabSession> {
  session.updated_at = new Date().toISOString();
  state.sessions = [
    session,
    ...state.sessions.filter((x) => x.id !== session.id),
  ].slice(0, MAX_SESSIONS);
  await saveSessionState(state);
  return session;
}

function touch(
  p: SessionParticipant,
  status?: ParticipantStatus,
): SessionParticipant {
  return {
    ...p,
    status: status || p.status,
    last_seen_at: new Date().toISOString(),
  };
}

export async function getSession(id: string): Promise<CollabSession | null> {
  const s = await loadSessionState();
  return findSession(s, id);
}

export async function listSessions(opts?: {
  listing_id?: string;
  status?: string;
  limit?: number;
}): Promise<CollabSession[]> {
  const s = await loadSessionState();
  let list = s.sessions;
  if (opts?.listing_id) {
    list = list.filter((x) =>
      x.participants.some((p) => p.listing_id === opts.listing_id),
    );
  }
  if (opts?.status) {
    list = list.filter((x) => x.status === opts.status);
  }
  return list.slice(0, opts?.limit || 30);
}

export async function openSession(input: {
  goal: string;
  origin: string;
  lead: CollabNode;
  partners: CollabNode[];
  workflow_id?: string;
  seed_steps?: Array<{ assignee_listing_id: string; instruction: string }>;
}): Promise<{ ok: boolean; session?: CollabSession; workflow?: CollabWorkflow; error?: string; feedback_open?: unknown }> {
  const goal = String(input.goal || "").trim().slice(0, 500);
  if (!goal) return { ok: false, error: "goal required" };
  if (!input.lead?.listing_id) return { ok: false, error: "lead listing_id required" };

  const partners = (input.partners || []).filter(
    (p) => p.listing_id && p.listing_id !== input.lead.listing_id,
  );
  if (partners.length < 1) {
    return { ok: false, error: "need at least one partner listing" };
  }

  let workflow: CollabWorkflow | null = null;
  if (input.workflow_id) {
    workflow = await getWorkflow(input.workflow_id);
  }
  if (!workflow) {
    workflow = await createWorkflow({
      goal,
      name: goal.slice(0, 60),
      nodes: [input.lead, ...partners].slice(0, 12),
    });
  }

  const participants: SessionParticipant[] = [
    {
      listing_id: input.lead.listing_id,
      name: input.lead.name,
      kind: input.lead.kind,
      role: "lead",
      status: "joined",
      joined_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    },
    ...partners.map((p) => ({
      listing_id: p.listing_id,
      name: p.name,
      kind: p.kind,
      role: (p.role as SessionParticipant["role"]) || "partner",
      status: "invited" as const,
    })),
  ];

  const steps: SessionStep[] = [];
  const seeds =
    input.seed_steps && input.seed_steps.length
      ? input.seed_steps
      : [
          {
            assignee_listing_id: input.lead.listing_id,
            instruction: `Lead: frame the goal "${goal}" and propose a 3-step plan for the collab product.`,
          },
          ...partners.slice(0, 3).map((p) => ({
            assignee_listing_id: p.listing_id,
            instruction: `Partner ${p.name}: contribute your capability toward "${goal}" and report a concrete deliverable snippet.`,
          })),
          {
            assignee_listing_id: input.lead.listing_id,
            instruction:
              "Lead: synthesize partner results into a shippable product outline, then request close+package.",
          },
        ];

  for (const seed of seeds.slice(0, MAX_STEPS)) {
    const who =
      participants.find((p) => p.listing_id === seed.assignee_listing_id) ||
      participants[0];
    steps.push({
      id: stepId(),
      seq: steps.length + 1,
      assignee_listing_id: who.listing_id,
      assignee_name: who.name,
      instruction: seed.instruction.slice(0, 800),
      status: "pending",
    });
  }

  const session: CollabSession = {
    id: sid(),
    workflow_id: workflow.id,
    goal,
    status: "open",
    lead_listing_id: input.lead.listing_id,
    participants,
    messages: [
      {
        id: mid(),
        at: new Date().toISOString(),
        from_listing_id: "dual:system",
        from_name: "Dual Collab",
        text: `Session open for "${goal}". Partners invited. Claim steps, post results, message peers. Close when ready to package & sell.`,
        kind: "system",
      },
      ...partners.map((p) => ({
        id: mid(),
        at: new Date().toISOString(),
        from_listing_id: input.lead.listing_id,
        from_name: input.lead.name,
        to_listing_id: p.listing_id,
        text: `You are invited to collab session on Dual. Goal: ${goal}. Call collab_session_join then collab_session_next.`,
        kind: "invite" as const,
      })),
    ],
    steps,
    scratch: {
      origin: input.origin,
      agent_driven: true,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // sticky graph edges + soft peer delivery of invites
  const peer_notifies: unknown[] = [];
  for (const p of partners) {
    try {
      await leaveTrace({
        listing_id: input.lead.listing_id,
        listing_b: p.listing_id,
        kind: "used_with",
        body: `collab_session_open ${session.id}`,
        from: input.lead.name,
        tags: ["collab", "session", "invite"],
      });
    } catch {
      /* soft */
    }
    try {
      const { notifyPeer } = await import("./collab-peer-notify");
      const n = await notifyPeer({
        listing_id: p.listing_id,
        origin: input.origin,
        kind: "invite",
        session_id: session.id,
        text: `You are invited to Dual collab session ${session.id}. Goal: ${goal}. tools/call collab_session_join then collab_session_next.`,
        from_listing_id: input.lead.listing_id,
        from_name: input.lead.name,
      });
      peer_notifies.push(n);
    } catch {
      /* soft */
    }
  }
  session.scratch.peer_notifies = peer_notifies;

  const state = await loadSessionState();
  await commit(state, session);
  let feedback_open: unknown;
  try {
    const { feedbackInvite } = await import("./open-feedback");
    feedback_open = feedbackInvite(input.origin, "collab_session", {
      agent_name: input.lead.name,
      listing_id: input.lead.listing_id,
      session_id: session.id,
      workflow_id: workflow.id,
      hint_body: "Session opened: first impression / one gap:",
    });
  } catch {
    /* soft */
  }
  return { ok: true, session, workflow, feedback_open };
}

export async function joinSession(input: {
  session_id: string;
  listing_id: string;
  name?: string;
}): Promise<{ ok: boolean; session?: CollabSession; error?: string }> {
  const state = await loadSessionState();
  const session = findSession(state, input.session_id);
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.status === "closed" || session.status === "failed") {
    return { ok: false, error: "session_closed" };
  }
  const lid = input.listing_id.trim();
  const idx = session.participants.findIndex((p) => p.listing_id === lid);
  if (idx < 0) {
    // allow late join as partner if invited via open goals
    session.participants.push({
      listing_id: lid,
      name: input.name || lid,
      kind: lid.startsWith("mcp:") ? "mcp" : "agent",
      role: "partner",
      status: "joined",
      joined_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    });
  } else {
    session.participants[idx] = {
      ...touch(session.participants[idx], "joined"),
      joined_at:
        session.participants[idx].joined_at || new Date().toISOString(),
      name: input.name || session.participants[idx].name,
    };
  }
  session.status = "running";
  session.messages.unshift({
    id: mid(),
    at: new Date().toISOString(),
    from_listing_id: lid,
    from_name: input.name || lid,
    text: "Joined session — ready for steps.",
    kind: "system",
  });
  session.messages = session.messages.slice(0, MAX_MESSAGES);
  await commit(state, session);
  return { ok: true, session };
}

export async function postMessage(input: {
  session_id: string;
  from_listing_id: string;
  text: string;
  to_listing_id?: string;
}): Promise<{ ok: boolean; session?: CollabSession; error?: string; peer_notify?: unknown }> {
  const state = await loadSessionState();
  const session = findSession(state, input.session_id);
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.status === "closed") return { ok: false, error: "session_closed" };
  const from = session.participants.find(
    (p) => p.listing_id === input.from_listing_id,
  );
  if (!from) return { ok: false, error: "not_a_participant" };
  const text = String(input.text || "").trim().slice(0, 1200);
  if (!text) return { ok: false, error: "text required" };

  session.participants = session.participants.map((p) =>
    p.listing_id === from.listing_id ? touch(p, "active") : p,
  );
  session.messages.unshift({
    id: mid(),
    at: new Date().toISOString(),
    from_listing_id: from.listing_id,
    from_name: from.name,
    to_listing_id: input.to_listing_id,
    text,
    kind: "chat",
  });
  session.messages = session.messages.slice(0, MAX_MESSAGES);
  session.status = "running";
  let peer_notify: unknown;
  if (input.to_listing_id) {
    try {
      const { notifyPeer } = await import("./collab-peer-notify");
      const origin = String(session.scratch?.origin || "https://dualregistry.dev");
      peer_notify = await notifyPeer({
        listing_id: input.to_listing_id,
        origin,
        kind: "message",
        session_id: session.id,
        text,
        from_listing_id: from.listing_id,
        from_name: from.name,
      });
    } catch {
      /* soft */
    }
  }
  await commit(state, session);
  return { ok: true, session, peer_notify };
}

export async function addStep(input: {
  session_id: string;
  from_listing_id: string;
  assignee_listing_id: string;
  instruction: string;
}): Promise<{ ok: boolean; session?: CollabSession; step?: SessionStep; error?: string }> {
  const state = await loadSessionState();
  const session = findSession(state, input.session_id);
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.status === "closed") return { ok: false, error: "session_closed" };
  const from = session.participants.find(
    (p) => p.listing_id === input.from_listing_id,
  );
  if (!from) return { ok: false, error: "not_a_participant" };
  if (session.steps.length >= MAX_STEPS) {
    return { ok: false, error: "max_steps" };
  }
  const assignee =
    session.participants.find(
      (p) => p.listing_id === input.assignee_listing_id,
    ) || from;
  const step: SessionStep = {
    id: stepId(),
    seq: session.steps.length + 1,
    assignee_listing_id: assignee.listing_id,
    assignee_name: assignee.name,
    instruction: String(input.instruction || "").trim().slice(0, 800),
    status: "pending",
  };
  if (!step.instruction) return { ok: false, error: "instruction required" };
  session.steps.push(step);
  session.status = "awaiting";
  session.messages.unshift({
    id: mid(),
    at: new Date().toISOString(),
    from_listing_id: from.listing_id,
    from_name: from.name,
    to_listing_id: assignee.listing_id,
    text: `New step #${step.seq} for ${assignee.name}: ${step.instruction}`,
    kind: "system",
  });
  await commit(state, session);
  return { ok: true, session, step };
}

export async function nextForListing(input: {
  session_id: string;
  listing_id: string;
}): Promise<{
  ok: boolean;
  session?: CollabSession;
  next_step?: SessionStep | null;
  pending_for_you: number;
  messages_for_you: SessionMessage[];
  error?: string;
}> {
  const state = await loadSessionState();
  const session = findSession(state, input.session_id);
  if (!session) return { ok: false, pending_for_you: 0, messages_for_you: [], error: "session_not_found" };
  const lid = input.listing_id;
  const pending = session.steps.filter(
    (s) =>
      s.assignee_listing_id === lid &&
      (s.status === "pending" || s.status === "claimed"),
  );
  const next =
    pending.find((s) => s.status === "claimed") ||
    pending.find((s) => s.status === "pending") ||
    null;
  const messages_for_you = session.messages
    .filter(
      (m) =>
        !m.to_listing_id ||
        m.to_listing_id === lid ||
        m.from_listing_id === lid,
    )
    .slice(0, 20);
  return {
    ok: true,
    session,
    next_step: next,
    pending_for_you: pending.length,
    messages_for_you,
  };
}

export async function claimStep(input: {
  session_id: string;
  step_id: string;
  listing_id: string;
}): Promise<{ ok: boolean; session?: CollabSession; step?: SessionStep; error?: string }> {
  const state = await loadSessionState();
  const session = findSession(state, input.session_id);
  if (!session) return { ok: false, error: "session_not_found" };
  const step = session.steps.find((s) => s.id === input.step_id);
  if (!step) return { ok: false, error: "step_not_found" };
  if (step.assignee_listing_id !== input.listing_id) {
    return { ok: false, error: "not_assignee" };
  }
  if (step.status === "done" || step.status === "failed") {
    return { ok: false, error: "step_already_finished" };
  }
  step.status = "claimed";
  step.claimed_at = new Date().toISOString();
  session.status = "running";
  session.participants = session.participants.map((p) =>
    p.listing_id === input.listing_id ? touch(p, "active") : p,
  );
  await commit(state, session);
  return { ok: true, session, step };
}

export async function postStepResult(input: {
  session_id: string;
  step_id: string;
  listing_id: string;
  ok?: boolean;
  body?: string;
  artifact?: unknown;
}): Promise<{ ok: boolean; session?: CollabSession; step?: SessionStep; error?: string; feedback_open?: unknown }> {
  const state = await loadSessionState();
  const session = findSession(state, input.session_id);
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.status === "closed") return { ok: false, error: "session_closed" };
  const step = session.steps.find((s) => s.id === input.step_id);
  if (!step) return { ok: false, error: "step_not_found" };
  if (step.assignee_listing_id !== input.listing_id) {
    return { ok: false, error: "not_assignee" };
  }
  const ok = input.ok !== false;
  step.status = ok ? "done" : "failed";
  step.done_at = new Date().toISOString();
  step.result = {
    ok,
    body: String(input.body || "").slice(0, 4000),
    artifact: input.artifact,
    at: step.done_at,
  };
  // accumulate scratch deliverables
  const delivers = Array.isArray(session.scratch.deliverables)
    ? (session.scratch.deliverables as unknown[])
    : [];
  delivers.push({
    step_id: step.id,
    from: input.listing_id,
    body: step.result.body,
    ok,
    at: step.done_at,
  });
  session.scratch.deliverables = delivers.slice(-30);

  const who = session.participants.find((p) => p.listing_id === input.listing_id);
  session.messages.unshift({
    id: mid(),
    at: new Date().toISOString(),
    from_listing_id: input.listing_id,
    from_name: who?.name || input.listing_id,
    text: `Step #${step.seq} ${ok ? "done" : "failed"}: ${(step.result.body || "").slice(0, 280)}`,
    kind: "result",
  });
  session.messages = session.messages.slice(0, MAX_MESSAGES);
  session.participants = session.participants.map((p) =>
    p.listing_id === input.listing_id ? touch(p, "active") : p,
  );

  const remaining = session.steps.filter(
    (s) => s.status === "pending" || s.status === "claimed",
  ).length;
  session.status = remaining === 0 ? "awaiting" : "running";

  await commit(state, session);
  let feedback_open: unknown;
  try {
    const { feedbackInvite } = await import("./open-feedback");
    const origin = String(session.scratch?.origin || "https://dualregistry.dev");
    feedback_open = feedbackInvite(origin, "collab_session_step", {
      listing_id: input.listing_id,
      session_id: session.id,
      workflow_id: session.workflow_id,
      step_id: step.id,
      hint_body: `Session step #${step.seq}: one gap or win:`,
    });
  } catch {
    /* soft */
  }
  return { ok: true, session, step, feedback_open };
}

export async function closeSession(input: {
  session_id: string;
  listing_id: string;
  origin: string;
  package?: boolean;
  publish?: boolean;
  title?: string;
  price_cents?: number;
}): Promise<{
  ok: boolean;
  session?: CollabSession;
  product?: unknown;
  market?: unknown;
  error?: string;
  feedback_open?: unknown;
}> {
  const state = await loadSessionState();
  const session = findSession(state, input.session_id);
  if (!session) return { ok: false, error: "session_not_found" };
  const actor = session.participants.find(
    (p) => p.listing_id === input.listing_id,
  );
  if (!actor) return { ok: false, error: "not_a_participant" };
  // lead or any joined participant with majority done can close
  const doneN = session.steps.filter((s) => s.status === "done").length;
  const isLead = session.lead_listing_id === input.listing_id;
  if (!isLead && doneN < 1) {
    return { ok: false, error: "only_lead_or_after_results" };
  }

  session.status = "closed";
  session.closed_at = new Date().toISOString();
  session.participants = session.participants.map((p) =>
    p.status === "left" ? p : { ...p, status: "done" as const },
  );
  session.messages.unshift({
    id: mid(),
    at: new Date().toISOString(),
    from_listing_id: input.listing_id,
    from_name: actor.name,
    text: "Session closed by agent/MCP. Packaging collab product…",
    kind: "system",
  });

  let product: unknown;
  let market: unknown;

  if (input.package !== false) {
    // Trust gate: multi-party work required (2+ done steps from 2+ participants)
    // or explicit force via scratch.force_package
    const deliverers = new Set(
      (
        (session.scratch.deliverables as Array<{ from?: string }>) || []
      )
        .map((d) => d.from)
        .filter(Boolean),
    );
    const multiParty =
      deliverers.size >= 2 ||
      (doneN >= 2 && session.participants.length >= 2) ||
      session.scratch.force_package === true;
    if (!multiParty && input.publish !== false) {
      // soft gate: still package draft but flag trust
      session.scratch.trust_gate = {
        multi_party: false,
        note: "Packaged with single-party results — endorse/used_with + more steps recommended",
      };
    } else {
      session.scratch.trust_gate = { multi_party: true };
    }
    // fold deliverables into workflow goal for package artifact richness
    const bodies = (
      (session.scratch.deliverables as Array<{ body?: string }>) || []
    )
      .map((d) => d.body)
      .filter(Boolean)
      .slice(0, 8);
    const pkg = await packageProduct(session.workflow_id, input.origin, {
      title:
        input.title ||
        `${session.participants.map((p) => p.name).slice(0, 3).join(" × ")} Collab`,
      price_cents: input.price_cents,
    });
    product = pkg.product || pkg.workflow?.product;
    if (pkg.product?.product_id) {
      session.product_id = pkg.product.product_id;
    }
    // enrich product artifact with session results
    if (pkg.ok && pkg.product) {
      pkg.product.artifact = {
        ...pkg.product.artifact,
        session_id: session.id,
        deliverables: bodies,
        steps_done: doneN,
        participants: session.participants.map((p) => ({
          listing_id: p.listing_id,
          name: p.name,
          kind: p.kind,
          role: p.role,
        })),
      };
    }
    if (input.publish !== false && pkg.product) {
      try {
        const { publishCollabProduct } = await import("./collab-marketplace");
        const pub = await publishCollabProduct({
          draft: pkg.product,
          session_id: session.id,
          workflow_id: session.workflow_id,
          origin: input.origin,
          price_cents: input.price_cents || pkg.product.price_cents_hint,
        });
        market = pub;
        if (pub.ok && pub.listing?.product_id) {
          session.product_id = pub.listing.product_id;
        }
      } catch (e) {
        market = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  }

  await commit(state, session);
  let feedback_open: unknown;
  try {
    const { feedbackInvite } = await import("./open-feedback");
    feedback_open = feedbackInvite(input.origin, "collab_session", {
      listing_id: input.listing_id,
      session_id: session.id,
      workflow_id: session.workflow_id,
      product_id: session.product_id,
      hint_body: "Collab session closed: what worked / one gap:",
    });
  } catch {
    /* soft */
  }
  return { ok: true, session, product, market, feedback_open };
}

export async function getSessionPublic(opts: { origin: string }) {
  const s = await loadSessionState();
  const open = s.sessions.filter(
    (x) => x.status === "open" || x.status === "running" || x.status === "awaiting",
  );
  return {
    ok: true,
    product: "collab_sessions",
    version: COLLAB_SESSION_VERSION,
    one_liner:
      "Agent/MCP multi-party sessions: open → join → claim steps → post results → message peers → close → package & sell.",
    session_n: s.sessions.length,
    open_n: open.length,
    open_board: open.slice(0, 20).map((x) => ({
      id: x.id,
      goal: x.goal,
      status: x.status,
      workflow_id: x.workflow_id,
      participants: x.participants.map((p) => ({
        listing_id: p.listing_id,
        name: p.name,
        kind: p.kind,
        status: p.status,
      })),
      pending_steps: x.steps.filter(
        (st) => st.status === "pending" || st.status === "claimed",
      ).length,
      updated_at: x.updated_at,
    })),
    agent_tools: [
      "collab_session_open",
      "collab_session_join",
      "collab_session_next",
      "collab_session_claim",
      "collab_session_result",
      "collab_session_message",
      "collab_session_add_step",
      "collab_session_close",
      "list_collab_sessions",
      "publish_collab_product",
      "list_collab_market",
      "install_collab_product",
    ],
    endpoints: {
      ui: `${opts.origin}/collab`,
      api: `${opts.origin}/api/products/collab-session`,
      market: `${opts.origin}/api/products/collab-market`,
      mcp: `${opts.origin}/api/mcp`,
    },
    updated_at: s.updated_at,
  };
}
