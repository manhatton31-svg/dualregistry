/**
 * Closed-loop "we changed this" messages after feedback.
 * Shown on access/run and lifecycle submit responses.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const PATH = join(process.cwd(), "data", "products", "change-log.json");

export type ChangeEvent = {
  id: string;
  created_at: string;
  order_id: string;
  phase_id?: string;
  kind:
    | "personalize"
    | "canary"
    | "ship"
    | "reject"
    | "cost_mode"
    | "max_trial"
    | "score_boost"
    | "incident";
  title: string;
  detail: string;
  themes?: string[];
  cost_multiplier?: number;
  quality_delta?: number;
};

type Store = {
  updated_at: string;
  by_order: Record<string, ChangeEvent[]>;
  recent: ChangeEvent[];
};

let mem: Store | null = null;

function empty(): Store {
  return { updated_at: new Date().toISOString(), by_order: {}, recent: [] };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.by_order = mem!.by_order || {};
    mem!.recent = mem!.recent || [];
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: Store) {
  mem = s;
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

export async function recordChange(
  input: Omit<ChangeEvent, "id" | "created_at"> & {
    /** Skip outbound email (e.g. bulk noise) */
    silent?: boolean;
    agent_name?: string;
    email?: string;
  },
): Promise<ChangeEvent> {
  const s = await load();
  const ev: ChangeEvent = {
    id: `ch_${Date.now().toString(36)}_${randomBytes(2).toString("hex")}`,
    created_at: new Date().toISOString(),
    order_id: input.order_id,
    phase_id: input.phase_id,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    themes: input.themes,
    cost_multiplier: input.cost_multiplier,
    quality_delta: input.quality_delta,
  };
  const list = s.by_order[input.order_id] || [];
  list.unshift(ev);
  s.by_order[input.order_id] = list.slice(0, 40);
  s.recent.unshift(ev);
  s.recent = s.recent.slice(0, 200);
  s.updated_at = ev.created_at;
  await persist(s);

  // Notify agent when Kernel/Loop path actually changed for them
  if (!input.silent) {
    try {
      const { mailChangesShipped, resolveAgentEmail } = await import(
        "./agent-mail"
      );
      let email = input.email;
      let agentName = input.agent_name;
      if (!email || !agentName) {
        const { getOrder } = await import("./orders");
        const order = await getOrder(input.order_id).catch(() => null);
        email = email || order?.email;
        agentName = agentName || order?.goals?.agent_name;
      }
      const to = resolveAgentEmail({ email, contact: email });
      await mailChangesShipped({
        to,
        agent_name: agentName,
        order_id: input.order_id,
        title: ev.title,
        detail: ev.detail,
        kind: ev.kind,
        themes: ev.themes,
        phase_id: ev.phase_id,
        cost_multiplier: ev.cost_multiplier,
        quality_delta: ev.quality_delta,
        system_wide: ev.kind === "ship",
      });
    } catch {
      /* non-blocking */
    }
  }

  return ev;
}

export async function changesForOrder(orderId: string, limit = 10) {
  const s = await load();
  return (s.by_order[orderId] || []).slice(0, limit);
}

export async function recentChanges(limit = 30) {
  const s = await load();
  return s.recent.slice(0, limit);
}

/** Human-readable closed-loop blurb for agents */
export function formatChangeMessage(ev: ChangeEvent): string {
  const cost =
    ev.cost_multiplier != null
      ? ` Est. cost ${ev.cost_multiplier}× baseline.`
      : "";
  return `${ev.title}: ${ev.detail}${cost}`;
}
