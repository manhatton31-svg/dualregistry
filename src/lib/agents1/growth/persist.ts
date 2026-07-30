import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "@/lib/data-root";
import { loadDurableJson, saveDurableJson } from "../durable-json";
import {
  CF_PUT_SOFT,
  GROWTH_INTERVAL_MS,
  loadFreeTier,
  putRemaining,
} from "../free-tier";
import type { GrowthState, KvDailyBudget } from "./types";

const DATA_DIR = join(dataRoot(), "growth");
const STATE_PATH = join(DATA_DIR, "state.json");

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function freshKvBudget(day = utcDay()): KvDailyBudget {
  return {
    day,
    budget: CF_PUT_SOFT,
    used: 0,
    hard_stop: false,
  };
}

/** Sync legacy kv field from free-tier put budget. */
export async function syncKvFromFreeTier(
  kv?: KvDailyBudget,
): Promise<KvDailyBudget> {
  const ft = await loadFreeTier();
  return {
    day: ft.day,
    budget: ft.put.budget,
    used: ft.put.used,
    hard_stop: ft.put.hard_stop,
    hard_stop_at: ft.put.hard_stop_at,
  };
}

export function rollKvBudget(kv?: KvDailyBudget): KvDailyBudget {
  const today = utcDay();
  if (!kv || kv.day !== today) return freshKvBudget(today);
  return {
    ...kv,
    budget: CF_PUT_SOFT,
    used: Math.max(0, Math.min(kv.used, CF_PUT_SOFT)),
  };
}

function emptyState(): GrowthState {
  return {
    version: 3,
    updated_at: new Date().toISOString(),
    scheduler: {
      enabled: true,
      interval_ms: GROWTH_INTERVAL_MS,
      running: false,
    },
    kv: freshKvBudget(),
    totals: {
      discovered: 0,
      submitted: 0,
      approved: 0,
      duplicates: 0,
      deferred: 0,
      failed: 0,
    },
    candidates: [],
    runs: [],
    seen_keys: [],
  };
}

let writeChain: Promise<void> = Promise.resolve();

export async function loadState(): Promise<GrowthState> {
  try {
    let parsed = await loadDurableJson<Partial<GrowthState> & { version?: number }>(
      "growth-state.json",
      () => ({} as any),
    );
    if (!parsed || !Object.keys(parsed).length) {
      try {
        const raw = await readFile(STATE_PATH, "utf8");
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }
    if (!parsed || !Object.keys(parsed).length) {
      const e = emptyState();
      await saveState(e);
      return e;
    }
    const base = emptyState();
    const state: GrowthState = {
      ...base,
      ...parsed,
      version: 3,
      scheduler: {
        ...base.scheduler,
        ...(parsed.scheduler || {}),
        enabled: parsed.scheduler?.enabled !== false,
        interval_ms: GROWTH_INTERVAL_MS,
        running: false,
      },
      kv: await syncKvFromFreeTier(parsed.kv as KvDailyBudget | undefined),
      totals: { ...base.totals, ...(parsed.totals || {}) },
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      seen_keys: Array.isArray(parsed.seen_keys) ? parsed.seen_keys : [],
    };
    return state;
  } catch {
    return emptyState();
  }
}

export async function saveState(state: GrowthState): Promise<void> {
  const next: GrowthState = {
    ...state,
    version: 3,
    updated_at: new Date().toISOString(),
    kv: await syncKvFromFreeTier(state.kv),
  };
  writeChain = writeChain.then(async () => {
    await saveDurableJson("growth-state.json", next);
    try {
      await mkdir(dirname(STATE_PATH), { recursive: true });
      const tmp = `${STATE_PATH}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
      await rename(tmp, STATE_PATH);
    } catch {
      /* */
    }
  });
  await writeChain;
}

export function candidateKey(c: {
  kind: string;
  name?: string;
  repository?: string;
  agent_card_url?: string;
  remote_url?: string;
  website?: string;
}): string {
  return [
    c.kind,
    (c.agent_card_url || "").toLowerCase(),
    (c.remote_url || "").toLowerCase(),
    (c.repository || "").toLowerCase(),
    (c.name || "").toLowerCase().trim(),
  ]
    .filter(Boolean)
    .join("|");
}

export function kvRemaining(kv: KvDailyBudget): number {
  if (kv.hard_stop) return 0;
  return Math.max(0, kv.budget - kv.used);
}

export { STATE_PATH, DATA_DIR, putRemaining };
