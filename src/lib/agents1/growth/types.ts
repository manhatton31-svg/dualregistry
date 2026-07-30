import { CF_PUT_SOFT } from "../free-tier";

export type GrowthKind = "mcp" | "agent";
export type CandidateStatus =
  | "queued"
  | "enriched"
  | "submitted"
  | "approved"
  | "duplicate"
  | "rejected"
  | "deferred"
  | "failed";

export type GrowthCandidate = {
  id: string;
  kind: GrowthKind;
  name: string;
  description: string;
  repository?: string;
  website?: string;
  remote_url?: string;
  endpoint_url?: string;
  agent_card_url?: string;
  mcp_url?: string;
  author?: string;
  framework?: string;
  protocols?: string[];
  capabilities?: string[];
  skills?: { name: string; description?: string }[];
  source: string;
  status: CandidateStatus;
  last_error?: string;
  store_id?: string;
  store_slug?: string;
  safety_score?: number;
  attempts: number;
  discovered_at: string;
  updated_at: string;
  quality_hints?: string[];
};

export type GrowthRun = {
  id: string;
  started_at: string;
  finished_at?: string;
  discovered: number;
  submitted: number;
  approved: number;
  duplicates: number;
  deferred: number;
  failed: number;
  notes: string[];
  kv_limited?: boolean;
  budget_remaining?: number;
  puts_this_run?: number;
  gets_this_run?: number;
};

export type KvDailyBudget = {
  day: string;
  budget: number;
  used: number;
  hard_stop: boolean;
  hard_stop_at?: string;
};

export type GrowthState = {
  version: 3;
  updated_at: string;
  scheduler: {
    enabled: boolean;
    interval_ms: number;
    last_run_at?: string;
    next_run_at?: string;
    running: boolean;
  };
  kv: KvDailyBudget;
  totals: {
    discovered: number;
    submitted: number;
    approved: number;
    duplicates: number;
    deferred: number;
    failed: number;
  };
  candidates: GrowthCandidate[];
  runs: GrowthRun[];
  seen_keys: string[];
};

export type DailyOpsPublic = {
  day: string;
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
  cycles: number;
  midnight_burst_pending: boolean;
  midnight_burst_done: boolean;
  summary: string;
  notes: string[];
};

export type GrowthPublicStatus = {
  enabled: boolean;
  running: boolean;
  last_run_at?: string;
  next_run_at?: string;
  interval_ms: number;
  totals: GrowthState["totals"];
  queue_depth: number;
  recent_runs: GrowthRun[];
  recent_activity: GrowthCandidate[];
  store_milestones?: {
    mcp: number;
    agents: number;
    mcp_target: number;
    agents_target: number;
  };
  notes: string[];
  kv_limited: boolean;
  kv_budget: {
    day: string;
    budget: number;
    used: number;
    remaining: number;
    hard_stop: boolean;
    cf_hard_limit: number;
    policy: string;
  };
  free_tier?: {
    day: string;
    put: {
      budget: number;
      used: number;
      remaining: number;
      hard_stop: boolean;
      cf_limit: number;
    };
    get: {
      budget: number;
      used: number;
      remaining: number;
      hard_stop: boolean;
      cf_limit: number;
      note: string;
    };
    read_safe: boolean;
    write_safe: boolean;
    fully_throttled: boolean;
    last_live_ok_at?: string;
    safe_reason?: string;
    policy: string;
    resets_in_ms: number;
  };
  daily_ops?: DailyOpsPublic;
};

export type SubmitByUrlResult = {
  ok: boolean;
  kind?: GrowthKind;
  candidate?: GrowthCandidate;
  message: string;
  store_response_json?: string;
};

export const DEFAULT_KV_BUDGET = CF_PUT_SOFT;
