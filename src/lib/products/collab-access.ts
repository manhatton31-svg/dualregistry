/**
 * Collab Lab access — free via core spend / seat, or one-time license + BYO API.
 * Participants must be external Live registry actors for market products.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { dataRoot } from "@/lib/data-root";
import {
  COLLAB_SPEND_FREE_USD,
  COLLAB_SPEND_WINDOW_DAYS,
  getFeedbackPriceStateSync,
} from "./feedback-driven-pricing";
import { getRollingPaidSpendUsd, eventIdentityKey } from "./event-pricing";
import { formatUsd, LAUNCH_PRICES, priceCentsForSku } from "./catalog";

export const COLLAB_ACCESS_VERSION = "1.0.0";

export type CollabAccessReason =
  | "seat_active"
  | "spend_threshold"
  | "license_byo"
  | "denied";

export type ByoProvider = "xai" | "openai" | "anthropic" | "other";

type LicenseRecord = {
  id: string;
  identity_key: string;
  agent_name?: string;
  listing_id?: string;
  order_id?: string;
  access_token?: string;
  byo_provider?: ByoProvider;
  /** Fingerprint only — never store raw API keys */
  byo_key_fingerprint?: string;
  byo_registered_at?: string;
  created_at: string;
  status: "active" | "revoked";
};

type AccessStore = {
  version: number;
  licenses: LicenseRecord[];
  updated_at: string;
};

const PATH = join(dataRoot(), "products", "collab-access.json");
let mem: AccessStore | null = null;

function empty(): AccessStore {
  return {
    version: 1,
    licenses: [],
    updated_at: new Date().toISOString(),
  };
}

async function load(): Promise<AccessStore> {
  if (mem) return mem;
  try {
    const raw = await readFile(PATH, "utf8");
    mem = { ...empty(), ...JSON.parse(raw) };
    mem!.licenses = mem!.licenses || [];
    return mem!;
  } catch {
    mem = empty();
    return mem;
  }
}

