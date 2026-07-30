/**
 * Free daily ops log — put/get used, approved delta, queue depth.
 * No paid monitoring; local filesystem only.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

const PATH = join(process.cwd(), "data", "daily-ops.json");

export type DailyOpsSnapshot = {
  day: string;
  updated_at: string;
  put_used: number;
  put_budget: number;
  get_used: number;
  get_budget: number;
  mcp_approved: number;
  agents_approved: number;
  mcp_delta: number;
  agents_delta: number;
  queue_depth: number;
  discovered: number;
  submitted: number;
  approved: number;
  duplicates: number;
  cycles: number;
  notes: string[];
  /** First growth cycle of this UTC day still pending denser burst */
  midnight_burst_pending: boolean;
  midnight_burst_done: boolean;
};

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function empty(day = utcDay()): DailyOpsSnapshot {
  return {
    day,
    updated_at: new Date().toISOString(),
    put_used: 0,
    put_budget: 180, // CF_PUT_SOFT
    get_used: 0,
    get_budget: 4000,
    mcp_approved: 0,
    agents_approved: 0,
    mcp_delta: 0,
    agents_delta: 0,
    queue_depth: 0,
    discovered: 0,
    submitted: 0,
    approved: 0,
    duplicates: 0,
    cycles: 0,
    notes: [],
    midnight_burst_pending: true,
    midnight_burst_done: false,
  };
}

let mem: DailyOpsSnapshot | null = null;
let chain: Promise<void> = Promise.resolve();

export async function loadDailyOps(): Promise<DailyOpsSnapshot> {
  if (mem && mem.day === utcDay()) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    const p = JSON.parse(raw) as DailyOpsSnapshot;
    if (p.day !== utcDay()) {
      mem = empty();
      // Carry forward baseline approved so delta is meaningful
      mem.mcp_approved = p.mcp_approved || 0;
      mem.agents_approved = p.agents_approved || 0;
      await persist(mem);
      return mem;
    }
    mem = { ...empty(p.day), ...p };
    return mem;
  } catch {
    mem = empty();
    await persist(mem);
    return mem;
  }
}

async function persist(s: DailyOpsSnapshot) {
  mem = s;
  chain = chain.then(async () => {
    await mkdir(dirname(PATH), { recursive: true });
    const tmp = `${PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
    await rename(tmp, PATH);
  });
  await chain;
}

export async function recordCycleOps(input: {
  put_used: number;
  put_budget: number;
  get_used: number;
  get_budget: number;
  mcp_approved: number;
  agents_approved: number;
  queue_depth: number;
  discovered: number;
  submitted: number;
  approved: number;
  duplicates: number;
  note?: string;
  midnight_burst_done?: boolean;
}): Promise<DailyOpsSnapshot> {
  const s = await loadDailyOps();
  const prevMcp = s.mcp_approved;
  const prevAgents = s.agents_approved;
  s.put_used = input.put_used;
  s.put_budget = input.put_budget;
  s.get_used = input.get_used;
  s.get_budget = input.get_budget;
  s.mcp_delta += Math.max(0, input.mcp_approved - prevMcp);
  s.agents_delta += Math.max(0, input.agents_approved - prevAgents);
  s.mcp_approved = Math.max(s.mcp_approved, input.mcp_approved);
  s.agents_approved = Math.max(s.agents_approved, input.agents_approved);
  s.queue_depth = input.queue_depth;
  s.discovered += input.discovered;
  s.submitted += input.submitted;
  s.approved += input.approved;
  s.duplicates += input.duplicates;
  s.cycles += 1;
  if (input.midnight_burst_done) {
    s.midnight_burst_done = true;
    s.midnight_burst_pending = false;
  }
  if (input.note) {
    s.notes = [input.note, ...s.notes].slice(0, 40);
  }
  s.updated_at = new Date().toISOString();
  // One-line daily summary always first
  const summary = `Day ${s.day}: put ${s.put_used}/${s.put_budget} · get ${s.get_used}/${s.get_budget} · +${s.agents_delta} agents / +${s.mcp_delta} mcp · queue ${s.queue_depth} · cycles ${s.cycles}`;
  s.notes = [summary, ...s.notes.filter((n) => !n.startsWith("Day "))].slice(
    0,
    40,
  );
  await persist(s);
  return s;
}

export function shouldDoMidnightBurst(s: DailyOpsSnapshot): boolean {
  return s.midnight_burst_pending && !s.midnight_burst_done;
}

export async function markMidnightBurstDone(): Promise<void> {
  const s = await loadDailyOps();
  s.midnight_burst_done = true;
  s.midnight_burst_pending = false;
  s.updated_at = new Date().toISOString();
  await persist(s);
}
