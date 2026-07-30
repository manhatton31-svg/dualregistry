/**
 * DNS _mcp TXT discovery status via DNS-over-HTTPS (no dig required).
 * Accepts both IETF v=mcp1 and legacy v=1 name= formats as live.
 */
import {
  agents1DnsMcpTxt,
  agents1DnsMcpTxtLegacy,
  agents1DnsPublishHint,
} from "./a2a-card";

export type DnsMcpStatus = {
  host: string;
  name: string;
  expected_txt: string;
  expected_txt_legacy: string;
  dns_record_hint: string;
  live: boolean;
  format: "mcp1" | "legacy" | "none";
  answers: string[];
  source: string;
  instructions: string[];
  registrar_note: string;
};

async function dohTxt(name: string): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      Answer?: Array<{ type?: number; data?: string }>;
    };
    return (j.Answer || [])
      .filter((a) => a.type === 16 && a.data)
      .map((a) => String(a.data).replace(/^"|"$/g, "").replace(/\\"/g, '"'));
  } catch {
    return [];
  }
}

export async function checkMcpDns(origin: string): Promise<DnsMcpStatus> {
  let host = "dualregistry.dev";
  try {
    host = new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    /* */
  }
  const names = [`_mcp.${host}`, `_mcp.www.${host}`];
  const cardOrigin = `https://www.${host}`;
  const expectedNorm = agents1DnsMcpTxt(cardOrigin);
  const expectedLegacy = agents1DnsMcpTxtLegacy(cardOrigin);
  const all: string[] = [];
  for (const n of names) {
    const ans = await dohTxt(n);
    all.push(...ans.map((a) => `${n}: ${a}`));
  }
  const flat = all.join(" ");
  const hasMcp1 =
    /\bv=mcp1\b/i.test(flat) &&
    (flat.includes("server-card") || flat.includes("url=https"));
  const hasLegacy =
    flat.includes("io.agents1.registry") ||
    flat.includes("v=1 name=") ||
    flat.includes(expectedLegacy);
  const live = hasMcp1 || hasLegacy || flat.includes("server-card");
  const format: DnsMcpStatus["format"] = hasMcp1
    ? "mcp1"
    : hasLegacy
      ? "legacy"
      : "none";

  return {
    host,
    name: `_mcp.${host}`,
    expected_txt: expectedNorm,
    expected_txt_legacy: expectedLegacy,
    dns_record_hint: agents1DnsPublishHint(`https://${host}`),
    live,
    format,
    answers: all,
    source: "dns-over-https:cloudflare-dns.com",
    instructions: [
      `Add/update DNS TXT at _mcp.${host}`,
      `Preferred (IETF draft): ${expectedNorm}`,
      `Legacy still accepted: ${expectedLegacy}`,
      "TTL: 300 (or auto)",
      "Cloudflare: DNS → Records → TXT on _mcp",
      "Or POST /api/ops/cloudflare-apply with CLOUDFLARE_API_TOKEN",
      "Verify: GET /api/dns/mcp-status until live=true and format=mcp1",
    ],
    registrar_note:
      "App code publishes the expected value; zone write needs Cloudflare token or dashboard.",
  };
}
