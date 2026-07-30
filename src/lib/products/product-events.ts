/**
 * Soft product telemetry — no PII. Links behavior to themes.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

const PATH = join(process.cwd(), "data", "products", "product-events.json");

export type ProductEventType =
  | "access"
  | "export_skills"
  | "load_short_prompt"
  | "tick_complete"
  | "demo_start"
  | "feedback_submit"
  | "preference_pair"
  | "post_ship_probe";

export type ProductEvent = {
  at: string;
  type: ProductEventType;
  order_id?: string;
  sku?: string;
  artifact?: string;
  audience?: string;
  meta?: Record<string, unknown>;
};

type Store = {
  updated_at: string;
  events: ProductEvent[];
  by_order: Record<
    string,
    {
      export_skills: number;
      access: number;
      load_short_prompt: number;
      tick_complete: number;
      last_at?: string;
    }
  >;
};

let mem: Store | null = null;

function empty(): Store {
  return { updated_at: new Date().toISOString(), events: [], by_order: {} };
}

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.events = mem!.events || [];
    mem!.by_order = mem!.by_order || {};
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

export async function trackProductEvent(
  type: ProductEventType,
  opts?: {
    order_id?: string;
    sku?: string;
    artifact?: string;
    audience?: string;
    meta?: Record<string, unknown>;
  },
) {
  const s = await load();
  const ev: ProductEvent = {
    at: new Date().toISOString(),
    type,
    order_id: opts?.order_id,
    sku: opts?.sku,
    artifact: opts?.artifact,
    audience: opts?.audience,
    meta: opts?.meta,
  };
  s.events.unshift(ev);
  s.events = s.events.slice(0, 5000);
  if (opts?.order_id) {
    const o = s.by_order[opts.order_id] || {
      export_skills: 0,
      access: 0,
      load_short_prompt: 0,
      tick_complete: 0,
    };
    if (type === "export_skills") o.export_skills++;
    if (type === "access") o.access++;
    if (type === "load_short_prompt") o.load_short_prompt++;
    if (type === "tick_complete") o.tick_complete++;
    o.last_at = ev.at;
    s.by_order[opts.order_id] = o;
  }
  s.updated_at = ev.at;
  await persist(s);
  return ev;
}

export async function getBehavioralInsights() {
  const s = await load();
  const demosWithAccess = Object.values(s.by_order).filter((o) => o.access > 0);
  const exports = demosWithAccess.filter((o) => o.export_skills > 0);
  const shortLoads = demosWithAccess.filter((o) => o.load_short_prompt > 0);
  const ticks = demosWithAccess.filter((o) => o.tick_complete > 0);
  const export_rate =
    demosWithAccess.length > 0
      ? Math.round((exports.length / demosWithAccess.length) * 1000) / 10
      : null;
  const short_rate =
    demosWithAccess.length > 0
      ? Math.round((shortLoads.length / demosWithAccess.length) * 1000) / 10
      : null;
  const themes_hot: string[] = [];
  if (export_rate != null && export_rate < 20)
    themes_hot.push("skill_export");
  if (short_rate != null && short_rate < 30)
    themes_hot.push("prompt_length");
  if (ticks.length < demosWithAccess.length * 0.2)
    themes_hot.push("loop_reliability");

  return {
    orders_tracked: Object.keys(s.by_order).length,
    access_events: s.events.filter((e) => e.type === "access").length,
    export_events: s.events.filter((e) => e.type === "export_skills").length,
    export_rate_pct: export_rate,
    short_prompt_load_rate_pct: short_rate,
    tick_complete_orders: ticks.length,
    themes_escalated_by_behavior: themes_hot,
    recent: s.events.slice(0, 15),
    updated_at: s.updated_at,
  };
}
