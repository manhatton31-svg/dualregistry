/**
 * DNS _mcp TXT discovery status via DNS-over-HTTPS (no dig required).
 */
import { agents1DnsMcpTxt, agents1DnsPublishHint } from "./a2a-card";

export type DnsMcpStatus = {
  host: string;
  name: string;
  expected_txt: string;
  dns_record_hint: string;
  live: boolean;
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
  const expected = agents1DnsMcpTxt(origin.startsWith("http") ? origin : `https://${host}`);
  // Prefer dualregistry.dev non-www for TXT
  const expectedNorm = agents1DnsMcpTxt(`https://${host}`);
  const all: string[] = [];
  for (const n of names) {
    const ans = await dohTxt(n);
    all.push(...ans.map((a) => `${n}: ${a}`));
  }
  const flat = all.join(" ");
  const live =
    flat.includes("io.agents1.registry") ||
    flat.includes("server-card") ||
    flat.includes(expectedNorm) ||
    flat.includes("v=1 name=");

  return {
    host,
    name: `_mcp.${host}`,
    expected_txt: expectedNorm,
    dns_record_hint: agents1DnsPublishHint(`https://${host}`),
    live,
    answers: all,
    source: "dns-over-https:cloudflare-dns.com",
    instructions: [
      `Add a DNS TXT record at _mcp.${host}`,
      `Value (exactly): ${expectedNorm}`,
      "TTL: 300 (or auto)",
      "If domain is on Cloudflare: DNS → Records → Add record → TXT",
      "If domain is on Vercel: Domains → dualregistry.dev → DNS Records → Add",
      "Verify: GET /api/dns/mcp-status until live=true",
    ],
    registrar_note:
      "This cannot be set from app code. Domain DNS must be edited at the registrar / Cloudflare / Vercel DNS panel.",
  };
}