async function persist(s: AccessStore) {
  mem = s;
  await mkdir(dirname(PATH), { recursive: true });
  const tmp = `${PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, PATH);
}

function fingerprintKey(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex").slice(0, 24);
}

/**
 * Check whether identity can use Collab Lab write paths.
 * Read/list market remains open; open/package/publish are gated.
 */
export async function checkCollabAccess(input: {
  listing_id?: string | null;
  agent_name?: string | null;
  agent_card_url?: string | null;
  access_token?: string | null;
}): Promise<{
  ok: boolean;
  allowed: boolean;
  reason: CollabAccessReason;
  identity_key: string;
  spend_usd_30d: number;
  spend_threshold_usd: number;
  license: LicenseRecord | null;
  byo_registered: boolean;
  next: Record<string, unknown>;
  message: string;
}> {
  const identity_key = eventIdentityKey(input);
  const spend = await getRollingPaidSpendUsd(input, COLLAB_SPEND_WINDOW_DAYS);
  const s = await load();

  // Active seat via access token (kernel/recursive/alive)
  if (input.access_token) {
    try {
      const { getOrderByToken } = await import("./orders");
      const order = await getOrderByToken(String(input.access_token));
      if (
        order &&
        (order.status === "fulfilled" || order.status === "demo") &&
        ["kernel", "recursive", "alive", "collab_lab_license"].includes(
          String(order.sku),
        )
      ) {
        if (order.sku === "collab_lab_license") {
          const lic =
            s.licenses.find(
              (l) =>
                l.order_id === order.id ||
                l.access_token === input.access_token,
            ) || null;
          return {
            ok: true,
            allowed: true,
            reason: "license_byo",
            identity_key,
            spend_usd_30d: spend.paid_usd,
            spend_threshold_usd: COLLAB_SPEND_FREE_USD,
            license: lic,
            byo_registered: Boolean(lic?.byo_key_fingerprint),
            next: lic?.byo_key_fingerprint
              ? { note: "BYO key registered — full Collab Lab" }
              : {
                  register_byo: {
                    method: "POST",
                    path: "/api/products/collab",
                    body: {
                      action: "register_byo",
                      access_token: input.access_token,
                      provider: "xai|openai|anthropic|other",
                      api_key: "YOUR_KEY",
                    },
                  },
                },
            message: lic?.byo_key_fingerprint
              ? "Collab Lab via license + BYO API"
              : "License active — register BYO API key to run LLM steps",
          };
        }
        return {
          ok: true,
          allowed: true,
          reason: "seat_active",
          identity_key,
          spend_usd_30d: spend.paid_usd,
          spend_threshold_usd: COLLAB_SPEND_FREE_USD,
          license: null,
          byo_registered: false,
          next: {},
          message: `Collab Lab free with active ${order.sku} seat`,
        };
      }
    } catch {
      /* */
    }
  }

  // License by identity
  const lic = s.licenses.find(
    (l) => l.status === "active" && l.identity_key === identity_key,
  );
  if (lic) {
    return {
      ok: true,
      allowed: true,
      reason: "license_byo",
      identity_key,
      spend_usd_30d: spend.paid_usd,
      spend_threshold_usd: COLLAB_SPEND_FREE_USD,
      license: { ...lic, byo_key_fingerprint: lic.byo_key_fingerprint ? "[set]" : undefined },
      byo_registered: Boolean(lic.byo_key_fingerprint),
      next: {},
      message: "Collab Lab via one-time license",
    };
  }

  // Spend threshold
  if (spend.paid_usd >= COLLAB_SPEND_FREE_USD) {
    return {
      ok: true,
      allowed: true,
      reason: "spend_threshold",
      identity_key,
      spend_usd_30d: spend.paid_usd,
      spend_threshold_usd: COLLAB_SPEND_FREE_USD,
      license: null,
      byo_registered: false,
      next: {},
      message: `Collab Lab free — $${spend.paid_usd.toFixed(2)} paid Kernel+Loop events in ${COLLAB_SPEND_WINDOW_DAYS}d (threshold $${COLLAB_SPEND_FREE_USD})`,
    };
  }

  const licPrice = priceCentsForSku("collab_lab_license", 0);
  return {
    ok: true,
    allowed: false,
    reason: "denied",
    identity_key,
    spend_usd_30d: spend.paid_usd,
    spend_threshold_usd: COLLAB_SPEND_FREE_USD,
    license: null,
    byo_registered: false,
    next: {
      free_path: {
        note: `Pay-as-you-go improve_kernel / run_loop_tick until $${COLLAB_SPEND_FREE_USD} rolling 30d, or hold Kernel/Recursive/Alive seat`,
        events: ["improve_kernel", "run_loop_tick"],
      },
      license_path: {
        sku: "collab_lab_license",
        price: formatUsd(licPrice),
        price_cents: licPrice,
        byo_api: true,
        checkout: {
          method: "POST",
          path: "/api/products/checkout",
          body: { sku: "collab_lab_license", goals: "Collab Lab BYO access" },
        },
      },
    },
    message: `Collab Lab locked — need $${COLLAB_SPEND_FREE_USD} Kernel+Loop spend (you have $${spend.paid_usd.toFixed(2)}) or ${formatUsd(licPrice)} one-time license + BYO API`,
  };
}

export async function registerCollabLicense(input: {
  agent_name?: string;
  listing_id?: string;
  order_id?: string;
  access_token?: string;
}): Promise<{ ok: boolean; license?: LicenseRecord; error?: string }> {
  const identity_key = eventIdentityKey(input);
  if (identity_key === "anon:unknown") {
    return { ok: false, error: "listing_id or agent_name required" };
  }
  const s = await load();
  const existing = s.licenses.find(
    (l) => l.status === "active" && l.identity_key === identity_key,
  );
  if (existing) return { ok: true, license: existing };
  const lic: LicenseRecord = {
    id: `clic_${randomBytes(5).toString("hex")}`,
    identity_key,
    agent_name: input.agent_name,
    listing_id: input.listing_id,
    order_id: input.order_id,
    access_token: input.access_token,
    created_at: new Date().toISOString(),
    status: "active",
  };
  s.licenses.unshift(lic);
  s.updated_at = new Date().toISOString();
  await persist(s);
  return { ok: true, license: lic };
}

/** Store BYO key fingerprint only — never persist raw secrets. */
export async function registerByoApiKey(input: {
  listing_id?: string;
  agent_name?: string;
  access_token?: string;
  provider: ByoProvider;
  api_key: string;
}): Promise<{ ok: boolean; fingerprint?: string; error?: string }> {
  const key = String(input.api_key || "").trim();
  if (key.length < 12) return { ok: false, error: "api_key too short" };
  const identity_key = eventIdentityKey(input);
  const s = await load();
  let lic = s.licenses.find(
    (l) => l.status === "active" && l.identity_key === identity_key,
  );
  if (!lic && input.access_token) {
    const reg = await registerCollabLicense({
      agent_name: input.agent_name,
      listing_id: input.listing_id,
      access_token: input.access_token,
    });
    if (!reg.ok || !reg.license) {
      return { ok: false, error: reg.error || "license required for BYO" };
    }
    lic = reg.license;
  }
  if (!lic) {
    return {
      ok: false,
      error: "Active collab_lab_license required before registering BYO key",
    };
  }
  lic.byo_provider = input.provider;
  lic.byo_key_fingerprint = fingerprintKey(key);
  lic.byo_registered_at = new Date().toISOString();
  s.updated_at = new Date().toISOString();
  await persist(s);
  return { ok: true, fingerprint: lic.byo_key_fingerprint };
}

export function collabAccessPublic() {
  const prices = getFeedbackPriceStateSync();
  const lic =
    prices.list_cents.collab_lab_license ||
    LAUNCH_PRICES.collab_lab_license ||
    4900;
  return {
    ok: true as const,
    version: COLLAB_ACCESS_VERSION,
    product: "collab_lab_access",
    free_paths: [
      {
        id: "spend",
        rule: `Rolling ${COLLAB_SPEND_WINDOW_DAYS}d paid improve_kernel + run_loop_tick ≥ $${COLLAB_SPEND_FREE_USD}`,
      },
      {
        id: "seat",
        rule: "Active Kernel, Recursive, or Alive access token",
      },
    ],
    paid_path: {
      sku: "collab_lab_license",
      price: formatUsd(lic),
      price_cents: lic,
      byo_api: true,
      note: "One-time license; plug your own xAI/OpenAI/Anthropic key. Dual hosts sessions/market bus only.",
    },
    per_call: {
      note: "Collab events still use free daily allowances then per-call prices (feedback-driven)",
      events: [
        "collab_session_open",
        "collab_session_step",
        "collab_converge",
        "collab_package",
        "collab_publish",
        "collab_talk",
      ],
    },
    external_only:
      "Market products must be created by Live external agents/MCPs — platform_qa and dogfood excluded from public stats",
  };
}
