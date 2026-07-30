export type RegistryStatus = "approved" | "needs_review" | "rejected" | string;

export type MilestoneSide = {
  approved: number;
  target: number;
  remaining: number;
  pct: number;
  ready: boolean;
};

export type Milestones = {
  ok?: boolean;
  targets: { mcp_approved: number; agents_approved: number };
  mcp: MilestoneSide;
  agents: MilestoneSide;
  solicit_ready: boolean;
  policy?: {
    summary?: string;
    when_ready?: string;
    product_surfaces?: string[];
  };
  updated_at?: string;
};

export type FailedCheck = { id: string; detail?: string };

export type McpListing = {
  id: string;
  slug?: string;
  name: string;
  description?: string;
  repository?: string;
  website?: string;
  remote_url?: string;
  author?: string;
  status: RegistryStatus;
  safety_score?: number;
  safety_flags?: string[];
  failed_checks?: FailedCheck[];
  approved_at?: string;
  updated_at?: string;
};

export type AgentSkill = { name: string; description?: string };

export type AgentListing = {
  id: string;
  slug?: string;
  name: string;
  description?: string;
  repository?: string;
  website?: string;
  endpoint_url?: string;
  agent_card_url?: string;
  mcp_url?: string;
  framework?: string;
  protocols?: string[];
  capabilities?: string[];
  skills?: AgentSkill[];
  author?: string;
  tags?: string[];
  status: RegistryStatus;
  safety_score?: number;
  safety_flags?: string[];
  failed_checks?: FailedCheck[];
  approved_at?: string;
  updated_at?: string;
};

export type RegistryPage<T> = {
  ok?: boolean;
  service?: string;
  accepting?: boolean;
  total: number;
  status?: string;
  items: T[];
};

export type SkillCard = {
  id: string;
  name: string;
  description: string;
  category: string;
  price: { credits: number; currency?: string; description?: string };
  auth_required: boolean;
};

export type SkillsGraph = {
  protocol?: string;
  name?: string;
  description?: string;
  skills: SkillCard[];
};

export type Health = {
  ok?: boolean;
  service?: string;
  grok_configured?: boolean;
  model?: string;
  milestones?: Milestones;
  agent_registry?: { accepting_submissions?: boolean; approved?: number };
  registry?: { accepting_submissions?: boolean; approved?: number };
  discovery?: string;
  mcp?: string;
  github?: string;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type PollStatus = {
  cron?: string;
  mcp?: { last_run?: JsonValue };
  agents?: { last_run?: JsonValue };
};

export type LiveSnapshot = {
  fetchedAt: string;
  live: boolean;
  source: string;
  health: Health;
  milestones: Milestones;
  mcp: RegistryPage<McpListing>;
  agents: RegistryPage<AgentListing>;
  skills?: SkillsGraph;
  poll?: PollStatus;
  errors: string[];
  cache_mode?: "live" | "cached" | "partial";
  cache_updated_at?: string;
};

export const STORE_BASE = "https://grok-agent-store.manhatton31.workers.dev";

/** @deprecated use free-tier CF_PUT_* */
export const CF_KV_DAILY_LIMIT = 1000;
export const CF_KV_DAILY_BUDGET = CF_KV_DAILY_LIMIT - 1;
