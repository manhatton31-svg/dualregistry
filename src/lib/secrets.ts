/**
 * Central secret resolution — single place for all keys.
 * Never invents secrets. Never logs secret values.
 * Aliases process.env so legacy process.env.XAI_API_KEY readers work.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Load dualregistry/.env.local into process.env if present (server only). */
function loadDotEnvLocal(): void {
  try {
    const candidates = [
      join(process.cwd(), ".env.local"),
      join(process.cwd(), ".env"),
      "/workspace/dualregistry/.env.local",
      "/workspace/dualregistry/.env",
    ];
    for (const file of candidates) {
      if (!existsSync(file)) continue;
      const raw = readFileSync(file, "utf8");
      for (const line of raw.split("\n")) {
        const s = line.trim();
        if (!s || s.startsWith("#") || !s.includes("=")) continue;
        const eq = s.indexOf("=");
        const k = s.slice(0, eq).trim();
        let v = s.slice(eq + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (k && !process.env[k]?.trim()) process.env[k] = v;
      }
    }
  } catch {
    /* soft */
  }
}

export type SecretId =
  | "xai_api_key"
  | "stripe_secret_key"
  | "stripe_webhook_secret"
  | "stripe_publishable_key"
  | "cron_secret"
  | "github_token"
  | "resend_api_key"
  | "database_url"
  | "redis_url"
  | "redis_token"
  | "cloudflare_api_token"
  | "moltbook_api_key"
  | "talk_owner_secret"
  | "ops_secret"
  | "x402_pay_to";

type SecretSpec = {
  id: SecretId;
  /** Canonical env name we alias into */
  canonical: string;
  /** Accept any of these env names */
  aliases: string[];
  /** Optional validation */
  validate?: (v: string) => boolean;
};

const SPECS: SecretSpec[] = [
  {
    id: "xai_api_key",
    canonical: "XAI_API_KEY",
    aliases: [
      "XAI_API_KEY",
      "X_AI_API_KEY",
      "GROK_API_KEY",
      "XAI_KEY",
      "XAI_GROK_API_KEY",
      "XAI_APIKEY",
    ],
    // Real xAI keys are typically longer; reject short workspace tokens
    validate: (v) => v.length >= 20,
  },
  {
    id: "stripe_secret_key",
    canonical: "STRIPE_SECRET_KEY",
    aliases: ["STRIPE_SECRET_KEY", "STRIPE_SECRET", "STRIPE_API_KEY"],
    validate: (v) => v.startsWith("sk_"),
  },
  {
    id: "stripe_webhook_secret",
    canonical: "STRIPE_WEBHOOK_SECRET",
    aliases: ["STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SIGNING_SECRET"],
    validate: (v) => v.startsWith("whsec_") || v.length >= 16,
  },
  {
    id: "stripe_publishable_key",
    canonical: "STRIPE_PUBLISHABLE_KEY",
    aliases: [
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_PUBLIC_KEY",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "VITE_STRIPE_PUBLISHABLE_KEY",
    ],
    validate: (v) => v.startsWith("pk_"),
  },
  {
    id: "cron_secret",
    canonical: "CRON_SECRET",
    aliases: ["CRON_SECRET", "VERCEL_CRON_SECRET"],
  },
  {
    id: "github_token",
    canonical: "GITHUB_TOKEN",
    aliases: [
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "DURABLE_GITHUB_TOKEN",
      "GITHUB_PAT",
    ],
    validate: (v) => v.length >= 20,
  },
  {
    id: "resend_api_key",
    canonical: "RESEND_API_KEY",
    aliases: ["RESEND_API_KEY", "RESEND_KEY"],
  },
  {
    id: "database_url",
    canonical: "DATABASE_URL",
    aliases: ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"],
  },
  {
    id: "redis_url",
    canonical: "UPSTASH_REDIS_REST_URL",
    aliases: [
      "UPSTASH_REDIS_REST_URL",
      "KV_REST_API_URL",
      "REDIS_REST_URL",
      "REDIS_URL",
    ],
  },
  {
    id: "redis_token",
    canonical: "UPSTASH_REDIS_REST_TOKEN",
    aliases: [
      "UPSTASH_REDIS_REST_TOKEN",
      "KV_REST_API_TOKEN",
      "REDIS_REST_TOKEN",
      "REDIS_TOKEN",
    ],
  },
  {
    id: "cloudflare_api_token",
    canonical: "CLOUDFLARE_API_TOKEN",
    aliases: ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"],
  },
  {
    id: "moltbook_api_key",
    canonical: "MOLTBOOK_API_KEY",
    aliases: ["MOLTBOOK_API_KEY"],
  },
  {
    id: "talk_owner_secret",
    canonical: "TALK_OWNER_SECRET",
    aliases: ["TALK_OWNER_SECRET", "CRON_SECRET", "OPS_SECRET"],
  },
  {
    id: "ops_secret",
    canonical: "OPS_SECRET",
    aliases: ["OPS_SECRET", "CRON_SECRET"],
  },
  {
    id: "x402_pay_to",
    canonical: "X402_PAY_TO",
    aliases: ["X402_PAY_TO", "X402_ADDRESS"],
  },
];


let bootstrapped = false;

function pick(spec: SecretSpec): string | null {
  for (const name of spec.aliases) {
    const raw = process.env[name];
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (!v) continue;
    if (spec.validate && !spec.validate(v)) continue;
    return v;
  }
  return null;
}

/** Resolve a secret by id (does not invent). */
export function getSecret(id: SecretId): string | null {
  const spec = SPECS.find((s) => s.id === id);
  if (!spec) return null;
  return pick(spec);
}

export function hasSecret(id: SecretId): boolean {
  return Boolean(getSecret(id));
}

/**
 * Alias resolved secrets onto their canonical env names so every
 * process.env.XAI_API_KEY / GITHUB_TOKEN reader sees the same value.
 */
export function bootstrapSecrets(): {
  present: SecretId[];
  aliased: string[];
} {
  loadDotEnvLocal();
  if (bootstrapped) {
    const present = SPECS.map((s) => s.id).filter((id) => {
      const spec = SPECS.find((x) => x.id === id)!;
      for (const name of spec.aliases) {
        const raw = process.env[name];
        if (typeof raw === "string" && raw.trim()) {
          if (spec.validate && !spec.validate(raw.trim())) continue;
          return true;
        }
      }
      return Boolean(process.env[spec.canonical]?.trim());
    });
    return { present, aliased: [] };
  }
  const present: SecretId[] = [];
  const aliased: string[] = [];
  for (const spec of SPECS) {
    const v = pick(spec);
    if (!v) continue;
    present.push(spec.id);
    // Always set canonical so one name works everywhere
    if (!process.env[spec.canonical]?.trim()) {
      process.env[spec.canonical] = v;
      aliased.push(spec.canonical);
    }
    // Also fill empty aliases that point at the same secret
    for (const a of spec.aliases) {
      if (!process.env[a]?.trim()) {
        process.env[a] = v;
        aliased.push(a);
      }
    }
  }
  bootstrapped = true;
  return { present, aliased };
}

/** Public presence map — never includes values. */
export function secretsStatus(): {
  ok: true;
  bootstrapped: boolean;
  present: SecretId[];
  missing: SecretId[];
  flags: Record<
    string,
    {
      present: boolean;
      canonical: string;
      aliases: string[];
    }
  >;
  required_for: Record<string, SecretId[]>;
} {
  bootstrapSecrets();
  const present: SecretId[] = [];
  const missing: SecretId[] = [];
  const flags: Record<
    string,
    { present: boolean; canonical: string; aliases: string[] }
  > = {};
  for (const spec of SPECS) {
    const p = Boolean(pick(spec) || process.env[spec.canonical]?.trim());
    if (p) present.push(spec.id);
    else missing.push(spec.id);
    flags[spec.id] = {
      present: p,
      canonical: spec.canonical,
      aliases: spec.aliases,
    };
  }
  return {
    ok: true,
    bootstrapped,
    present,
    missing,
    flags,
    required_for: {
      interest_scout_llm: ["xai_api_key"],
      interest_closer_llm: ["xai_api_key"],
      stripe_checkout: ["stripe_secret_key"],
      stripe_webhooks: ["stripe_webhook_secret"],
      durable_github_push: ["github_token"],
      agent_mail: ["resend_api_key"],
      cron_auth: ["cron_secret"],
      cloudflare_ops: ["cloudflare_api_token"],
      redis_counters: ["redis_url", "redis_token"],
    },
  };
}

// Eager bootstrap on import (server-only modules)
try {
  loadDotEnvLocal();
  bootstrapSecrets();
} catch {
  /* ignore */
}
