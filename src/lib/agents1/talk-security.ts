/**
 * Top-line security for Talk / social channels.
 * - Outbound only to https public hosts (no SSRF to private/metadata)
 * - Only targets already registered on clean listings
 * - Content policy + size limits (heartbeat cheap; full replies larger)
 * - Per-listing rate limits
 * - Never execute model/agent output as code
 */
import { isIP } from "node:net";

/** Heartbeat / presence — few tokens to stay active */
export const HEARTBEAT_MAX_CHARS = 280;
/** Full reply when asked a real question */
export const FULL_REPLY_MAX_CHARS = 8_000;
export const USER_MESSAGE_MAX_CHARS = 2_000;
export const SOCIAL_POST_MAX_CHARS = 500;

export const RATE = {
  presence_per_hour: 20,
  messages_per_hour: 40,
  social_posts_per_hour: 30,
  outbound_per_minute: 12,
};

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const BLOCKED_CONTENT =
  /<\s*script|javascript:|data:\s*text\/html|on\w+\s*=|eval\s*\(|Function\s*\(|import\s*\(|require\s*\(|__proto__|constructor\s*\[|child_process|fs\.promises|process\.env|BEGIN (RSA |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}/i;

export type SecurityVerdict = {
  ok: boolean;
  reason?: string;
  sanitized?: string;
};

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return false;
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  // IPv6 local / link-local / unique local
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80")) return true;
  return false;
}

/** SSRF guard — only public https URLs allowed for outbound talk. */
export function assertSafeOutboundUrl(raw: string): SecurityVerdict {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (u.protocol !== "https:") {
    return { ok: false, reason: "only https outbound allowed" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "credentials in URL blocked" };
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "blocked host" };
  }
  if (isPrivateIp(host)) {
    return { ok: false, reason: "private IP blocked" };
  }
  // hostname that looks like IP in brackets
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    if (isPrivateIp(inner)) return { ok: false, reason: "private IPv6 blocked" };
  }
  return { ok: true, sanitized: u.toString() };
}

/** Strip HTML/control chars; enforce length; block exploit patterns. */
export function sanitizeUserText(
  text: string,
  maxChars: number,
): SecurityVerdict {
  if (typeof text !== "string") {
    return { ok: false, reason: "text required" };
  }
  let s = text
    .replace(/\0/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/<[^>]{0,200}>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { ok: false, reason: "empty message" };
  if (s.length > maxChars) s = s.slice(0, maxChars);
  if (BLOCKED_CONTENT.test(s)) {
    return { ok: false, reason: "content policy: blocked pattern" };
  }
  return { ok: true, sanitized: s };
}

/** Sanitize inbound agent/MCP reply before showing humans or storing. */
export function sanitizeAgentReply(text: string): string {
  let s = String(text || "")
    .replace(/\0/g, "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "[blocked]")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/javascript:/gi, "");
  if (BLOCKED_CONTENT.test(s)) {
    // redacted but keep structure note
    s = s.replace(BLOCKED_CONTENT, "[redacted-policy]");
  }
  if (s.length > FULL_REPLY_MAX_CHARS) s = s.slice(0, FULL_REPLY_MAX_CHARS) + "…";
  return s;
}

const buckets = new Map<string, number[]>();

function prune(key: string, windowMs: number): number[] {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  buckets.set(key, arr);
  return arr;
}

export function rateAllow(
  key: string,
  limit: number,
  windowMs = 3600_000,
): SecurityVerdict {
  const arr = prune(key, windowMs);
  if (arr.length >= limit) {
    return {
      ok: false,
      reason: `rate limit: max ${limit} per ${Math.round(windowMs / 60000)}m`,
    };
  }
  arr.push(Date.now());
  buckets.set(key, arr);
  return { ok: true };
}

/** Target must match a registered clean listing URL (prefix or origin). */
export function urlAllowedForListing(
  target: string,
  allowed: string[],
): SecurityVerdict {
  const safe = assertSafeOutboundUrl(target);
  if (!safe.ok) return safe;
  const t = (safe.sanitized || target).replace(/\/$/, "").toLowerCase();
  for (const a of allowed) {
    if (!a) continue;
    const safeA = assertSafeOutboundUrl(a);
    if (!safeA.ok) continue;
    const b = (safeA.sanitized || a).replace(/\/$/, "").toLowerCase();
    if (t === b || t.startsWith(b + "/") || b.startsWith(t + "/")) {
      return { ok: true, sanitized: safe.sanitized };
    }
    try {
      const ut = new URL(t);
      const ub = new URL(b);
      if (ut.origin === ub.origin) return { ok: true, sanitized: safe.sanitized };
    } catch {
      /* */
    }
  }
  return { ok: false, reason: "target not on listing allowlist" };
}
