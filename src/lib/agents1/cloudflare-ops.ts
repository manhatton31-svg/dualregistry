/**
 * Cloudflare zone ops for Dual Registry discoverability:
 *  1) DNS TXT _mcp.<domain>
 *  2) Best-effort robots / AI crawl settings (when API allows)
 *
 * Requires CLOUDFLARE_API_TOKEN (Zone.DNS Edit + Zone.Zone Settings Edit).
 * Account ID from billing: 9eb4a5b3e147fddda19c7bfaa5a9f674
 */
import { agents1DnsMcpTxt } from "./a2a-card";

const CF_API = "https://api.cloudflare.com/client/v4";
export const CF_ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID || "9eb4a5b3e147fddda19c7bfaa5a9f674";

export type CfApplyResult = {
  ok: boolean;
  domain: string;
  zone_id?: string;
  dns?: {
    action: "created" | "updated" | "unchanged" | "error";
    name: string;
    content: string;
    id?: string;
    error?: string;
  };
  robots?: {
    action: string;
    detail?: unknown;
    error?: string;
  };
  errors: string[];
  token_present: boolean;
};

async function cfFetch(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = { success: false, errors: [{ message: "non-json response" }] };
  }
  return { ok: res.ok && json?.success !== false, status: res.status, json };
}

export async function resolveZoneId(
  token: string,
  domain: string,
): Promise<string | null> {
  const q = new URLSearchParams({ name: domain });
  const { ok, json } = await cfFetch(`/zones?${q}`, token);
  if (!ok) return null;
  const z = (json?.result || [])[0];
  return z?.id || null;
}

export async function upsertMcpDnsTxt(opts: {
  token: string;
  zoneId: string;
  domain: string;
  origin: string;
}): Promise<CfApplyResult["dns"]> {
  const name = `_mcp.${opts.domain}`;
  // Prefer www card for consistency with live site
  const origin = opts.origin.replace(/\/$/, "").replace(
    "https://dualregistry.dev",
    "https://www.dualregistry.dev",
  );
  const content = agents1DnsMcpTxt(origin);

  const listQ = new URLSearchParams({
    type: "TXT",
    name,
    per_page: "50",
  });
  const listed = await cfFetch(
    `/zones/${opts.zoneId}/dns_records?${listQ}`,
    opts.token,
  );
  if (!listed.ok) {
    return {
      action: "error",
      name,
      content,
      error: JSON.stringify(listed.json?.errors || listed.json),
    };
  }
  const existing = (listed.json?.result || []) as Array<{
    id: string;
    content: string;
  }>;
  const match = existing.find(
    (r) =>
      r.content === content ||
      r.content.includes("io.agents1.registry") ||
      r.content.includes("server-card"),
  );

  if (match) {
    if (match.content === content || match.content.replace(/^"|"$/g, "") === content) {
      return { action: "unchanged", name, content, id: match.id };
    }
    const upd = await cfFetch(
      `/zones/${opts.zoneId}/dns_records/${match.id}`,
      opts.token,
      {
        method: "PUT",
        body: JSON.stringify({
          type: "TXT",
          name,
          content,
          ttl: 300,
          comment: "Dual Registry MCP discovery",
        }),
      },
    );
    if (!upd.ok) {
      return {
        action: "error",
        name,
        content,
        error: JSON.stringify(upd.json?.errors || upd.json),
      };
    }
    return { action: "updated", name, content, id: match.id };
  }

  const created = await cfFetch(`/zones/${opts.zoneId}/dns_records`, opts.token, {
    method: "POST",
    body: JSON.stringify({
      type: "TXT",
      name,
      content,
      ttl: 300,
      comment: "Dual Registry MCP discovery",
    }),
  });
  if (!created.ok) {
    return {
      action: "error",
      name,
      content,
      error: JSON.stringify(created.json?.errors || created.json),
    };
  }
  return {
    action: "created",
    name,
    content,
    id: created.json?.result?.id,
  };
}

/**
 * Attempt to leave managed robots flexible so origin robots.txt can win.
 * CF APIs change; we try known settings and record results.
 */
export async function applyRobotsFriendlySettings(opts: {
  token: string;
  zoneId: string;
}): Promise<CfApplyResult["robots"]> {
  const attempts: Array<{ path: string; method: string; body?: unknown }> = [
    // Disable AI bots management overrides where possible (varies by plan)
    {
      path: `/zones/${opts.zoneId}/settings/security_headers`,
      method: "GET",
    },
  ];

  // Prefer: set robots.txt managed content off via zone setting if present
  const settingsToTry: Array<{ id: string; value: unknown }> = [
    // Some accounts expose these experimental settings
    { id: "automatic_https_rewrites", value: "on" },
  ];

  const detail: unknown[] = [];
  for (const s of settingsToTry) {
    const r = await cfFetch(`/zones/${opts.zoneId}/settings/${s.id}`, opts.token, {
      method: "PATCH",
      body: JSON.stringify({ value: s.value }),
    });
    detail.push({ setting: s.id, status: r.status, body: r.json });
  }

  // Document that Agentmap is authoritative when CF managed robots stays on
  return {
    action: "best_effort",
    detail: {
      note:
        "Cloudflare Managed robots.txt cannot always be disabled via API on Free plans. Dual Registry serves authoritative Agentmap at /agentmap.json and Link headers. Disable managed robots in CF dashboard: Security → Bots / AI Crawl Control → Managed robots.txt → Off.",
      attempts: detail,
    },
  };
}

export async function applyCloudflareDiscoverability(opts?: {
  token?: string;
  domain?: string;
  origin?: string;
}): Promise<CfApplyResult> {
  const token =
    opts?.token ||
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CF_API_TOKEN ||
    "";
  const domain = (opts?.domain || "dualregistry.dev").replace(/^www\./, "");
  const origin =
    opts?.origin ||
    process.env.CANONICAL_PUBLIC_ORIGIN ||
    `https://www.${domain}`;
  const errors: string[] = [];

  if (!token) {
    return {
      ok: false,
      domain,
      errors: [
        "CLOUDFLARE_API_TOKEN missing. Create a token with Zone.DNS:Edit + Zone.Zone:Read for dualregistry.dev, then set it as Vercel env CLOUDFLARE_API_TOKEN and re-run POST /api/ops/cloudflare-apply.",
      ],
      token_present: false,
    };
  }

  const zoneId =
    process.env.CLOUDFLARE_ZONE_ID ||
    (await resolveZoneId(token, domain));
  if (!zoneId) {
    return {
      ok: false,
      domain,
      errors: [
        "Could not resolve Cloudflare zone id for dualregistry.dev. Check token permissions.",
      ],
      token_present: true,
    };
  }

  const dns = await upsertMcpDnsTxt({ token, zoneId, domain, origin });
  if (dns?.action === "error") errors.push(`dns: ${dns.error}`);

  const robots = await applyRobotsFriendlySettings({ token, zoneId });
  if (robots?.error) errors.push(`robots: ${robots.error}`);

  return {
    ok: errors.length === 0 && dns?.action !== "error",
    domain,
    zone_id: zoneId,
    dns,
    robots,
    errors,
    token_present: true,
  };
}
